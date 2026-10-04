import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmDeals, crmDeletedExternal, crmIntegrations, crmLeads, crmWebhookDeliveries, subscriptions, tenantModules, tenants, users } from "@/db/schema";
import { encryptSecret } from "@/lib/secret-box";
import { applySectorPack } from "@/lib/sector/install";
import {
  importAgnoExport,
  mapActivityType,
  mapSource,
  mapStage,
  mapStatus,
  parseAmount,
  parseDate,
  type StageRef,
} from "@/modules/satis/import-agno";
import { resetDatabase } from "./setup";

const stages: StageRef[] = [
  { id: "s1", label: "Yeni", kind: "open" },
  { id: "s2", label: "Teklif", kind: "open" },
  { id: "s3", label: "Kazanıldı", kind: "won" },
  { id: "s4", label: "Kaybedildi", kind: "lost" },
];

describe("Agno CRM eşleme tabloları (saf)", () => {
  it("kaynak: Atricard kimliği korunur, diğerleri api + agno:<id>", () => {
    expect(mapSource({ id: "7", source: "ATRICARD", externalId: "abc" })).toEqual({ source: "atricard", externalId: "abc", label: null });
    expect(mapSource({ id: "7", source: "atricard", externalId: null })).toMatchObject({ source: "api", externalId: "agno:7" });
    expect(mapSource({ id: "8", source: "MAPS", externalId: "x" })).toEqual({ source: "api", externalId: "agno:8", label: "MAPS" });
    expect(mapSource({ id: "9", source: null, externalId: null })).toEqual({ source: "api", externalId: "agno:9", label: null });
  });

  it.each([
    ["NEW", "new", true], ["Yeni", "new", true], [null, "new", true], ["", "new", true],
    ["CONTACTED", "contacted", true], ["Arandı", "contacted", true], ["görüşüldü", "contacted", true],
    ["QUOTED", "qualified", true], ["Nitelikli", "qualified", true],
    ["LOST", "disqualified", true], ["Kaybedildi", "disqualified", true],
    ["WON", "converted", true], ["Kazanıldı", "converted", true],
    ["BİLİNMEYEN", "new", false], ["xyz", "new", false],
  ])("durum %s → %s (tanındı: %s)", (raw, status, recognized) => {
    expect(mapStatus(raw as string | null)).toEqual({ status, recognized });
  });

  it("aktivite türü: Türkçe/İngilizce, bilinmeyen not olur", () => {
    expect(mapActivityType("CALL")).toBe("call");
    expect(mapActivityType("Arama")).toBe("call");
    expect(mapActivityType("toplantı")).toBe("meeting");
    expect(mapActivityType("E-posta")).toBe("email");
    expect(mapActivityType("Görev")).toBe("task");
    expect(mapActivityType("tuhaf")).toBe("note");
    expect(mapActivityType(null)).toBe("note");
  });

  it("aşama: ada göre, kazanıldı/kaybedildi eş anlamlıları, aksi halde ilk açık aşama", () => {
    expect(mapStage("teklif", stages)).toEqual({ stage: stages[1], matched: true });
    expect(mapStage("TEKLİF", stages).stage?.id).toBe("s2");
    expect(mapStage("WON", stages)).toEqual({ stage: stages[2], matched: true });
    expect(mapStage("kazanilan", stages).stage?.id).toBe("s3");
    expect(mapStage("LOST", stages).stage?.id).toBe("s4");
    expect(mapStage("Müzakere", stages)).toEqual({ stage: stages[0], matched: false });
    expect(mapStage(null, stages)).toEqual({ stage: stages[0], matched: true });
    expect(mapStage("x", [])).toEqual({ stage: null, matched: false });
  });

  it("tarih ve tutar ayrıştırma bozuk girdide çökmez", () => {
    const fb = new Date("2026-01-01T00:00:00Z");
    expect(parseDate("2026-03-04T10:00:00Z", fb).toISOString()).toBe("2026-03-04T10:00:00.000Z");
    expect(parseDate("bozuk", fb)).toBe(fb);
    expect(parseDate(null, fb)).toBe(fb);
    expect(parseAmount(1250.5)).toBe("1250.50");
    expect(parseAmount("1250,5")).toBe("1250.50");
    expect(parseAmount("abc")).toBe("0.00");
    expect(parseAmount(-5)).toBe("0.00");
    expect(parseAmount(null)).toBe("0.00");
  });
});

async function seedTenant(slug = "agno") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(t!.id, "satis_crm");
  return t!.id;
}

const baseExport = () => ({
  format: "agno-crm-export" as const,
  version: 1 as const,
  leads: [
    { id: 1, name: "Mavi Tur", contactName: "Deniz", phone: "0532 000 00 01", email: "d@mavi.test", source: "ATRICARD", externalId: "atr-1", status: "CONTACTED", score: 80, createdAt: "2026-03-01T09:00:00Z", ownerEmail: "satis@agno.test", interestedService: "Web", note: "ilk not" },
    { id: 2, name: "Yeşil Lojistik", phone: "0532 000 00 02", source: "MAPS", website: "https://yesil.test", score: 250, status: "WEIRD", city: "Ankara", address: "Çankaya", createdAt: "2026-03-02T09:00:00Z" },
    { id: 3, name: "Silinen Kişi", phone: "0532 000 00 03", source: "ATRICARD", externalId: "atr-gone" },
  ],
  deals: [
    { id: 10, leadId: 1, title: "Mavi Tur: Web", stage: "WON", value: 5000, createdAt: "2026-03-05T09:00:00Z", closedAt: "2026-03-20T09:00:00Z" },
    { id: 11, leadId: 2, title: "Yeşil: Depo", stage: "Müzakere", value: "1.5", ownerEmail: "bilinmeyen@agno.test" },
    { id: 12, leadId: 3, title: "Silinen fırsat", stage: "NEW", value: 9 },
    { id: 13, leadId: 2, title: "Kayıp", stage: "LOST", lostReason: "Bütçe" },
  ],
  activities: [
    { id: 100, leadId: 1, type: "CALL", subject: "İlk görüşme", note: "arandı", createdAt: "2026-03-03T09:00:00Z" },
    { id: 101, dealId: 10, type: "Görev", subject: "Sözleşme", dueAt: "2026-03-10T09:00:00Z", createdAt: "2026-03-06T09:00:00Z" },
    { id: 102, leadId: 3, type: "NOTE", subject: "Silinen kişinin notu" },
    { id: 103, type: "NOTE", subject: "Bağlantısız" },
  ],
  deletedExternal: [{ source: "ATRICARD", externalId: "atr-gone" }],
});

describe("Agno CRM içe aktarma", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
    await dbAdmin.insert(users).values({ tenantId, email: "Satis@Agno.test", name: "Satışçı", passwordHash: "x" });
  });

  const leadsOf = () => dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, tenantId));
  const dealsOf = () => dbAdmin.select().from(crmDeals).where(eq(crmDeals.tenantId, tenantId));

  it("DENEME: hiçbir şey yazmaz ama gerçek sonucu raporlar", async () => {
    const report = await importAgnoExport(tenantId, baseExport(), { apply: false });
    expect(report.mode).toBe("deneme");
    expect(report.leads).toMatchObject({ toplam: 3, olusturuldu: 2, mezarTasi: 1 });
    expect(await leadsOf()).toHaveLength(0);
    expect(await dealsOf()).toHaveLength(0);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmActivities).where(eq(crmActivities.type, "call"))).toHaveLength(0);
  });

  it("UYGULA: adaylar, fırsatlar, aktiviteler ve mezar taşı eşlemeyle yazılır", async () => {
    const report = await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(report.mode).toBe("uygulandi");
    expect(report.leads).toEqual({ toplam: 3, olusturuldu: 2, zatenVar: 0, yinelenen: 0, mezarTasi: 1, gecersiz: 0 });
    expect(report.deals).toMatchObject({ toplam: 4, olusturuldu: 3, gecersiz: 0 });
    expect(report.activities).toMatchObject({ toplam: 4, olusturuldu: 2, baglantisiz: 1 });
    expect(report.mezarTaslari).toBe(1);

    const byName = Object.fromEntries((await leadsOf()).map((l) => [l.name, l]));
    expect(byName["Mavi Tur"]).toMatchObject({
      source: "atricard", externalId: "atr-1", status: "contacted", score: 80, service: "Web", note: "ilk not",
      phoneKey: "5320000001", emailKey: "d@mavi.test",
    });
    expect(byName["Mavi Tur"]!.createdAt.toISOString()).toBe("2026-03-01T09:00:00.000Z");
    expect(byName["Mavi Tur"]!.ownerUserId).not.toBeNull(); // e-posta büyük/küçük harf fark etmeden eşleşti
    expect(byName["Yeşil Lojistik"]).toMatchObject({ source: "api", externalId: "agno:2", status: "new", score: 100, city: "Ankara", websiteKey: "yesil.test", ownerUserId: null });
    expect(byName["Yeşil Lojistik"]!.note).toContain("Agno CRM kaynağı: MAPS");
    expect(byName["Yeşil Lojistik"]!.note).toContain("Adres: Çankaya");
    expect(byName["Silinen Kişi"]).toBeUndefined();
    expect(report.taninmayanDurumlar).toEqual({ WEIRD: 1 });

    const deals = Object.fromEntries((await dealsOf()).map((d) => [d.title, d]));
    expect(deals["Mavi Tur: Web"]).toMatchObject({ value: "5000.00" });
    expect(deals["Mavi Tur: Web"]!.closedAt?.toISOString()).toBe("2026-03-20T09:00:00.000Z");
    expect(deals["Yeşil: Depo"]).toMatchObject({ value: "1.50", closedAt: null, ownerUserId: null });
    expect(deals["Kayıp"]).toMatchObject({ lostReason: "Bütçe" });
    expect(deals["Kayıp"]!.closedAt).not.toBeNull();
    expect(deals["Silinen fırsat"]).toBeUndefined();
    expect(report.eslesmeyenAsamalar).toEqual({ Müzakere: 1 });
    expect(report.eslesmeyenSahipler).toEqual(["bilinmeyen@agno.test"]);
    expect(report.uyarilar.length).toBe(2);

    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.tenantId, tenantId));
    const imported = acts.filter((a) => !a.isSystem);
    expect(imported.map((a) => a.subject).sort()).toEqual(["Sözleşme", "İlk görüşme"]);
    expect(imported.find((a) => a.subject === "İlk görüşme")).toMatchObject({ type: "call", note: "arandı" });
    const task = imported.find((a) => a.subject === "Sözleşme")!;
    expect(task).toMatchObject({ type: "task", doneAt: null });
    expect(task.dealId).toBe(deals["Mavi Tur: Web"]!.id);
    expect(imported.some((a) => a.subject.includes("Silinen kişinin"))).toBe(false);

    expect(await dbAdmin.select().from(crmDeletedExternal)).toEqual([expect.objectContaining({ source: "atricard", externalId: "atr-gone" })]);
  });

  it("İDEMPOTENT: aynı dosya ikinci kez hiçbir yeni kayıt açmaz", async () => {
    await importAgnoExport(tenantId, baseExport(), { apply: true });
    const before = { leads: (await leadsOf()).length, deals: (await dealsOf()).length, acts: (await dbAdmin.select().from(crmActivities)).length };
    const again = await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(again.leads).toMatchObject({ olusturuldu: 0, zatenVar: 2, mezarTasi: 1 });
    expect(again.deals).toMatchObject({ olusturuldu: 0, zatenVar: 3 });
    expect(again.activities).toMatchObject({ olusturuldu: 0, zatenVar: 2 });
    expect({ leads: (await leadsOf()).length, deals: (await dealsOf()).length, acts: (await dbAdmin.select().from(crmActivities)).length }).toEqual(before);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("İDEMPOTENT: tarihi olmayan aktivite de ikinci çalıştırmada tekrar açılmaz", async () => {
    const data = {
      format: "agno-crm-export" as const, version: 1 as const,
      leads: [{ id: 1, name: "Mavi Tur" }],
      deals: [{ id: 1, leadId: 1, title: "Mavi: Web" }],
      activities: [{ id: 1, leadId: 1, type: "CALL", subject: "Aradım" }, { id: 2, dealId: 1, type: "NOTE", subject: "Fırsat notu" }],
    };
    await importAgnoExport(tenantId, data, { apply: true, now: new Date("2026-05-01T10:00:00Z") });
    const again = await importAgnoExport(tenantId, data, { apply: true, now: new Date("2026-06-01T10:00:00Z") });
    expect(again.activities).toMatchObject({ olusturuldu: 0, zatenVar: 2 });
    const imported = (await dbAdmin.select().from(crmActivities).where(eq(crmActivities.tenantId, tenantId))).filter((a) => !a.isSystem);
    expect(imported).toHaveLength(2);
  });

  it("yinelenen: telefon eşleşen mevcut adaya yeni kayıt açılmaz, fırsat o adaya bağlanır", async () => {
    const [existing] = await dbAdmin
      .insert(crmLeads)
      .values({ tenantId, name: "Elle girilmiş", phone: "05320000001", phoneKey: "5320000001", source: "manual" })
      .returning();
    const report = await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(report.leads).toMatchObject({ olusturuldu: 1, yinelenen: 1 });
    expect(await leadsOf()).toHaveLength(2); // elle + Yeşil
    const deal = (await dealsOf()).find((d) => d.title === "Mavi Tur: Web")!;
    expect(deal.leadId).toBe(existing!.id);
    // mevcut adaya Agno kimliği bağlanmaz
    expect((await leadsOf()).find((l) => l.id === existing!.id)).toMatchObject({ source: "manual", externalId: null });
  });

  it("mezar taşı: kişi kiracıda zaten mezar taşındaysa aday ve çocukları atlanır", async () => {
    await dbAdmin.insert(crmDeletedExternal).values({ tenantId, source: "atricard", externalId: "atr-1" });
    const report = await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(report.leads).toMatchObject({ olusturuldu: 1, mezarTasi: 2 });
    expect((await dealsOf()).map((d) => d.title).sort()).toEqual(["Kayıp", "Yeşil: Depo"]);
  });

  it("giden webhook olayı üretmez (toplu taşıma olay yağmuru yaratmaz)", async () => {
    const id = randomUUID();
    await dbAdmin.insert(crmIntegrations).values({
      id, tenantId, kind: "webhook_outbound", name: "H", url: "https://hooks.example.test/in",
      secretEnc: encryptSecret("whsec_x", id), events: ["lead.created", "deal.won", "lead.deleted"], enabled: true, consentAt: new Date(),
    });
    await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(await dbAdmin.select().from(crmWebhookDeliveries)).toHaveLength(0);
  });

  it("geçersiz satırlar sayılır ve diğerlerini durdurmaz", async () => {
    const data = baseExport();
    data.leads.push({ id: 4 } as never, { id: 5, name: "" } as never, 7 as never);
    const report = await importAgnoExport(tenantId, data, { apply: true });
    expect(report.leads).toMatchObject({ olusturuldu: 2, gecersiz: 3 });
    expect(report.hatalar.length).toBe(3);
  });

  it("biçimi bozuk dosya reddedilir, hiçbir şey yazılmaz", async () => {
    for (const bad of [null, {}, { format: "baska", version: 1, leads: [] }, { format: "agno-crm-export", version: 2, leads: [] }, { format: "agno-crm-export", version: 1 }]) {
      await expect(importAgnoExport(tenantId, bad, { apply: true })).rejects.toThrow(/biçimi geçersiz/);
    }
    expect(await leadsOf()).toHaveLength(0);
  });

  it("max_leads sınırı aşılacaksa durur; --ignore-limit ile geçer", async () => {
    await dbAdmin.update(tenantModules).set({ limits: { max_leads: 1 } }).where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, "satis")));
    await expect(importAgnoExport(tenantId, baseExport(), { apply: true })).rejects.toThrow(/en fazla 1 aday/);
    expect(await leadsOf()).toHaveLength(0);
    const report = await importAgnoExport(tenantId, baseExport(), { apply: true, ignoreLimit: true });
    expect(report.leads.olusturuldu).toBe(2);
  });

  it("pipeline'da hiç aşama yoksa fırsatlar aktarılamaz, rapor açık hata verir; adaylar etkilenmez", async () => {
    await dbAdmin.execute((await import("drizzle-orm")).sql`DELETE FROM crm_stages WHERE tenant_id = ${tenantId}`);
    const report = await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(report.leads.olusturuldu).toBe(2);
    expect(report.deals.olusturuldu).toBe(0);
    expect(report.deals.gecersiz).toBeGreaterThanOrEqual(1);
    expect(report.hatalar.some((e) => /aşaması yok/.test(e))).toBe(true);
    expect(await dealsOf()).toHaveLength(0);
    expect(await leadsOf()).toHaveLength(2);
  });

  it("başka kiracıya sızmaz: kaynak veri yalnız hedef kiracıya yazılır", async () => {
    const other = await seedTenant("diger");
    await importAgnoExport(tenantId, baseExport(), { apply: true });
    expect(await dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, other))).toHaveLength(0);
  });
});
