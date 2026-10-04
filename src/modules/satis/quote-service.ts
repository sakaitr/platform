import { and, eq } from "drizzle-orm";
import { crmDeals, crmQuotes, numberingSequences } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { nextNumber } from "@/lib/numbering";
import { logSystemActivity } from "./leads";
import { canTransition, computeQuote, isEditable, type QuoteItem, type QuoteStatus } from "./quotes";

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "locked" | "bad_transition" | "no_items",
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

export const QUOTE_SEQUENCE = "teklif";

/**
 * `teklif` numara dizisi satis_crm paketiyle gelir. `satis` modülü başka bir pakete sonradan
 * açılmışsa dizi yoktur: eksikse varsayılanla oluşturulur (idempotent, çakışmada dokunmaz).
 */
async function ensureSequence(tx: TenantTx, tenantId: string): Promise<void> {
  await tx
    .insert(numberingSequences)
    .values({ tenantId, sequenceKey: QUOTE_SEQUENCE, prefix: "TKL", padding: 5, periodReset: "yearly" })
    .onConflictDoNothing();
}

export type QuoteInput = {
  title: string;
  items: readonly QuoteItem[];
  validUntil?: Date | null;
  notes?: string | null;
};

/** Toplam her zaman kalemlerden yeniden hesaplanır; istemci toplamı kullanılmaz. */
function totalOf(items: readonly QuoteItem[]): string {
  return computeQuote(items).total;
}

export async function createQuote(
  tx: TenantTx,
  tenantId: string,
  dealId: string,
  input: QuoteInput,
  userId: string | null,
): Promise<{ id: string; number: string }> {
  if (input.items.length === 0) throw new QuoteError("Teklifte en az bir kalem olmalı.", "no_items");
  const [deal] = await tx
    .select({ id: crmDeals.id, leadId: crmDeals.leadId, currency: crmDeals.currency })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)));
  if (!deal) throw new QuoteError("Fırsat bulunamadı.", "not_found");

  await ensureSequence(tx, tenantId);
  const number = await nextNumber(tx, tenantId, QUOTE_SEQUENCE);
  const [row] = await tx
    .insert(crmQuotes)
    .values({
      tenantId,
      dealId,
      number,
      title: input.title.trim(),
      status: "draft",
      items: input.items as QuoteItem[],
      total: totalOf(input.items),
      currency: deal.currency,
      validUntil: input.validUntil ?? null,
      notes: input.notes?.trim() || null,
      createdBy: userId,
    })
    .returning({ id: crmQuotes.id });

  await logSystemActivity(tx, tenantId, {
    dealId,
    leadId: deal.leadId,
    subject: `Teklif oluşturuldu: ${number}`,
    userId,
  });
  return { id: row!.id, number };
}

async function lockQuote(tx: TenantTx, tenantId: string, id: string) {
  const [quote] = await tx
    .select()
    .from(crmQuotes)
    .where(and(eq(crmQuotes.tenantId, tenantId), eq(crmQuotes.id, id)))
    .for("update")
    .limit(1);
  if (!quote) throw new QuoteError("Teklif bulunamadı.", "not_found");
  return quote;
}

/** Yalnız taslak düzenlenir. Gönderilmiş teklif için `duplicateQuote` (yeni sürüm). */
export async function updateQuote(tx: TenantTx, tenantId: string, id: string, input: QuoteInput): Promise<void> {
  const quote = await lockQuote(tx, tenantId, id);
  if (!isEditable(quote.status)) {
    throw new QuoteError("Gönderilmiş teklif düzenlenemez. Yeni sürüm oluşturun.", "locked");
  }
  if (input.items.length === 0) throw new QuoteError("Teklifte en az bir kalem olmalı.", "no_items");
  await tx
    .update(crmQuotes)
    .set({
      title: input.title.trim(),
      items: input.items as QuoteItem[],
      total: totalOf(input.items),
      validUntil: input.validUntil ?? null,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(crmQuotes.tenantId, tenantId), eq(crmQuotes.id, id)));
}

export async function setQuoteStatus(
  tx: TenantTx,
  tenantId: string,
  id: string,
  to: QuoteStatus,
  userId: string | null,
): Promise<{ number: string; dealId: string; from: QuoteStatus }> {
  const quote = await lockQuote(tx, tenantId, id);
  if (!canTransition(quote.status, to)) {
    throw new QuoteError("Teklifin durumu bu şekilde değiştirilemez.", "bad_transition");
  }
  if (to === "sent" && (quote.items as QuoteItem[]).length === 0) {
    throw new QuoteError("Kalemi olmayan teklif gönderilemez.", "no_items");
  }
  await tx
    .update(crmQuotes)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(crmQuotes.tenantId, tenantId), eq(crmQuotes.id, id)));
  const [deal] = await tx
    .select({ leadId: crmDeals.leadId })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, quote.dealId)));
  const label = { sent: "gönderildi", accepted: "kabul edildi", rejected: "reddedildi", draft: "taslak" }[to];
  await logSystemActivity(tx, tenantId, {
    dealId: quote.dealId,
    leadId: deal?.leadId ?? null,
    subject: `Teklif ${label}: ${quote.number}`,
    userId,
  });
  return { number: quote.number, dealId: quote.dealId, from: quote.status };
}

/** Yeni sürüm: kalemleri kopyalar, yeni numara alır, taslak olarak açılır. Eski teklif olduğu gibi kalır. */
export async function duplicateQuote(
  tx: TenantTx,
  tenantId: string,
  id: string,
  userId: string | null,
): Promise<{ id: string; number: string }> {
  const source = await lockQuote(tx, tenantId, id);
  return createQuote(
    tx,
    tenantId,
    source.dealId,
    {
      title: source.title,
      items: source.items as QuoteItem[],
      validUntil: source.validUntil,
      notes: source.notes,
    },
    userId,
  );
}

export async function deleteDraftQuote(tx: TenantTx, tenantId: string, id: string): Promise<void> {
  const quote = await lockQuote(tx, tenantId, id);
  if (!isEditable(quote.status)) {
    throw new QuoteError("Gönderilmiş teklif silinemez.", "locked");
  }
  await tx.delete(crmQuotes).where(and(eq(crmQuotes.tenantId, tenantId), eq(crmQuotes.id, id)));
}
