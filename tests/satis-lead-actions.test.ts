import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmContacts, crmLeads, subscriptions, tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import { createLeadIfNew } from "@/modules/satis/leads";
import type { VisibilitySession } from "@/modules/satis/visibility";
import { resetDatabase } from "./setup";

// Sunucu eylemleri oturumu `requireModule` ile alır; burada oturumu test belirler,
// veritabanı gerçek Postgres kalır. Önbellek ve yönlendirme Next'e özgü olduğu için sahtelenir.
const state = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth", () => ({
  requireModule: vi.fn(async () => state.session),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const actions = await import("@/modules/satis/actions");

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

type World = {
  tenantId: string;
  manager: VisibilitySession;
  repA: VisibilitySession;
  mine: string;
  theirs: string;
  free: string;
};

async function seedWorld(): Promise<World> {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "w", slug: "w", sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = t!.id;
  await dbAdmin.insert(subscriptions).values({ tenantId, status: "active" });
  await applySectorPack(tenantId, "satis_crm");
  const [m, a, b] = await dbAdmin
    .insert(users)
    .values([
      { tenantId, email: "m@w.co", name: "Yönetici", passwordHash: "x" },
      { tenantId, email: "a@w.co", name: "Satışçı A", passwordHash: "x" },
      { tenantId, email: "b@w.co", name: "Satışçı B", passwordHash: "x" },
    ])
    .returning();
  const rep = new Set(["satis_aday:read", "satis_aday:update", "satis_aday:delete"]);
  const make = async (name: string, ownerUserId: string | null) => {
    const r = await withTenant(tenantId, (tx) => createLeadIfNew(tx, tenantId, { name, ownerUserId, source: "manual" }));
    if (r.status !== "created") throw new Error("seed");
    return r.id;
  };
  return {
    tenantId,
    manager: { tenantId, userId: m!.id, permissions: new Set([...rep, "satis_hepsi:read"]) },
    repA: { tenantId, userId: a!.id, permissions: rep },
    mine: await make("A'nın adayı", a!.id),
    theirs: await make("B'nin adayı", b!.id),
    free: await make("Sahipsiz aday", null),
  };
}

const leadRow = async (id: string) =>
  (await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, id)))[0];

describe("aday sunucu eylemleri", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("durum değiştirme: kendi adayı değişir, başkasınınki değişmez", async () => {
    state.session = w.repA;
    await actions.setLeadStatusAction(form({ id: w.mine, status: "contacted" }));
    await actions.setLeadStatusAction(form({ id: w.theirs, status: "contacted" }));
    expect((await leadRow(w.mine))!.status).toBe("contacted");
    expect((await leadRow(w.theirs))!.status).toBe("new");
  });

  it("geçersiz durum ve sıcaklık değeri yok sayılır", async () => {
    state.session = w.manager;
    await actions.setLeadStatusAction(form({ id: w.mine, status: "converted" }));
    await actions.setLeadTemperatureAction(form({ id: w.mine, temperature: "boiling" }));
    const row = (await leadRow(w.mine))!;
    expect(row.status).toBe("new");
    expect(row.temperature).toBeNull();
  });

  it("sıcaklık: ayarlanır ve boş değerle kaldırılır", async () => {
    state.session = w.repA;
    await actions.setLeadTemperatureAction(form({ id: w.mine, temperature: "hot" }));
    expect((await leadRow(w.mine))!.temperature).toBe("hot");
    await actions.setLeadTemperatureAction(form({ id: w.mine, temperature: "" }));
    expect((await leadRow(w.mine))!.temperature).toBeNull();
  });

  it("satışçı başkasının adayına dokunamaz: sıcaklık, atama, silme", async () => {
    state.session = w.repA;
    await actions.setLeadTemperatureAction(form({ id: w.theirs, temperature: "hot" }));
    await actions.assignLeadAction(form({ id: w.theirs, ownerUserId: w.repA.userId }));
    await actions.deleteLeadAction(form({ id: w.theirs }));
    const row = (await leadRow(w.theirs))!;
    expect(row.temperature).toBeNull();
    expect(row.ownerUserId).not.toBe(w.repA.userId);
  });

  it("yönetici başkasına atayabilir ve sahibi kaldırabilir", async () => {
    state.session = w.manager;
    await actions.assignLeadAction(form({ id: w.free, ownerUserId: w.repA.userId }));
    expect((await leadRow(w.free))!.ownerUserId).toBe(w.repA.userId);
    await actions.assignLeadAction(form({ id: w.free, ownerUserId: "" }));
    expect((await leadRow(w.free))!.ownerUserId).toBeNull();
  });

  it("silme: görünür aday silinir ve listeye yönlendirir", async () => {
    state.session = w.repA;
    await expect(actions.deleteLeadAction(form({ id: w.mine }))).rejects.toThrow("NEXT_REDIRECT:/satis/adaylar");
    expect(await leadRow(w.mine)).toBeUndefined();
  });

  it("toplu işlem: yalnız görünür adaylara uygulanır", async () => {
    state.session = w.repA;
    await actions.bulkLeadAction(form({ bulk: "status:qualified", ids: [w.mine, w.theirs, w.free] }));
    expect((await leadRow(w.mine))!.status).toBe("qualified");
    expect((await leadRow(w.free))!.status).toBe("qualified");
    expect((await leadRow(w.theirs))!.status).toBe("new");
  });

  it("toplu işlem: geçersiz işlem ve boş seçim hiçbir şey yapmaz", async () => {
    state.session = w.manager;
    await actions.bulkLeadAction(form({ bulk: "status:bogus", ids: [w.mine] }));
    await actions.bulkLeadAction(form({ bulk: "explode:", ids: [w.mine] }));
    await actions.bulkLeadAction(form({ bulk: "delete:", ids: [] }));
    expect((await leadRow(w.mine))!.status).toBe("new");
    expect(await dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, w.tenantId))).toHaveLength(3);
  });

  it("toplu silme yönetici için tüm seçilenleri siler", async () => {
    state.session = w.manager;
    await actions.bulkLeadAction(form({ bulk: "delete:", ids: [w.mine, w.theirs] }));
    const left = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, w.tenantId));
    expect(left.map((l) => l.id)).toEqual([w.free]);
  });
});

describe("kişi sunucu eylemleri", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  const contacts = (leadId: string) =>
    dbAdmin.select().from(crmContacts).where(and(eq(crmContacts.tenantId, w.tenantId), eq(crmContacts.leadId, leadId)));

  it("kişi eklenir; ad boşsa hata döner", async () => {
    state.session = w.repA;
    const ok = await actions.addContactAction(null, form({ leadId: w.mine, fullName: "Ayşe Yılmaz", title: "Satın alma" }));
    expect(ok).toEqual({ ok: "Kişi eklendi." });
    const bad = await actions.addContactAction(null, form({ leadId: w.mine, fullName: "" }));
    expect(bad).toHaveProperty("error");
    expect(await contacts(w.mine)).toHaveLength(1);
  });

  it("satışçı başkasının adayına kişi ekleyemez", async () => {
    state.session = w.repA;
    const r = await actions.addContactAction(null, form({ leadId: w.theirs, fullName: "Ali" }));
    expect(r).toEqual({ error: "Bu adaya kişi ekleme yetkiniz yok." });
    expect(await contacts(w.theirs)).toHaveLength(0);
  });

  it("kişi silinir; başkasının adayındaki kişi silinemez", async () => {
    state.session = w.manager;
    await actions.addContactAction(null, form({ leadId: w.mine, fullName: "Ayşe" }));
    await actions.addContactAction(null, form({ leadId: w.theirs, fullName: "Ali" }));
    const mineContact = (await contacts(w.mine))[0]!;
    const theirContact = (await contacts(w.theirs))[0]!;

    state.session = w.repA;
    await actions.removeContactAction(form({ id: theirContact.id, leadId: w.theirs }));
    expect(await contacts(w.theirs)).toHaveLength(1);
    await actions.removeContactAction(form({ id: mineContact.id, leadId: w.mine }));
    expect(await contacts(w.mine)).toHaveLength(0);
  });

  it("yanlış aday kimliğiyle gelen silme isteği başka adayın kişisini silmez", async () => {
    state.session = w.manager;
    await actions.addContactAction(null, form({ leadId: w.mine, fullName: "Ayşe" }));
    const c = (await contacts(w.mine))[0]!;
    await actions.removeContactAction(form({ id: c.id, leadId: w.free }));
    expect(await contacts(w.mine)).toHaveLength(1);
  });
});
