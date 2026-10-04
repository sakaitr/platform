import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmDeals, crmLeads, crmStages, subscriptions, tenants, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import { findVisibleActivityIds, findVisibleDealIds } from "@/modules/satis/access";
import { createActivity, createDeal } from "@/modules/satis/deals";
import { createLeadIfNew } from "@/modules/satis/leads";
import {
  getBoard,
  getDealDetail,
  listFollowUpLeads,
  listTasks,
  taskCounts,
} from "@/modules/satis/pipeline-queries";
import type { VisibilitySession } from "@/modules/satis/visibility";
import { buildDigest, runSatisDigest, shouldRunDigest } from "../worker/jobs/satis-digest";
import { resetDatabase } from "./setup";

const DAY = 86_400_000;

async function seedWorld(slug = "w") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: `Firma ${slug}`, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = t!.id;
  await dbAdmin
    .insert(subscriptions)
    .values({ tenantId, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * DAY) });
  await applySectorPack(tenantId, "satis_crm");
  const [m, a, b] = await dbAdmin
    .insert(users)
    .values([
      { tenantId, email: `m@${slug}.co`, name: "Yönetici", passwordHash: "x" },
      { tenantId, email: `a@${slug}.co`, name: "Satışçı A", passwordHash: "x" },
      { tenantId, email: `b@${slug}.co`, name: "Satışçı B", passwordHash: "x" },
    ])
    .returning();
  const rep = new Set(["satis_aktivite:read", "satis_firsat:read"]);
  const manager: VisibilitySession = { tenantId, userId: m!.id, permissions: new Set([...rep, "satis_hepsi:read"]) };
  const repA: VisibilitySession = { tenantId, userId: a!.id, permissions: rep };
  const repB: VisibilitySession = { tenantId, userId: b!.id, permissions: rep };
  return { tenantId, manager, repA, repB, tenantName: `Firma ${slug}` };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

const task = (w: World, input: { subject: string; assignee: string | null; due: Date | null; leadId?: string }) =>
  withTenant(w.tenantId, async (tx) => {
    const lead =
      input.leadId ??
      (await createLeadIfNew(tx, w.tenantId, { name: `Aday ${input.subject}`, source: "manual" }).then((r) =>
        r.status === "created" ? r.id : Promise.reject(new Error("seed")),
      ));
    return createActivity(tx, w.tenantId, {
      type: "task",
      subject: input.subject,
      dueAt: input.due,
      assigneeUserId: input.assignee,
      leadId: lead,
    });
  });

describe("görev sorguları", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("satışçı yalnız kendi ve sahipsiz görevlerini görür; 'ben' yalnız kendi", async () => {
    await task(w, { subject: "A'nın", assignee: w.repA.userId, due: new Date(Date.now() + DAY) });
    await task(w, { subject: "B'nin", assignee: w.repB.userId, due: new Date(Date.now() + DAY) });
    await task(w, { subject: "Sahipsiz", assignee: null, due: new Date(Date.now() + DAY) });

    const mine = await listTasks(w.repA, { assignee: "ben" });
    expect(mine.map((t) => t.subject)).toEqual(["A'nın"]);
    const all = await listTasks(w.repA, { assignee: "hepsi" });
    expect(all.map((t) => t.subject).sort()).toEqual(["A'nın", "Sahipsiz"]);
    // başkasının kimliğini yazarak kısıtı aşamaz
    expect(await listTasks(w.repA, { assignee: w.repB.userId })).toHaveLength(0);
    // yönetici herkesi görür
    expect((await listTasks(w.manager, { assignee: "hepsi" })).map((t) => t.subject).sort()).toEqual(["A'nın", "B'nin", "Sahipsiz"]);
    expect((await listTasks(w.manager, { assignee: w.repB.userId })).map((t) => t.subject)).toEqual(["B'nin"]);
  });

  it("vade sırası: yakın önce, vadesiz sonda; tamamlananlar ayrı görünümde", async () => {
    await task(w, { subject: "geç", assignee: w.repA.userId, due: new Date(Date.now() + 5 * DAY) });
    await task(w, { subject: "vadesiz", assignee: w.repA.userId, due: null });
    await task(w, { subject: "erken", assignee: w.repA.userId, due: new Date(Date.now() + DAY) });
    const done = await task(w, { subject: "bitti", assignee: w.repA.userId, due: new Date(Date.now() - DAY) });
    await dbAdmin.update(crmActivities).set({ doneAt: new Date() }).where(eq(crmActivities.id, done));

    expect((await listTasks(w.repA, { view: "acik" })).map((t) => t.subject)).toEqual(["erken", "geç", "vadesiz"]);
    expect((await listTasks(w.repA, { view: "tamam" })).map((t) => t.subject)).toEqual(["bitti"]);
  });

  it("30 günden eski tamamlananlar listelenmez", async () => {
    const old = await task(w, { subject: "eski", assignee: w.repA.userId, due: null });
    await dbAdmin.update(crmActivities).set({ doneAt: new Date(Date.now() - 40 * DAY) }).where(eq(crmActivities.id, old));
    expect(await listTasks(w.repA, { view: "tamam" })).toHaveLength(0);
  });

  it("not ve arama kayıtları görev listesine girmez", async () => {
    await withTenant(w.tenantId, async (tx) => {
      const lead = await createLeadIfNew(tx, w.tenantId, { name: "X Kişi", source: "manual" });
      if (lead.status !== "created") throw new Error("seed");
      await createActivity(tx, w.tenantId, { type: "note", subject: "Not", leadId: lead.id, assigneeUserId: w.repA.userId });
    });
    expect(await listTasks(w.repA, { view: "acik" })).toHaveLength(0);
  });

  it("görev sayıları: geciken ve bugün (İstanbul günü)", async () => {
    await task(w, { subject: "dün", assignee: w.repA.userId, due: new Date(Date.now() - 2 * DAY) });
    await task(w, { subject: "yarın", assignee: w.repA.userId, due: new Date(Date.now() + 2 * DAY) });
    const counts = await taskCounts(w.repA);
    expect(counts.overdue).toBe(1);
    expect(counts.today).toBe(0);
  });

  it("görev görünürlüğü yazma yolunda: findVisibleActivityIds", async () => {
    const mine = await task(w, { subject: "benim", assignee: w.repA.userId, due: null });
    const theirs = await task(w, { subject: "onun", assignee: w.repB.userId, due: null });
    const ids = await withTenant(w.tenantId, (tx) => findVisibleActivityIds(tx, w.repA, [mine, theirs]));
    expect(ids).toEqual([mine]);
  });

  it("takip listesi: yalnız takip günü gelmiş, dönüşmemiş ve görünür adaylar", async () => {
    const mk = (name: string, owner: string | null, followUp: Date | null, status: "new" | "converted" = "new") =>
      dbAdmin.insert(crmLeads).values({ tenantId: w.tenantId, name, ownerUserId: owner, followUpAt: followUp, status });
    await mk("Gecikmiş", w.repA.userId, new Date(Date.now() - 3 * DAY));
    await mk("Gelecek", w.repA.userId, new Date(Date.now() + 3 * DAY));
    await mk("Takipsiz", w.repA.userId, null);
    await mk("Dönüşmüş", w.repA.userId, new Date(Date.now() - DAY), "converted");
    await mk("Başkasının", w.repB.userId, new Date(Date.now() - DAY));
    expect((await listFollowUpLeads(w.repA)).map((l) => l.name)).toEqual(["Gecikmiş"]);
    expect((await listFollowUpLeads(w.manager, "hepsi")).map((l) => l.name).sort()).toEqual(["Başkasının", "Gecikmiş"]);
  });
});

describe("pano ve fırsat görünürlüğü", () => {
  let w: World;
  let mine: string;
  let theirs: string;
  let free: string;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
    const make = (title: string, owner: string | null) =>
      withTenant(w.tenantId, (tx) => createDeal(tx, w.tenantId, { title, ownerUserId: owner, value: 1000 }));
    mine = await make("A fırsatı", w.repA.userId);
    theirs = await make("B fırsatı", w.repB.userId);
    free = await make("Sahipsiz fırsat", null);
  });

  it("satışçı panoda kendi ve sahipsiz fırsatları görür; yönetici hepsini; toplamlar görünene göre", async () => {
    const titles = async (s: VisibilitySession) =>
      (await getBoard(s)).columns.flatMap((c) => c.deals.map((d) => d.title)).sort();
    expect(await titles(w.repA)).toEqual(["A fırsatı", "Sahipsiz fırsat"]);
    expect(await titles(w.manager)).toEqual(["A fırsatı", "B fırsatı", "Sahipsiz fırsat"]);
    const board = await getBoard(w.repA);
    expect(board.columns.reduce((n, c) => n + c.count, 0)).toBe(2);
    expect(board.columns.reduce((n, c) => n + c.value, 0)).toBe(2000);
    // sahip süzgecine başkasının kimliğini yazmak kısıtı aşmaz
    const sneaky = await getBoard(w.repA, { owner: w.repB.userId });
    expect(sneaky.columns.reduce((n, c) => n + c.count, 0)).toBe(0);
  });

  it("pano sütunları aşama sırasıyla gelir", async () => {
    const board = await getBoard(w.manager);
    expect(board.columns.map((c) => c.stage.label)).toEqual(["Yeni", "Görüşüldü", "Teklif", "Kazanıldı", "Kaybedildi"]);
  });

  it("fırsat detayı ve yazma görünürlüğü", async () => {
    expect(await getDealDetail(w.repA, theirs)).toBeNull();
    expect((await getDealDetail(w.repA, mine))?.deal.title).toBe("A fırsatı");
    expect(await getDealDetail(w.repA, free)).not.toBeNull();
    expect(await getDealDetail(w.repA, "bozuk")).toBeNull();
    const ids = await withTenant(w.tenantId, (tx) => findVisibleDealIds(tx, w.repA, [mine, theirs, free]));
    expect(ids.sort()).toEqual([mine, free].sort());
  });

  it("başka kiracının fırsatı görünmez", async () => {
    const other = await seedWorld("y");
    const foreign = await withTenant(other.tenantId, (tx) => createDeal(tx, other.tenantId, { title: "Yabancı" }));
    expect(await getDealDetail(w.manager, foreign)).toBeNull();
    expect((await getBoard(w.manager)).columns.flatMap((c) => c.deals).map((d) => d.title)).not.toContain("Yabancı");
  });

  it("silinen aşamayı kullanan fırsat yoksa pano boş sütun gösterir", async () => {
    const stages = await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, w.tenantId));
    expect(stages).toHaveLength(5);
    await dbAdmin.delete(crmDeals).where(eq(crmDeals.tenantId, w.tenantId));
    const board = await getBoard(w.manager);
    expect(board.columns.every((c) => c.count === 0)).toBe(true);
  });
});

describe("günlük özet", () => {
  it("08:00'dan önce ve aynı gün ikinci kez çalışmaz (İstanbul günü)", () => {
    expect(shouldRunDigest(new Date("2026-10-04T07:59:00+03:00"), null)).toBe(false);
    expect(shouldRunDigest(new Date("2026-10-04T08:00:00+03:00"), null)).toBe(true);
    expect(shouldRunDigest(new Date("2026-10-04T15:00:00+03:00"), "2026-10-04")).toBe(false);
    expect(shouldRunDigest(new Date("2026-10-05T09:00:00+03:00"), "2026-10-04")).toBe(true);
    // UTC'de hâlâ önceki gün olan 00:30 İstanbul: saat 8 değil
    expect(shouldRunDigest(new Date("2026-10-03T21:30:00Z"), null)).toBe(false);
  });

  it("içerik: bölümler ve sayılar; boşsa özet yok", () => {
    expect(buildDigest({ userName: "A", tenantName: "T", overdue: [], today: [], followUps: [], link: "x" })).toBeNull();
    const digest = buildDigest({
      userName: "Ayşe",
      tenantName: "Firma",
      overdue: [{ subject: "Ara", dueAt: new Date("2026-10-03T09:00:00+03:00"), about: "Mavi Tur" }],
      today: [{ subject: "Teklif", dueAt: null, about: null }],
      followUps: [{ name: "Yeşil", phone: "0532" }],
      link: "https://app/satis/gorevler",
    })!;
    expect(digest.subject).toBe("Firma: bugün 3 iş sizi bekliyor");
    expect(digest.body).toContain("Merhaba Ayşe,");
    expect(digest.body).toContain("Geciken görevler (1):");
    expect(digest.body).toContain("- Ara (Mavi Tur), vade 03.10.2026 09:00");
    expect(digest.body).toContain("Bugün yapılacaklar (1):");
    expect(digest.body).toContain("Bugün aranacak adaylar (1):\n- Yeşil, 0532");
    expect(digest.body.endsWith("Görevlere git: https://app/satis/gorevler")).toBe(true);
  });

  it("yalnız kendine atanmış işi olan kullanıcıya gönderir; sahipsiz ve başkasının işi karışmaz; ikinci çalıştırma tekrar göndermez", async () => {
    await resetDatabase();
    const w = await seedWorld();
    await task(w, { subject: "A için", assignee: w.repA.userId, due: new Date(Date.now() - DAY) });
    await task(w, { subject: "Sahipsiz", assignee: null, due: new Date(Date.now() - DAY) });
    await task(w, { subject: "Gelecek", assignee: w.repB.userId, due: new Date(Date.now() + 5 * DAY) });
    await dbAdmin.insert(crmLeads).values({ tenantId: w.tenantId, name: "Aranacak Aday", ownerUserId: w.repB.userId, followUpAt: new Date(Date.now() - DAY) });

    const claimed = new Set<string>();
    const sent: { to: string; subject: string; body: string }[] = [];
    const deps = {
      claim: async (k: string) => (claimed.has(k) ? false : (claimed.add(k), true)),
      send: async (j: { to: string; subject: string; body: string }) => { sent.push(j); },
      appUrl: "https://app.test",
    };
    const first = await runSatisDigest(deps);
    expect(first.emails).toBe(2);
    const toA = sent.find((s) => s.to === "a@w.co")!;
    expect(toA.body).toContain("A için");
    expect(toA.body).not.toContain("Sahipsiz");
    expect(toA.subject).toBe("Firma w: bugün 1 iş sizi bekliyor");
    const toB = sent.find((s) => s.to === "b@w.co")!;
    expect(toB.body).toContain("Aranacak Aday");
    expect(toB.body).not.toContain("Gelecek");
    expect(sent.some((s) => s.to === "m@w.co")).toBe(false);

    const second = await runSatisDigest(deps);
    expect(second.emails).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("satış modülü lisanssız ya da askıda kiracıya gönderilmez", async () => {
    await resetDatabase();
    const w = await seedWorld();
    await task(w, { subject: "A için", assignee: w.repA.userId, due: new Date(Date.now() - DAY) });
    await dbAdmin.update(tenants).set({ isActive: false }).where(eq(tenants.id, w.tenantId));
    const sent: unknown[] = [];
    const result = await runSatisDigest({ claim: async () => true, send: async (j) => { sent.push(j); } });
    expect(result.emails).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
