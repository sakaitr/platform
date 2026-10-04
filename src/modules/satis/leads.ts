import { and, asc, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import {
  companies,
  crmActivities,
  crmContacts,
  crmDeals,
  crmDeletedExternal,
  crmLeads,
  crmQuotes,
  crmStages,
  type CrmLead,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { buildLeadKeys, type LeadKeys } from "./normalize";
import { resolveScore, type Temperature } from "./scoring";
import { ensureDefaultStages } from "./stage-service";
import { emitLeadDeleted, emitLeadEvent } from "./webhook-outbox";

/**
 * Aday yaşam döngüsünün tek yeri: form, CSV, Atricard webhook'u ve API hep buradan geçer.
 * Tekilleştirme, puanlama, mezar taşı ve silme kuralı tek noktada kalsın diye.
 * Her fonksiyon çağıranın `withTenant` transaction'ı içinde çalışır.
 */

export type LeadSource = CrmLead["source"];
export type LeadStatus = CrmLead["status"];

export type NewLeadInput = {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  city?: string | null;
  sector?: string | null;
  message?: string | null;
  service?: string | null;
  note?: string | null;
  temperature?: Temperature | null;
  estimatedValue?: number | null;
  followUpAt?: Date | null;
  status?: LeadStatus;
  source: LeadSource;
  externalId?: string | null;
  eventName?: string | null;
  ownerUserId?: string | null;
  createdBy?: string | null;
};

export type DuplicateReason = "external" | "phone" | "email" | "website" | "name";

export type CreateLeadResult =
  | { status: "created"; id: string }
  | { status: "duplicate"; id: string; reason: DuplicateReason }
  | { status: "ignored"; reason: "tombstone" };

const blank = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** Anahtarlardan biri eşleşen ilk adayı bulur. `excludeId` düzenlenen adayın kendisini dışlar. */
export async function findDuplicateLead(
  tx: TenantTx,
  tenantId: string,
  keys: LeadKeys,
  excludeId?: string,
): Promise<{ id: string; reason: DuplicateReason } | null> {
  const checks: { reason: DuplicateReason; cond: SQL }[] = [];
  if (keys.phoneKey) checks.push({ reason: "phone", cond: eq(crmLeads.phoneKey, keys.phoneKey) });
  if (keys.emailKey) checks.push({ reason: "email", cond: eq(crmLeads.emailKey, keys.emailKey) });
  if (keys.websiteKey) checks.push({ reason: "website", cond: eq(crmLeads.websiteKey, keys.websiteKey) });
  if (keys.nameKey) checks.push({ reason: "name", cond: eq(crmLeads.nameKey, keys.nameKey) });
  if (checks.length === 0) return null;

  const where = and(
    eq(crmLeads.tenantId, tenantId),
    excludeId ? ne(crmLeads.id, excludeId) : undefined,
    or(...checks.map((c) => c.cond)),
  );
  const rows = await tx
    .select({
      id: crmLeads.id,
      phoneKey: crmLeads.phoneKey,
      emailKey: crmLeads.emailKey,
      websiteKey: crmLeads.websiteKey,
      nameKey: crmLeads.nameKey,
    })
    .from(crmLeads)
    .where(where)
    .orderBy(asc(crmLeads.createdAt))
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  // Öncelik: telefon, e-posta, web, ad
  const reason =
    (keys.phoneKey && hit.phoneKey === keys.phoneKey && "phone") ||
    (keys.emailKey && hit.emailKey === keys.emailKey && "email") ||
    (keys.websiteKey && hit.websiteKey === keys.websiteKey && "website") ||
    "name";
  return { id: hit.id, reason };
}

export async function isTombstoned(
  tx: TenantTx,
  tenantId: string,
  source: LeadSource,
  externalId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ externalId: crmDeletedExternal.externalId })
    .from(crmDeletedExternal)
    .where(
      and(
        eq(crmDeletedExternal.tenantId, tenantId),
        eq(crmDeletedExternal.source, source),
        eq(crmDeletedExternal.externalId, externalId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Sistemin yazdığı zaman çizelgesi kaydı (durum değişikliği, oluşturma, dönüşüm). */
export async function logSystemActivity(
  tx: TenantTx,
  tenantId: string,
  input: { leadId?: string | null; dealId?: string | null; subject: string; note?: string | null; userId?: string | null },
): Promise<void> {
  await tx.insert(crmActivities).values({
    tenantId,
    type: "note",
    subject: input.subject,
    note: input.note ?? null,
    leadId: input.leadId ?? null,
    dealId: input.dealId ?? null,
    isSystem: true,
    createdBy: input.userId ?? null,
    doneAt: new Date(),
  });
}

/**
 * Aday açar; zaten varsa mevcut adayı döner.
 * Sıra: mezar taşı → (kaynak, external_id) → telefon/e-posta/web/ad+şehir → oluştur.
 * Eşleşen mevcut adaya external_id BAĞLANMAZ: başka kaynaktan gelmiş olabilir,
 * sonradan gelen bir `lead.deleted` onu silmemeli.
 */
export async function createLeadIfNew(
  tx: TenantTx,
  tenantId: string,
  input: NewLeadInput,
): Promise<CreateLeadResult> {
  const externalId = blank(input.externalId);

  if (externalId) {
    if (await isTombstoned(tx, tenantId, input.source, externalId)) {
      return { status: "ignored", reason: "tombstone" };
    }
    const existing = await tx
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.tenantId, tenantId),
          eq(crmLeads.source, input.source),
          eq(crmLeads.externalId, externalId),
        ),
      )
      .limit(1);
    if (existing[0]) return { status: "duplicate", id: existing[0].id, reason: "external" };
  }

  const keys = buildLeadKeys(input);
  const duplicate = await findDuplicateLead(tx, tenantId, keys);
  if (duplicate) return { status: "duplicate", ...duplicate };

  const score = resolveScore({
    website: input.website,
    email: input.email,
    phone: input.phone,
    temperature: input.temperature ?? null,
  });

  const inserted = await tx
    .insert(crmLeads)
    .values({
      tenantId,
      name: input.name.trim(),
      contactName: blank(input.contactName),
      phone: blank(input.phone),
      phoneKey: keys.phoneKey,
      email: blank(input.email),
      emailKey: keys.emailKey,
      website: blank(input.website),
      websiteKey: keys.websiteKey,
      nameKey: keys.nameKey,
      city: blank(input.city),
      sector: blank(input.sector),
      message: blank(input.message),
      service: blank(input.service),
      note: blank(input.note),
      score,
      temperature: input.temperature ?? null,
      status: input.status ?? "new",
      source: input.source,
      externalId,
      eventName: blank(input.eventName),
      ownerUserId: input.ownerUserId ?? null,
      estimatedValue: input.estimatedValue == null ? null : input.estimatedValue.toFixed(2),
      followUpAt: input.followUpAt ?? null,
      createdBy: input.createdBy ?? null,
    })
    // Eşzamanlı aynı external_id teslimi: ikincisi sessizce düşer, aşağıda mevcut kayıt okunur.
    .onConflictDoNothing()
    .returning({ id: crmLeads.id });

  const created = inserted[0];
  if (!created) {
    const [existing] = await tx
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.tenantId, tenantId),
          eq(crmLeads.source, input.source),
          eq(crmLeads.externalId, externalId ?? ""),
        ),
      )
      .limit(1);
    if (existing) return { status: "duplicate", id: existing.id, reason: "external" };
    throw new Error("Lead insert returned no row");
  }

  await logSystemActivity(tx, tenantId, {
    leadId: created.id,
    subject: "Aday oluşturuldu",
    note: `Kaynak: ${input.source}`,
    userId: input.createdBy ?? null,
  });
  await emitLeadEvent(tx, tenantId, "lead.created", created.id);
  return { status: "created", id: created.id };
}

/** `ownerUserId: undefined` = sahip değişmez (formda sahip alanı yoksa); `null` = sahibi kaldır. */
export type UpdateLeadInput = Omit<NewLeadInput, "source" | "externalId" | "createdBy" | "status"> & {
  status?: LeadStatus;
};

/** Düzenleme: anahtarlar yeniden hesaplanır; başka bir adayla çakışırsa `duplicate` döner. */
export async function updateLead(
  tx: TenantTx,
  tenantId: string,
  id: string,
  input: UpdateLeadInput,
): Promise<{ status: "updated" } | { status: "duplicate"; id: string; reason: DuplicateReason }> {
  const keys = buildLeadKeys(input);
  const duplicate = await findDuplicateLead(tx, tenantId, keys, id);
  if (duplicate) return { status: "duplicate", ...duplicate };

  await tx
    .update(crmLeads)
    .set({
      name: input.name.trim(),
      contactName: blank(input.contactName),
      phone: blank(input.phone),
      phoneKey: keys.phoneKey,
      email: blank(input.email),
      emailKey: keys.emailKey,
      website: blank(input.website),
      websiteKey: keys.websiteKey,
      nameKey: keys.nameKey,
      city: blank(input.city),
      sector: blank(input.sector),
      message: blank(input.message),
      service: blank(input.service),
      note: blank(input.note),
      temperature: input.temperature ?? null,
      score: resolveScore({
        website: input.website,
        email: input.email,
        phone: input.phone,
        temperature: input.temperature ?? null,
      }),
      eventName: blank(input.eventName),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      estimatedValue: input.estimatedValue == null ? null : input.estimatedValue.toFixed(2),
      followUpAt: input.followUpAt ?? null,
      ...(input.status ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, id)));
  await emitLeadEvent(tx, tenantId, "lead.updated", id);
  return { status: "updated" };
}

export type RemoveReason = "owner_deleted" | "erasure_request" | "account_removed";

/**
 * Adayları KALICI siler (soft delete yok, KVKK). external_id'si olanların mezar taşı yazılır,
 * böylece geç gelen bir `lead.created` kişiyi yeniden doğuramaz.
 * Bağlı kişi ve aktiviteler FK cascade ile gider; fırsatlar adaysız kalır (`lead_id` null).
 * Dönen değer silinen kimlikler: giden webhook (`lead.deleted`) bunlar için üretilir.
 */
export async function removeLeads(
  tx: TenantTx,
  tenantId: string,
  leadIds: readonly string[],
  reason: RemoveReason = "owner_deleted",
): Promise<{ id: string; source: LeadSource; externalId: string | null }[]> {
  if (leadIds.length === 0) return [];
  const rows = await tx
    .select({ id: crmLeads.id, source: crmLeads.source, externalId: crmLeads.externalId })
    .from(crmLeads)
    .where(and(eq(crmLeads.tenantId, tenantId), inArray(crmLeads.id, [...leadIds])));
  if (rows.length === 0) return [];

  const tombstones = rows
    .filter((r): r is typeof r & { externalId: string } => r.externalId !== null)
    .map((r) => ({ tenantId, source: r.source, externalId: r.externalId }));
  if (tombstones.length > 0) {
    await tx.insert(crmDeletedExternal).values(tombstones).onConflictDoNothing();
  }

  await tx.delete(crmLeads).where(
    and(
      eq(crmLeads.tenantId, tenantId),
      inArray(
        crmLeads.id,
        rows.map((r) => r.id),
      ),
    ),
  );
  for (const row of rows) await emitLeadDeleted(tx, tenantId, row.id, reason);
  return rows;
}

/**
 * Atricard `lead.deleted` kuralı: fırsatı olmayan aday silinir; fırsata bağlıysa silmek yerine
 * ANONİMLEŞTİRİLİR (fırsat ve teklif geçmişi bozulmasın, kişisel veri gitsin). Mezar taşı her halde yazılır.
 */
export async function eraseExternalLead(
  tx: TenantTx,
  tenantId: string,
  source: LeadSource,
  externalId: string,
  reason: RemoveReason = "erasure_request",
): Promise<"deleted" | "anonymized" | "not_found"> {
  await tx
    .insert(crmDeletedExternal)
    .values({ tenantId, source, externalId })
    .onConflictDoNothing();

  const [lead] = await tx
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.tenantId, tenantId),
        eq(crmLeads.source, source),
        eq(crmLeads.externalId, externalId),
      ),
    )
    .for("update")
    .limit(1);
  if (!lead) return "not_found";

  const [deal] = await tx
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.leadId, lead.id)))
    .limit(1);

  if (!deal) {
    await tx.delete(crmLeads).where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, lead.id)));
    await emitLeadDeleted(tx, tenantId, lead.id, reason);
    return "deleted";
  }

  await anonymizeLead(tx, tenantId, lead.id);
  await emitLeadDeleted(tx, tenantId, lead.id, reason);
  return "anonymized";
}

/** Kişisel alanları temizler; fırsat/teklif geçmişi için satır kalır. */
export async function anonymizeLead(tx: TenantTx, tenantId: string, leadId: string): Promise<void> {
  await tx
    .update(crmLeads)
    .set({
      name: "Silinen kayıt",
      contactName: null,
      phone: null,
      phoneKey: null,
      email: null,
      emailKey: null,
      website: null,
      websiteKey: null,
      nameKey: null,
      city: null,
      message: null,
      note: null,
      eventName: null,
      updatedAt: new Date(),
    })
    .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, leadId)));
  // Aktivite metinleri de kişisel veri taşıyabilir
  await tx
    .update(crmActivities)
    .set({ subject: "Silinen kayıt", note: null, updatedAt: new Date() })
    .where(and(eq(crmActivities.tenantId, tenantId), eq(crmActivities.leadId, leadId)));
  await tx
    .delete(crmContacts)
    .where(and(eq(crmContacts.tenantId, tenantId), eq(crmContacts.leadId, leadId)));

  // Fırsat başlığı ("Ad: hizmet"), notu ve teklif metinleri de adı taşıyabilir
  const deals = await tx
    .select({ id: crmDeals.id })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.leadId, leadId)));
  if (deals.length > 0) {
    const dealIds = deals.map((d) => d.id);
    await tx
      .update(crmDeals)
      .set({ title: "Silinen kayıt", note: null, lostReason: null, updatedAt: new Date() })
      .where(and(eq(crmDeals.tenantId, tenantId), inArray(crmDeals.id, dealIds)));
    await tx
      .update(crmQuotes)
      .set({ title: "Silinen kayıt", notes: null, updatedAt: new Date() })
      .where(and(eq(crmQuotes.tenantId, tenantId), inArray(crmQuotes.dealId, dealIds)));
    await tx
      .update(crmActivities)
      .set({ subject: "Silinen kayıt", note: null, updatedAt: new Date() })
      .where(and(eq(crmActivities.tenantId, tenantId), inArray(crmActivities.dealId, dealIds)));
  }
}

export class ConvertError extends Error {
  constructor(
    message: string,
    readonly code: "already_converted" | "not_found" | "no_open_stage",
  ) {
    super(message);
    this.name = "ConvertError";
  }
}

/**
 * Adayı müşteriye dönüştürür: tek transaction'da firma (`companies`, tip `musteri`),
 * isteğe bağlı kişi ve ilk açık aşamada bir fırsat. Zaten dönüşmüşse `already_converted` (409).
 */
export async function convertLead(
  tx: TenantTx,
  tenantId: string,
  leadId: string,
  userId: string | null,
): Promise<{ companyId: string; dealId: string }> {
  const [lead] = await tx
    .select()
    .from(crmLeads)
    .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, leadId)))
    .for("update")
    .limit(1);
  if (!lead) throw new ConvertError("Aday bulunamadı.", "not_found");
  if (lead.status === "converted" || lead.convertedCompanyId) {
    throw new ConvertError("Bu aday zaten müşteriye dönüştürülmüş.", "already_converted");
  }

  await ensureDefaultStages(tx, tenantId);
  const [stage] = await tx
    .select({ id: crmStages.id })
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.kind, "open")))
    .orderBy(asc(crmStages.position))
    .limit(1);
  if (!stage) {
    throw new ConvertError("Pipeline'da açık aşama yok. Önce bir aşama ekleyin.", "no_open_stage");
  }

  const [company] = await tx
    .insert(companies)
    .values({
      tenantId,
      name: lead.name,
      type: "musteri",
      phone: lead.phone,
      email: lead.email,
      address: lead.city,
      createdBy: userId,
    })
    .returning({ id: companies.id });

  if (lead.contactName && lead.contactName !== lead.name) {
    await tx.insert(crmContacts).values({
      tenantId,
      companyId: company!.id,
      leadId: lead.id,
      fullName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
    });
  }

  const [deal] = await tx
    .insert(crmDeals)
    .values({
      tenantId,
      title: `${lead.name}: ${lead.service ?? "Satış fırsatı"}`,
      stageId: stage.id,
      value: lead.estimatedValue ?? "0",
      companyId: company!.id,
      leadId: lead.id,
      ownerUserId: lead.ownerUserId,
      createdBy: userId,
    })
    .returning({ id: crmDeals.id });

  await tx
    .update(crmLeads)
    .set({ status: "converted", convertedCompanyId: company!.id, updatedAt: new Date() })
    .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, lead.id)));

  await logSystemActivity(tx, tenantId, {
    leadId: lead.id,
    dealId: deal!.id,
    subject: "Müşteriye dönüştürüldü",
    userId,
  });
  await emitLeadEvent(tx, tenantId, "lead.updated", lead.id);

  return { companyId: company!.id, dealId: deal!.id };
}
