"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { requireModule } from "@/lib/auth";
import { findVisibleDealIds, findVisibleQuoteIds } from "./access";
import { requireCapability } from "./guards";
import {
  createQuote,
  deleteDraftQuote,
  duplicateQuote,
  QuoteError,
  setQuoteStatus,
  updateQuote,
} from "./quote-service";
import { normalizeItems, type QuoteStatus } from "./quotes";
import { followUpFromDate } from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

const RawItems = z
  .array(
    z.object({
      name: z.string().max(1000),
      qty: z.string().max(40),
      unitPrice: z.string().max(40),
      vatRate: z.string().max(10),
    }),
  )
  .max(200);

const QuoteFormSchema = z.object({
  id: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Teklif başlığı en az 2 karakter olmalı.").max(255, "Başlık en fazla 255 karakter olabilir."),
  validUntil: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Geçerlilik tarihi geçersiz.")
    .transform((v) => (v === "" ? null : v)),
  notes: z.string().trim().max(4000, "Not en fazla 4000 karakter olabilir."),
});

function refreshQuotes(id?: string, dealId?: string): void {
  revalidatePath("/satis/teklifler");
  if (id) revalidatePath(`/satis/teklifler/${id}`);
  if (dealId) revalidatePath(`/satis/pipeline/${dealId}`);
}

export async function saveQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "satis_teklif:update" : "satis_teklif:create", "satis");
  await requireCapability(session, "satis.teklif");

  const parsed = QuoteFormSchema.safeParse({
    id: formData.get("id") || undefined,
    dealId: formData.get("dealId") || undefined,
    title: formData.get("title") ?? "",
    validUntil: formData.get("validUntil") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  let rawItems: z.infer<typeof RawItems>;
  try {
    rawItems = RawItems.parse(JSON.parse(String(formData.get("items") ?? "[]")));
  } catch {
    return { error: "Kalem listesi okunamadı. Sayfayı yenileyip tekrar deneyin." };
  }
  const normalized = normalizeItems(rawItems);
  if (!normalized.ok) return { error: normalized.error };

  const { id, dealId, title, validUntil, notes } = parsed.data;
  const input = { title, items: normalized.items, validUntil: followUpFromDate(validUntil), notes: notes || null };

  type Outcome = { error: string } | { id: string; dealId: string | null; number?: string };
  const outcome = await withTenant(session.tenantId, async (tx): Promise<Outcome> => {
    try {
      if (isUpdate && id) {
        if ((await findVisibleQuoteIds(tx, session, [id])).length === 0) return { error: "Bu teklifi düzenleme yetkiniz yok." };
        await updateQuote(tx, session.tenantId, id, input);
        return { id, dealId: null };
      }
      if (!dealId || (await findVisibleDealIds(tx, session, [dealId])).length === 0) {
        return { error: "Teklif için geçerli bir fırsat seçin." };
      }
      const created = await createQuote(tx, session.tenantId, dealId, input, session.userId);
      return { id: created.id, dealId, number: created.number };
    } catch (error: unknown) {
      if (error instanceof QuoteError) return { error: error.message };
      throw error;
    }
  });
  if ("error" in outcome) return { error: outcome.error };

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "quote.updated" : "quote.created",
    entityType: "crm_quote",
    entityId: outcome.id,
    metadata: { title, number: outcome.number },
  });
  refreshQuotes(outcome.id, outcome.dealId ?? undefined);
  if (!isUpdate) redirect(`/satis/teklifler/${outcome.id}`);
  return { ok: "Teklif kaydedildi." };
}

export async function quoteStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_teklif:update", "satis");
  await requireCapability(session, "satis.teklif");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as QuoteStatus;
  if (!["sent", "accepted", "rejected"].includes(to)) return;

  const result = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleQuoteIds(tx, session, [id])).length === 0) return null;
    try {
      return await setQuoteStatus(tx, session.tenantId, id, to, session.userId);
    } catch (error: unknown) {
      if (error instanceof QuoteError) return null;
      throw error;
    }
  });
  if (!result) return;
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: `quote.${to}`,
    entityType: "crm_quote",
    entityId: id,
    metadata: { number: result.number },
  });
  refreshQuotes(id, result.dealId);
}

export async function duplicateQuoteAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_teklif:create", "satis");
  await requireCapability(session, "satis.teklif");
  const id = String(formData.get("id") ?? "");
  const created = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleQuoteIds(tx, session, [id])).length === 0) return null;
    try {
      return await duplicateQuote(tx, session.tenantId, id, session.userId);
    } catch (error: unknown) {
      if (error instanceof QuoteError) return null;
      throw error;
    }
  });
  if (!created) return;
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "quote.versioned",
    entityType: "crm_quote",
    entityId: created.id,
    metadata: { from: id, number: created.number },
  });
  refreshQuotes();
  redirect(`/satis/teklifler/${created.id}`);
}

export async function deleteQuoteAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_teklif:delete", "satis");
  await requireCapability(session, "satis.teklif");
  const id = String(formData.get("id") ?? "");
  const removed = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleQuoteIds(tx, session, [id])).length === 0) return false;
    try {
      await deleteDraftQuote(tx, session.tenantId, id);
      return true;
    } catch (error: unknown) {
      if (error instanceof QuoteError) return false;
      throw error;
    }
  });
  if (!removed) return;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "quote.deleted", entityType: "crm_quote", entityId: id });
  refreshQuotes();
  redirect("/satis/teklifler");
}
