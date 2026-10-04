import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmDeals, crmLeads, crmStages, subscriptions, tenants, users } from "@/db/schema";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { ensureReportsRegistered, listReports, runReport } from "@/lib/reports/engine";
import { applySectorPack } from "@/lib/sector/install";
import { percent, reportRange } from "@/modules/satis/reports";
import { satisTiles } from "@/modules/satis/dashboard";
import { resetDatabase } from "./setup";
import { and, eq } from "drizzle-orm";

const at = (iso: string) => new Date(`${iso}+03:00`);
const RANGE = { from: "2026-09-01", to: "2026-10-31" };

async function seed(slug = "t1") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = t!.id;
  await dbAdmin.insert(subscriptions).values({ tenantId, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(tenantId, "satis_crm");
  const [a, b] = await dbAdmin
    .insert(users)
    .values([
      { tenantId, email: `a@${slug}.co`, name: "Ayşe", passwordHash: "x" },
      { tenantId, email: `b@${slug}.co`, name: "Burak", passwordHash: "x" },
    ])
    .returning();
  const stage = async (key: string) => (await dbAdmin.select().from(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.key, key))))[0]!.id;
  const deal = (title: string, key: string, owner: string | null, value: string, createdAt: string, closedAt: string | null = null, lostReason: string | null = null) =>
    stage(key).then((stageId) =>
      dbAdmin.insert(crmDeals).values({ tenantId, title, stageId, ownerUserId: owner, value, createdAt: at(createdAt), closedAt: closedAt ? at(closedAt) : null, lostReason }),
    );

  await deal("d1", "kazanildi", a!.id, "1000.00", "2026-09-02T09:00:00", "2026-09-10T09:00:00");
  await deal("d2", "kazanildi", a!.id, "2000.00", "2026-10-01T09:00:00", "2026-10-04T09:00:00");
  await deal("d3", "kaybedildi", a!.id, "500.00", "2026-09-15T09:00:00", "2026-10-02T09:00:00", "Bütçe");
  await deal("d4", "kazanildi", b!.id, "4000.00", "2026-09-05T09:00:00", "2026-09-20T09:00:00");
  await deal("d5", "teklif", b!.id, "700.00", "2026-10-01T09:00:00");
  await deal("d6", "yeni", b!.id, "300.00", "2026-10-02T09:00:00");
  await deal("d7", "yeni", null, "100.00", "2026-10-03T09:00:00");
  await deal("d8", "kazanildi", b!.id, "9999.00", "2026-07-01T09:00:00", "2026-08-01T09:00:00"); // aralık dışı

  const lead = (name: string, owner: string | null, source: "atricard" | "manual" | "csv", status: "new" | "converted", createdAt: string, value: string | null = null) =>
    dbAdmin.insert(crmLeads).values({ tenantId, name, ownerUserId: owner, source, status, createdAt: at(createdAt), estimatedValue: value });
  await lead("l1", a!.id, "atricard", "converted", "2026-09-03T10:00:00", "1000.00");
  await lead("l2", a!.id, "atricard", "new", "2026-09-04T10:00:00", "500.00");
  await lead("l3", a!.id, "manual", "new", "2026-09-05T10:00:00");
  await lead("l4", b!.id, "csv", "new", "2026-09-06T10:00:00");
  await lead("l5", null, "atricard", "new", "2026-08-01T10:00:00"); // aralık dışı

  const [anyLead] = await dbAdmin.select({ id: crmLeads.id }).from(crmLeads).where(eq(crmLeads.tenantId, tenantId)).limit(1);
  const task = (assignee: string, doneAt: string) =>
    dbAdmin.insert(crmActivities).values({ tenantId, type: "task", subject: "g", leadId: anyLead!.id, assigneeUserId: assignee, doneAt: at(doneAt) });
  await task(a!.id, "2026-09-12T10:00:00");
  await task(a!.id, "2026-10-02T10:00:00");
  await task(a!.id, "2026-08-15T10:00:00"); // aralık dışı
  await task(b!.id, "2026-09-30T10:00:00");
  return { tenantId, a: a!.id, b: b!.id };
}

describe("satış raporları", () => {
  let w: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    await resetDatabase();
    await ensureReportsRegistered();
    w = await seed();
  });

  const run = (key: string, range: { from?: string; to?: string } = RANGE) => runReport(key, { tenantId: w.tenantId, ...range });

  it("satış hunisi: aşama sırasıyla adet, tutar, ortalama; açık toplam özette", async () => {
    const r = await run("satis_huni", {});
    expect(r.rows).toEqual([
      { asama: "Yeni", tur: "Açık", adet: 2, toplam: 400, ortalama: 200 },
      { asama: "Görüşüldü", tur: "Açık", adet: 0, toplam: 0, ortalama: 0 },
      { asama: "Teklif", tur: "Açık", adet: 1, toplam: 700, ortalama: 700 },
      { asama: "Kazanıldı", tur: "Kazanıldı", adet: 4, toplam: 16999, ortalama: 4249.75 },
      { asama: "Kaybedildi", tur: "Kaybedildi", adet: 1, toplam: 500, ortalama: 500 },
    ]);
    expect(r.summary).toEqual({ "Açık fırsat": "3", "Açık fırsat tutarı (₺)": "1100" });
  });

  it("kaynağa göre aday: tarih aralığındaki adaylar, dönüşüm oranı, sıralama (çok olan önce)", async () => {
    const r = await run("satis_kaynak");
    expect(r.rows).toEqual([
      { kaynak: "Atricard", adet: 2, donusen: 1, oran: 50, deger: 1500 },
      { kaynak: "CSV", adet: 1, donusen: 0, oran: 0, deger: 0 },
      { kaynak: "Elle", adet: 1, donusen: 0, oran: 0, deger: 0 },
    ]);
    expect(r.summary).toEqual({ "Toplam aday": "4", "Genel dönüşüm (%)": "25" });
    // aralık dışı aday tüm zamanlarda görünür
    const all = await run("satis_kaynak", {});
    expect(all.rows.find((x) => x.kaynak === "Atricard")).toMatchObject({ adet: 3 });
  });

  it("kazanma oranı: ay ay, kapanış tarihine göre; aralık dışı kapanış girmez", async () => {
    const r = await run("satis_kazanma");
    expect(r.rows).toEqual([
      { ay: "2026-09", kazanilan: 2, kaybedilen: 0, oran: 100, kazanilanTutar: 5000, kaybedilenTutar: 0 },
      { ay: "2026-10", kazanilan: 1, kaybedilen: 1, oran: 50, kazanilanTutar: 2000, kaybedilenTutar: 500 },
    ]);
    expect(r.summary).toEqual({ Kazanılan: "3", Kaybedilen: "1", "Kazanma oranı (%)": "75", "Kazanılan tutar (₺)": "7000" });
  });

  it("kazanma oranı: kapanış yoksa oran '—', çökmez", async () => {
    const r = await run("satis_kazanma", { from: "2030-01-01", to: "2030-01-31" });
    expect(r.rows).toEqual([]);
    expect(r.summary).toMatchObject({ "Kazanma oranı (%)": "—" });
  });

  it("satışçı performansı: kişi bazında aday, açık fırsat, kazanılan, oran, görev; sahipsiz satırı", async () => {
    const r = await run("satis_performans");
    expect(r.rows).toEqual([
      { ad: "Burak", aday: 1, acik: 2, acikTutar: 1000, kazanilan: 1, kazanilanTutar: 4000, kaybedilen: 0, gorev: 1, oran: 100 },
      { ad: "Ayşe", aday: 3, acik: 0, acikTutar: 0, kazanilan: 2, kazanilanTutar: 3000, kaybedilen: 1, gorev: 2, oran: 66.7 },
      { ad: "Sahipsiz", aday: 0, acik: 1, acikTutar: 100, kazanilan: 0, kazanilanTutar: 0, kaybedilen: 0, gorev: 0, oran: "—" },
    ]);
    expect(r.summary).toEqual({ Satışçı: "2", "Kazanılan tutar (₺)": "7000" });
  });

  it("ortalama kapanış süresi: satışçı bazında, kazanılanlar için gün", async () => {
    const r = await run("satis_kapanis_suresi");
    expect(r.rows).toEqual([
      { ad: "Ayşe", adet: 2, ortalama: 5.5, enHizli: 3, enYavas: 8 },
      { ad: "Burak", adet: 1, ortalama: 15, enHizli: 15, enYavas: 15 },
    ]);
    expect(r.summary).toEqual({ "Kazanılan fırsat": "3", "Genel ortalama (gün)": "8.7" });
    const none = await run("satis_kapanis_suresi", { from: "2030-01-01", to: "2030-01-02" });
    expect(none.rows).toEqual([]);
    expect(none.summary).toMatchObject({ "Genel ortalama (gün)": "—" });
  });

  it("başka kiracının verisi raporlara girmez", async () => {
    const other = await seed("t2");
    const mine = await runReport("satis_huni", { tenantId: w.tenantId });
    const theirs = await runReport("satis_huni", { tenantId: other.tenantId });
    expect(mine.rows).toEqual(theirs.rows); // aynı veri, ama her biri kendi satırlarını sayar (2 kat değil)
    expect(mine.rows.find((x) => x.asama === "Kazanıldı")).toMatchObject({ adet: 4 });
  });

  it("aralık sınırları İstanbul gününe göre: gece yarısı sonrası kapanış doğru güne düşer", async () => {
    const r = reportRange({ from: "2026-10-04", to: "2026-10-04" });
    expect(r.from?.toISOString()).toBe("2026-10-03T21:00:00.000Z");
    expect(r.toExclusive?.toISOString()).toBe("2026-10-04T21:00:00.000Z");
    expect(reportRange({})).toEqual({ from: null, toExclusive: null });
  });

  it("yüzde: payda sıfırsa —, bir ondalık", () => {
    expect(percent(0, 0)).toBe("—");
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(3, 3)).toBe(100);
  });
});

describe("rapor görünürlüğü", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureReportsRegistered();
  });

  it("satış raporları satis_hepsi:read ister: Satışçı göremez, Yönetici/İzleyici görür", () => {
    const keys = (perms: string[], modules?: string[]) =>
      listReports(new Set(perms), modules ? new Set(modules) : undefined).map((r) => r.key).filter((k) => k.startsWith("satis_"));
    expect(keys(["raporlar:read", "satis_aday:read"], ["satis"])).toEqual([]);
    expect(keys(["satis_hepsi:read"], ["satis"]).sort()).toEqual(["satis_huni", "satis_kapanis_suresi", "satis_kaynak", "satis_kazanma", "satis_performans"]);
  });

  it("modül lisanslı değilse izin olsa bile görünmez (owner her izne sahip)", () => {
    const all = new Set(ALL_PERMISSIONS);
    expect(listReports(all, new Set(["dashboard", "muhasebe"])).some((r) => r.key.startsWith("satis_"))).toBe(false);
    expect(listReports(all, new Set(["satis"])).some((r) => r.key.startsWith("satis_"))).toBe(true);
    // lisans bilgisi verilmezse (eski çağıran) süzgeç uygulanmaz
    expect(listReports(all).some((r) => r.key.startsWith("satis_"))).toBe(true);
  });
});

describe("pano kartları", () => {
  it("sayılar görünürlüğe uyar; Satışçı kendi ve sahipsiz kayıtlarını sayar, yönetici hepsini", async () => {
    await resetDatabase();
    const w = await seed();
    const now = Date.now();
    // Tohum verisi sabit tarihli; "bu ay" gerçek saate bağlı olduğundan sonucu deterministik tutmak için temizle
    await dbAdmin.delete(crmDeals).where(eq(crmDeals.tenantId, w.tenantId));
    await dbAdmin.delete(crmLeads).where(eq(crmLeads.tenantId, w.tenantId));
    await dbAdmin.insert(crmLeads).values([
      { tenantId: w.tenantId, name: "yeni-a", ownerUserId: w.a, status: "new" },
      { tenantId: w.tenantId, name: "yeni-b", ownerUserId: w.b, status: "new" },
      { tenantId: w.tenantId, name: "yeni-sahipsiz", status: "new" },
    ]);
    const stageId = (await dbAdmin.select().from(crmStages).where(and(eq(crmStages.tenantId, w.tenantId), eq(crmStages.key, "kazanildi"))))[0]!.id;
    await dbAdmin.insert(crmDeals).values({ tenantId: w.tenantId, title: "bu-ay-a", stageId, ownerUserId: w.a, value: "250.00", closedAt: new Date(now) });

    const perms = new Set(["satis_aday:read", "satis_firsat:read", "satis_aktivite:read"]);
    const rep = await satisTiles({ tenantId: w.tenantId, userId: w.a, permissions: perms });
    const manager = await satisTiles({ tenantId: w.tenantId, userId: w.a, permissions: new Set([...perms, "satis_hepsi:read"]) });
    const tile = (tiles: typeof rep, label: string) => tiles.find((t) => t.label === label)!;

    // Satışçı: yeni-a + yeni-sahipsiz = 2; yönetici: üçü de = 3
    expect(tile(rep, "Yeni aday").value).toBe(2);
    expect(tile(manager, "Yeni aday").value).toBe(3);
    expect(String(tile(rep, "Bu ay kazanılan").value)).toMatch(/^1 · /);
    expect(String(tile(manager, "Bu ay kazanılan").value)).toMatch(/^1 · /);
    // başka satışçının bu ay kazandığı fırsat Satışçı'nın sayısına girmez
    await dbAdmin.insert(crmDeals).values({ tenantId: w.tenantId, title: "bu-ay-b", stageId, ownerUserId: w.b, value: "1000.00", closedAt: new Date(now) });
    expect(String((await satisTiles({ tenantId: w.tenantId, userId: w.a, permissions: perms })).find((t) => t.label === "Bu ay kazanılan")!.value)).toMatch(/^1 · /);
    expect(String((await satisTiles({ tenantId: w.tenantId, userId: w.a, permissions: new Set([...perms, "satis_hepsi:read"]) })).find((t) => t.label === "Bu ay kazanılan")!.value)).toMatch(/^2 · /);
    // izinsiz kart yok
    const none = await satisTiles({ tenantId: w.tenantId, userId: w.a, permissions: new Set(["satis_aday:read"]) });
    expect(none.map((t) => t.label)).toEqual(["Yeni aday"]);
  });
});
