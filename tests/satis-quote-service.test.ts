import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmActivities, crmDeals, crmQuotes, numberingSequences, subscriptions, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { applySectorPack } from "@/lib/sector/install";
import { createDeal } from "@/modules/satis/deals";
import {
  createQuote,
  deleteDraftQuote,
  duplicateQuote,
  QuoteError,
  setQuoteStatus,
  updateQuote,
} from "@/modules/satis/quote-service";
import type { QuoteItem } from "@/modules/satis/quotes";
import { resetDatabase } from "./setup";

const items: QuoteItem[] = [
  { name: "Web sitesi", qty: "1", unitPrice: "10000.00", vatRate: "20" },
  { name: "Bakım", qty: "12", unitPrice: "500.00", vatRate: "20" },
];

async function seed(pack = "satis_crm", slug = "t1") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: pack, sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
  await applySectorPack(t!.id, pack);
  const dealId = await withTenant(t!.id, (tx) => createDeal(tx, t!.id, { title: "Fırsat" }).catch(async () => {
    throw new Error("deal seed");
  }));
  return { tenantId: t!.id, dealId };
}

describe("teklif servisi", () => {
  let tenantId: string;
  let dealId: string;
  beforeEach(async () => {
    await resetDatabase();
    ({ tenantId, dealId } = await seed());
  });

  const create = (title = "Teklif", list: readonly QuoteItem[] = items) =>
    withTenant(tenantId, (tx) => createQuote(tx, tenantId, dealId, { title, items: list }, null));

  it("numara üretir, toplamı kalemlerden hesaplar ve zaman çizelgesine yazar", async () => {
    const q = await create();
    expect(q.number).toMatch(/^TKL\d{4}-00001$/);
    const [row] = await dbAdmin.select().from(crmQuotes).where(eq(crmQuotes.id, q.id));
    expect(row).toMatchObject({ status: "draft", total: "19200.00", currency: "TRY", dealId });
    expect(row!.items).toEqual(items);
    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId));
    expect(acts.map((a) => a.subject)).toContain(`Teklif oluşturuldu: ${q.number}`);
  });

  it("numaralar ardışık ve eşzamanlı üretimde çakışmaz", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`T${i}`)));
    const serials = results.map((r) => Number(r.number.slice(-5))).sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("numara dizisi olmayan pakete açılmış satis modülünde dizi otomatik kurulur", async () => {
    await resetDatabase();
    const turizm = await seed("turizm", "tur");
    // turizm paketinde teklif dizisi yok
    expect(
      await dbAdmin.select().from(numberingSequences).where(and(eq(numberingSequences.tenantId, turizm.tenantId), eq(numberingSequences.sequenceKey, "teklif"))),
    ).toHaveLength(0);
    const q = await withTenant(turizm.tenantId, (tx) => createQuote(tx, turizm.tenantId, turizm.dealId, { title: "T", items }, null));
    expect(q.number).toMatch(/^TKL\d{4}-00001$/);
  });

  it("kalemsiz teklif ve olmayan fırsat reddedilir; başka kiracının fırsatına teklif açılamaz", async () => {
    await expect(create("T", [])).rejects.toMatchObject({ code: "no_items" });
    await expect(
      withTenant(tenantId, (tx) => createQuote(tx, tenantId, "00000000-0000-0000-0000-000000000000", { title: "T", items }, null)),
    ).rejects.toMatchObject({ code: "not_found" });
    const other = await seed("satis_crm", "t2");
    await expect(
      withTenant(tenantId, (tx) => createQuote(tx, tenantId, other.dealId, { title: "T", items }, null)),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await dbAdmin.select().from(crmQuotes)).toHaveLength(0);
  });

  it("taslak düzenlenir, toplam yeniden hesaplanır", async () => {
    const q = await create();
    await withTenant(tenantId, (tx) =>
      updateQuote(tx, tenantId, q.id, { title: "Yeni başlık", items: [{ name: "X", qty: "2", unitPrice: "100.00", vatRate: "10" }], notes: " not " }),
    );
    const [row] = await dbAdmin.select().from(crmQuotes).where(eq(crmQuotes.id, q.id));
    expect(row).toMatchObject({ title: "Yeni başlık", total: "220.00", notes: "not" });
  });

  it("gönderilince düzenleme ve silme kilitlenir", async () => {
    const q = await create();
    await withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "sent", null));
    await expect(withTenant(tenantId, (tx) => updateQuote(tx, tenantId, q.id, { title: "x", items }))).rejects.toMatchObject({ code: "locked" });
    await expect(withTenant(tenantId, (tx) => deleteDraftQuote(tx, tenantId, q.id))).rejects.toMatchObject({ code: "locked" });
    const [row] = await dbAdmin.select().from(crmQuotes).where(eq(crmQuotes.id, q.id));
    expect(row!.title).toBe("Teklif");
  });

  it("durum geçişleri: taslak→gönderildi→kabul/ret; geri dönüş yok", async () => {
    const q = await create();
    await expect(withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "accepted", null))).rejects.toMatchObject({ code: "bad_transition" });
    await withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "sent", null));
    await expect(withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "draft", null))).rejects.toMatchObject({ code: "bad_transition" });
    const accepted = await withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "accepted", null));
    expect(accepted.from).toBe("sent");
    await expect(withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "rejected", null))).rejects.toMatchObject({ code: "bad_transition" });
    const acts = await dbAdmin.select().from(crmActivities).where(eq(crmActivities.dealId, dealId));
    const subjects = acts.map((a) => a.subject);
    expect(subjects).toContain(`Teklif gönderildi: ${q.number}`);
    expect(subjects).toContain(`Teklif kabul edildi: ${q.number}`);
  });

  it("yeni sürüm: kopya yeni numaralı taslak olur, eskisi olduğu gibi kalır", async () => {
    const q = await create("Teklif v1");
    await withTenant(tenantId, (tx) => setQuoteStatus(tx, tenantId, q.id, "sent", null));
    const copy = await withTenant(tenantId, (tx) => duplicateQuote(tx, tenantId, q.id, null));
    expect(copy.number).not.toBe(q.number);
    expect(copy.number).toMatch(/00002$/);
    const rows = await dbAdmin.select().from(crmQuotes).where(eq(crmQuotes.dealId, dealId));
    expect(rows.find((r) => r.id === q.id)!.status).toBe("sent");
    const fresh = rows.find((r) => r.id === copy.id)!;
    expect(fresh).toMatchObject({ status: "draft", title: "Teklif v1", total: "19200.00" });
  });

  it("taslak silinir, olmayan teklif not_found", async () => {
    const q = await create();
    await withTenant(tenantId, (tx) => deleteDraftQuote(tx, tenantId, q.id));
    expect(await dbAdmin.select().from(crmQuotes)).toHaveLength(0);
    await expect(withTenant(tenantId, (tx) => deleteDraftQuote(tx, tenantId, q.id))).rejects.toBeInstanceOf(QuoteError);
  });

  it("başka kiracının teklifi değiştirilemez", async () => {
    const q = await create();
    const other = await seed("satis_crm", "t2");
    await expect(withTenant(other.tenantId, (tx) => setQuoteStatus(tx, other.tenantId, q.id, "sent", null))).rejects.toMatchObject({ code: "not_found" });
    await expect(withTenant(other.tenantId, (tx) => updateQuote(tx, other.tenantId, q.id, { title: "x", items }))).rejects.toMatchObject({ code: "not_found" });
  });

  it("fırsat silinince teklifleri de gider (cascade)", async () => {
    await create();
    await dbAdmin.delete(crmDeals).where(eq(crmDeals.id, dealId));
    expect(await dbAdmin.select().from(crmQuotes)).toHaveLength(0);
  });
});
