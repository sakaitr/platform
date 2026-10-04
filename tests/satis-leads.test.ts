import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  crmActivities,
  crmContacts,
  crmDeals,
  crmDeletedExternal,
  crmLeads,
  crmQuotes,
  crmStages,
  subscriptions,
  tenants,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import {
  anonymizeLead,
  ConvertError,
  convertLead,
  createLeadIfNew,
  eraseExternalLead,
  removeLeads,
  updateLead,
} from "@/modules/satis/leads";
import { resetDatabase } from "./setup";

async function seedTenant(slug: string) {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
  await applySectorPack(t!.id, "satis_crm");
  return t!.id;
}

const create = (tenantId: string, input: Parameters<typeof createLeadIfNew>[2]) =>
  withTenant(tenantId, (tx) => createLeadIfNew(tx, tenantId, input));

describe("aday oluşturma ve tekilleştirme", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant("t1");
  });

  it("yeni aday: anahtarlar, puan ve sistem aktivitesi yazılır", async () => {
    const r = await create(tenantId, {
      name: "Mavi Tur", phone: "0532 000 00 00", email: "Deniz@X.co", website: "https://www.mavi.com", city: "Ankara", source: "manual",
    });
    expect(r.status).toBe("created");
    const [lead] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, tenantId));
    expect(lead).toMatchObject({
      phoneKey: "5320000000", emailKey: "deniz@x.co", websiteKey: "mavi.com", nameKey: "mavitur|ankara", score: 75, status: "new",
    });
    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.tenantId, tenantId));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ isSystem: true, subject: "Aday oluşturuldu" });
  });

  it("aynı telefon farklı yazımla gelince yeni kayıt açılmaz", async () => {
    const first = await create(tenantId, { name: "A", phone: "0532 000 00 00", source: "manual" });
    const second = await create(tenantId, { name: "B", phone: "+90 532 000 0000", source: "csv" });
    expect(second).toMatchObject({ status: "duplicate", reason: "phone" });
    if (first.status === "created" && second.status === "duplicate") expect(second.id).toBe(first.id);
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(1);
  });

  it("e-posta, web sitesi ve ad+şehir eşleşmesi de yinelenir", async () => {
    await create(tenantId, { name: "Mavi Tur", city: "İstanbul", email: "a@x.co", website: "mavi.com", source: "manual" });
    expect(await create(tenantId, { name: "Başka", email: "A@X.CO", source: "manual" })).toMatchObject({ status: "duplicate", reason: "email" });
    expect(await create(tenantId, { name: "Başka", website: "http://www.mavi.com/iletisim", source: "manual" })).toMatchObject({ status: "duplicate", reason: "website" });
    expect(await create(tenantId, { name: "MAVİ TUR", city: "istanbul", source: "manual" })).toMatchObject({ status: "duplicate", reason: "name" });
    expect(await create(tenantId, { name: "Mavi Tur", city: "Ankara", source: "manual" })).toMatchObject({ status: "created" });
  });

  it("aynı (kaynak, external_id) tekrar gelince duplicate; kaynaklar ayrı", async () => {
    const a = await create(tenantId, { name: "X Kişi", externalId: "ext-1", source: "atricard" });
    expect(await create(tenantId, { name: "Farklı ad", externalId: "ext-1", source: "atricard" })).toMatchObject({
      status: "duplicate", reason: "external", id: a.status === "created" ? a.id : "",
    });
    expect(await create(tenantId, { name: "Başka Kişi", externalId: "ext-1", source: "api" })).toMatchObject({ status: "created" });
  });

  it("telefondan eşleşen mevcut adaya external_id BAĞLANMAZ", async () => {
    await create(tenantId, { name: "Elle", phone: "05320000000", source: "manual" });
    const r = await create(tenantId, { name: "Atricard'dan", phone: "05320000000", externalId: "ext-9", source: "atricard" });
    expect(r.status).toBe("duplicate");
    const [lead] = await dbAdmin.select().from(crmLeads);
    expect(lead!.externalId).toBeNull();
    expect(lead!.source).toBe("manual");
  });

  it("mezar taşındaki kimlik yeniden doğmaz", async () => {
    await dbAdmin.insert(crmDeletedExternal).values({ tenantId, source: "atricard", externalId: "gone" });
    expect(await create(tenantId, { name: "Silinen", externalId: "gone", source: "atricard" })).toEqual({ status: "ignored", reason: "tombstone" });
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(0);
  });

  it("eşzamanlı aynı external_id: tek kayıt, diğeri duplicate", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => create(tenantId, { name: "Yarış", externalId: "race-1", source: "atricard" })),
    );
    expect(results.filter((r) => r.status === "created")).toHaveLength(1);
    expect(results.filter((r) => r.status === "duplicate")).toHaveLength(4);
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(1);
  });

  it("sıcaklık puanı belirler: HOT 80", async () => {
    await create(tenantId, { name: "Sıcak", email: "s@x.co", temperature: "hot", source: "atricard", externalId: "h" });
    const [lead] = await dbAdmin.select().from(crmLeads);
    expect(lead).toMatchObject({ score: 80, temperature: "hot" });
  });

  it("başka kiracıdaki aynı telefon çakışma sayılmaz", async () => {
    const other = await seedTenant("t2");
    await create(tenantId, { name: "A", phone: "05320000000", source: "manual" });
    expect(await create(other, { name: "A", phone: "05320000000", source: "manual" })).toMatchObject({ status: "created" });
  });

  it("güncelleme: anahtarlar yeniden hesaplanır, başka adayla çakışma reddedilir, kendisiyle çakışmaz", async () => {
    const a = await create(tenantId, { name: "A", phone: "05320000000", source: "manual" });
    const b = await create(tenantId, { name: "B", phone: "05330000000", source: "manual" });
    if (a.status !== "created" || b.status !== "created") throw new Error("seed");
    const same = await withTenant(tenantId, (tx) => updateLead(tx, tenantId, a.id, { name: "A2", phone: "0532 000 00 00" }));
    expect(same.status).toBe("updated");
    const clash = await withTenant(tenantId, (tx) => updateLead(tx, tenantId, b.id, { name: "B", phone: "+905320000000" }));
    expect(clash).toMatchObject({ status: "duplicate", id: a.id });
    const moved = await withTenant(tenantId, (tx) => updateLead(tx, tenantId, b.id, { name: "B", phone: "05340000000" }));
    expect(moved.status).toBe("updated");
    const [row] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, b.id));
    expect(row!.phoneKey).toBe("5340000000");
  });
});

describe("silme, mezar taşı ve anonimleştirme", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant("t1");
  });

  it("removeLeads: external_id'li adaya mezar taşı yazar, kişi ve aktiviteleri cascade siler", async () => {
    const a = await create(tenantId, { name: "A Kişi", externalId: "e1", source: "atricard" });
    const b = await create(tenantId, { name: "B Kişi", source: "manual" });
    if (a.status !== "created" || b.status !== "created") throw new Error("seed");
    await dbAdmin.insert(crmContacts).values({ tenantId, leadId: a.id, fullName: "Kişi" });
    const removed = await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [a.id, b.id]));
    expect(removed).toHaveLength(2);
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmContacts)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmActivities)).toHaveLength(0);
    const tomb = await dbAdmin.select().from(crmDeletedExternal);
    expect(tomb).toHaveLength(1);
    expect(tomb[0]).toMatchObject({ source: "atricard", externalId: "e1" });
  });

  it("removeLeads başka kiracının kimliğini silmez", async () => {
    const other = await seedTenant("t2");
    const x = await create(other, { name: "Diğer", source: "manual" });
    if (x.status !== "created") throw new Error("seed");
    expect(await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [x.id]))).toEqual([]);
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(1);
  });

  it("eraseExternalLead: fırsatı olmayan aday silinir ve mezar taşı yazılır", async () => {
    await create(tenantId, { name: "Silinecek", externalId: "e2", source: "atricard" });
    const r = await withTenant(tenantId, (tx) => eraseExternalLead(tx, tenantId, "atricard", "e2"));
    expect(r).toBe("deleted");
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("eraseExternalLead: kayıt yoksa yalnızca mezar taşı yazar", async () => {
    const r = await withTenant(tenantId, (tx) => eraseExternalLead(tx, tenantId, "atricard", "yok"));
    expect(r).toBe("not_found");
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
    // ve sonradan gelen created doğurmaz
    expect(await create(tenantId, { name: "Geç Gelen", externalId: "yok", source: "atricard" })).toMatchObject({ status: "ignored" });
  });

  it("eraseExternalLead: fırsatlı aday ANONİMLEŞİR; fırsat, teklif ve aktivite metni temizlenir", async () => {
    const created = await create(tenantId, {
      name: "Deniz Yılmaz", contactName: "Deniz", phone: "05320000000", email: "d@x.co", website: "d.com",
      city: "Ankara", message: "Teklif istiyorum", note: "özel not", eventName: "Fuar 2026",
      source: "atricard", externalId: "e3",
    });
    if (created.status !== "created") throw new Error("seed");
    const [stage] = await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, tenantId)).limit(1);
    const [deal] = await dbAdmin.insert(crmDeals).values({ tenantId, title: "Deniz Yılmaz: Web", stageId: stage!.id, leadId: created.id, note: "Deniz not" }).returning();
    await dbAdmin.insert(crmQuotes).values({ tenantId, dealId: deal!.id, number: "TKL-1", title: "Deniz Yılmaz teklifi", notes: "Deniz'e" });
    await dbAdmin.insert(crmActivities).values({ tenantId, type: "call", subject: "Deniz'i ara", note: "05320000000", leadId: created.id });
    await dbAdmin.insert(crmContacts).values({ tenantId, leadId: created.id, fullName: "Deniz" });

    const r = await withTenant(tenantId, (tx) => eraseExternalLead(tx, tenantId, "atricard", "e3"));
    expect(r).toBe("anonymized");

    const [lead] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, created.id));
    expect(lead).toMatchObject({
      name: "Silinen kayıt", contactName: null, phone: null, phoneKey: null, email: null, emailKey: null,
      website: null, websiteKey: null, nameKey: null, city: null, message: null, note: null, eventName: null,
    });
    const [d] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, deal!.id));
    expect(d).toMatchObject({ title: "Silinen kayıt", note: null });
    const [q] = await dbAdmin.select().from(crmQuotes).where(eq(crmQuotes.dealId, deal!.id));
    expect(q).toMatchObject({ title: "Silinen kayıt", notes: null });
    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.leadId, created.id));
    for (const a of acts) expect(a).toMatchObject({ subject: "Silinen kayıt", note: null });
    expect(await dbAdmin.select().from(crmContacts)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
    // anonimleşen adayın eski telefonu artık tekilleştirmede çıkmaz
    expect(await create(tenantId, { name: "Yeni", phone: "05320000000", source: "manual" })).toMatchObject({ status: "created" });
  });

  it("anonimleştirme başka adayın verisine dokunmaz", async () => {
    const a = await create(tenantId, { name: "A Kişi", phone: "05320000000", source: "manual" });
    const b = await create(tenantId, { name: "B Kişi", phone: "05330000000", source: "manual" });
    if (a.status !== "created" || b.status !== "created") throw new Error("seed");
    await withTenant(tenantId, (tx) => anonymizeLead(tx, tenantId, a.id));
    const [other] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, b.id));
    expect(other).toMatchObject({ name: "B Kişi", phone: "05330000000" });
  });
});

describe("müşteriye dönüştürme", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant("t1");
  });

  it("firma, kişi ve ilk açık aşamada fırsat oluşturur; aday converted olur", async () => {
    const c = await create(tenantId, {
      name: "Mavi Tur", contactName: "Deniz Yılmaz", phone: "05320000000", email: "d@x.co",
      service: "Web sitesi", estimatedValue: 15000, city: "Ankara", source: "manual",
    });
    if (c.status !== "created") throw new Error("seed");
    const out = await withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null));

    const [company] = await dbAdmin.select().from(companies).where(eq(companies.id, out.companyId));
    expect(company).toMatchObject({ name: "Mavi Tur", type: "musteri", phone: "05320000000", email: "d@x.co" });
    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, out.dealId));
    expect(deal).toMatchObject({ title: "Mavi Tur: Web sitesi", value: "15000.00", companyId: out.companyId, leadId: c.id });
    const [firstOpen] = await dbAdmin.select().from(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.key, "yeni")));
    expect(deal!.stageId).toBe(firstOpen!.id);
    const contacts = await dbAdmin.select().from(crmContacts).where(eq(crmContacts.leadId, c.id));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ fullName: "Deniz Yılmaz", companyId: out.companyId });
    const [lead] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, c.id));
    expect(lead).toMatchObject({ status: "converted", convertedCompanyId: out.companyId });
  });

  it("hizmet yoksa fırsat başlığı 'Satış fırsatı'; kişi adı firma adıyla aynıysa kişi açılmaz", async () => {
    const c = await create(tenantId, { name: "Deniz Yılmaz", source: "manual" });
    if (c.status !== "created") throw new Error("seed");
    const out = await withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null));
    const [deal] = await dbAdmin.select().from(crmDeals).where(eq(crmDeals.id, out.dealId));
    expect(deal!.title).toBe("Deniz Yılmaz: Satış fırsatı");
    expect(await dbAdmin.select().from(crmContacts)).toHaveLength(0);
  });

  it("ikinci dönüştürme already_converted (409) ve ikinci firma açmaz", async () => {
    const c = await create(tenantId, { name: "Mavi Tur", source: "manual" });
    if (c.status !== "created") throw new Error("seed");
    await withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null));
    await expect(withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null))).rejects.toMatchObject({
      code: "already_converted",
    });
    expect(await dbAdmin.select().from(companies)).toHaveLength(1);
  });

  it("eşzamanlı iki dönüştürme: yalnız biri başarılı olur", async () => {
    const c = await create(tenantId, { name: "Mavi Tur", source: "manual" });
    if (c.status !== "created") throw new Error("seed");
    const results = await Promise.allSettled([
      withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null)),
      withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await dbAdmin.select().from(companies)).toHaveLength(1);
    expect(await dbAdmin.select().from(crmDeals)).toHaveLength(1);
  });

  it("açık aşama yoksa hata verir ve hiçbir şey yazmaz (transaction bütünlüğü)", async () => {
    const c = await create(tenantId, { name: "Mavi Tur", source: "manual" });
    if (c.status !== "created") throw new Error("seed");
    await dbAdmin.delete(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.kind, "open")));
    await expect(withTenant(tenantId, (tx) => convertLead(tx, tenantId, c.id, null))).rejects.toBeInstanceOf(ConvertError);
    expect(await dbAdmin.select().from(companies)).toHaveLength(0);
    const [lead] = await dbAdmin.select().from(crmLeads).where(eq(crmLeads.id, c.id));
    expect(lead!.status).toBe("new");
  });

  it("olmayan aday not_found", async () => {
    await expect(
      withTenant(tenantId, (tx) => convertLead(tx, tenantId, "00000000-0000-0000-0000-000000000000", null)),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
