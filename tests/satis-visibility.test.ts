import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import { findVisibleLeadIds, resolveOwner } from "@/modules/satis/access";
import { createLeadIfNew } from "@/modules/satis/leads";
import { getLeadDetail, listLeads, listLeadsForExport, PAGE_SIZE } from "@/modules/satis/queries";
import type { VisibilitySession } from "@/modules/satis/visibility";
import { resetDatabase } from "./setup";

type World = {
  tenantId: string;
  manager: VisibilitySession;
  repA: VisibilitySession;
  repB: VisibilitySession;
  mine: string;
  theirs: string;
  free: string;
};

async function seedWorld(slug = "w"): Promise<World> {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = t!.id;
  await dbAdmin.insert(subscriptions).values({ tenantId, status: "active" });
  await applySectorPack(tenantId, "satis_crm");
  const [m, a, b] = await dbAdmin
    .insert(users)
    .values([
      { tenantId, email: `m@${slug}.co`, name: "Yönetici", passwordHash: "x" },
      { tenantId, email: `a@${slug}.co`, name: "Satışçı A", passwordHash: "x" },
      { tenantId, email: `b@${slug}.co`, name: "Satışçı B", passwordHash: "x" },
    ])
    .returning();
  const rep = new Set(["satis_aday:read", "satis_aday:update"]);
  const manager: VisibilitySession = { tenantId, userId: m!.id, permissions: new Set([...rep, "satis_hepsi:read"]) };
  const repA: VisibilitySession = { tenantId, userId: a!.id, permissions: rep };
  const repB: VisibilitySession = { tenantId, userId: b!.id, permissions: rep };

  const make = async (name: string, ownerUserId: string | null) => {
    const r = await withTenant(tenantId, (tx) =>
      createLeadIfNew(tx, tenantId, { name, ownerUserId, source: "manual" }),
    );
    if (r.status !== "created") throw new Error("seed");
    return r.id;
  };
  return {
    tenantId, manager, repA, repB,
    mine: await make("A'nın adayı", a!.id),
    theirs: await make("B'nin adayı", b!.id),
    free: await make("Sahipsiz aday", null),
  };
}

describe("satış görünürlüğü", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("yönetici (satis_hepsi:read) hepsini görür", async () => {
    const { total } = await listLeads(w.manager, {});
    expect(total).toBe(3);
  });

  it("satışçı yalnız kendi ve sahipsiz adayları görür, başkasınınkini görmez", async () => {
    const { rows } = await listLeads(w.repA, {});
    expect(rows.map((r) => r.name).sort()).toEqual(["A'nın adayı", "Sahipsiz aday"]);
    const b = await listLeads(w.repB, {});
    expect(b.rows.map((r) => r.name).sort()).toEqual(["B'nin adayı", "Sahipsiz aday"]);
  });

  it("satışçı başkasının adayını detay sorgusuyla da alamaz", async () => {
    expect(await getLeadDetail(w.repA, w.theirs)).toBeNull();
    expect(await getLeadDetail(w.repA, w.mine)).not.toBeNull();
    expect(await getLeadDetail(w.repA, w.free)).not.toBeNull();
    expect(await getLeadDetail(w.manager, w.theirs)).not.toBeNull();
  });

  it("geçersiz kimlik biçimi sorguyu patlatmaz", async () => {
    expect(await getLeadDetail(w.manager, "../etc/passwd")).toBeNull();
    expect(await getLeadDetail(w.manager, "'; DROP TABLE crm_leads;--")).toBeNull();
  });

  it("yazma yolunda da görünürlük: findVisibleLeadIds başkasının adayını elemez/ekler", async () => {
    const ids = await withTenant(w.tenantId, (tx) => findVisibleLeadIds(tx, w.repA, [w.mine, w.theirs, w.free]));
    expect(ids.sort()).toEqual([w.mine, w.free].sort());
    const all = await withTenant(w.tenantId, (tx) => findVisibleLeadIds(tx, w.manager, [w.mine, w.theirs, w.free]));
    expect(all).toHaveLength(3);
  });

  it("sahip ataması: satışçı yalnız kendine atayabilir, yönetici herkese", async () => {
    const asRep = (requested: string | null) => withTenant(w.tenantId, (tx) => resolveOwner(tx, w.repA, requested));
    expect(await asRep(w.repA.userId)).toEqual({ ok: true, ownerUserId: w.repA.userId });
    expect(await asRep(null)).toEqual({ ok: true, ownerUserId: null });
    expect(await asRep(w.repB.userId)).toMatchObject({ ok: false });
    const asManager = await withTenant(w.tenantId, (tx) => resolveOwner(tx, w.manager, w.repB.userId));
    expect(asManager).toEqual({ ok: true, ownerUserId: w.repB.userId });
  });

  it("pasif ya da başka kiracıdaki kullanıcıya atanamaz", async () => {
    const other = await seedWorld("x");
    const toForeign = await withTenant(w.tenantId, (tx) => resolveOwner(tx, w.manager, other.repA.userId));
    expect(toForeign).toMatchObject({ ok: false });
    await dbAdmin.update(users).set({ isActive: false }).where((await import("drizzle-orm")).eq(users.id, w.repB.userId));
    const toInactive = await withTenant(w.tenantId, (tx) => resolveOwner(tx, w.manager, w.repB.userId));
    expect(toInactive).toMatchObject({ ok: false });
  });

  it("dışa aktarma listesi de görünürlüğe uyar", async () => {
    expect(await listLeadsForExport(w.repA, {})).toHaveLength(2);
    expect(await listLeadsForExport(w.manager, {})).toHaveLength(3);
  });

  it("başka kiracının adayı hiçbir sorguda görünmez", async () => {
    const other = await seedWorld("y");
    expect((await listLeads(w.manager, {})).total).toBe(3);
    expect(await getLeadDetail(w.manager, other.mine)).toBeNull();
  });
});

describe("aday listesi filtreleri", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("arama ASCII büyük/küçük harften bağımsız çalışır; % ve _ düz metindir", async () => {
    // Türkçe ı/I eşlemesi veritabanı yerel ayarına bağlıdır, burada sınanmaz (rapordaki açık risk).
    expect((await listLeads(w.manager, { q: "sahipsiz" })).total).toBe(1);
    expect((await listLeads(w.manager, { q: "SAHIPSIZ" })).total).toBe(1);
    expect((await listLeads(w.manager, { q: "ADAY" })).total).toBe(3);
    expect((await listLeads(w.manager, { q: "%" })).total).toBe(0);
    expect((await listLeads(w.manager, { q: "_" })).total).toBe(0);
    expect((await listLeads(w.manager, { q: "nın adayı" })).total).toBe(1);
  });

  it("sahip süzgeci: ben, sahipsiz, belirli kullanıcı", async () => {
    expect((await listLeads(w.repA, { owner: "ben" })).rows.map((r) => r.name)).toEqual(["A'nın adayı"]);
    expect((await listLeads(w.manager, { owner: "sahipsiz" })).rows.map((r) => r.name)).toEqual(["Sahipsiz aday"]);
    expect((await listLeads(w.manager, { owner: w.repB.userId })).rows.map((r) => r.name)).toEqual(["B'nin adayı"]);
    // satışçı sahip süzgecine başkasının kimliğini yazarak kısıtı aşamaz
    expect((await listLeads(w.repA, { owner: w.repB.userId })).total).toBe(0);
  });

  it("geçersiz süzgeç değerleri yok sayılır, sıralama anahtarı prototip anahtarı olamaz", async () => {
    expect((await listLeads(w.manager, { status: "uydurma", temperature: "x", source: "y", owner: "z" })).total).toBe(3);
    for (const sort of ["constructor", "__proto__", "toString", "yok"]) {
      expect((await listLeads(w.manager, { sort })).total, sort).toBe(3);
    }
  });

  it("sayfalama: PAGE_SIZE aşılınca ikinci sayfa, sayfa sayısı doğru", async () => {
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ tenantId: w.tenantId, name: `Toplu ${String(i).padStart(3, "0")}` }));
    const { crmLeads } = await import("@/db/schema");
    await dbAdmin.insert(crmLeads).values(rows);
    const p1 = await listLeads(w.manager, { sort: "ad", page: 1 });
    const p2 = await listLeads(w.manager, { sort: "ad", page: 2 });
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p1.pageCount).toBe(2);
    expect(p2.rows.length).toBe(p1.total - PAGE_SIZE);
    const ids = new Set([...p1.rows, ...p2.rows].map((r) => r.id));
    expect(ids.size).toBe(p1.total);
    expect((await listLeads(w.manager, { page: -3 })).page).toBe(1);
  });
});
