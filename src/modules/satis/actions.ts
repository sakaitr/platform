"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { crmContacts, crmLeads } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { requireModule } from "@/lib/auth";
import { checkLimit } from "@/lib/limits";
import { parseCsv } from "./csv";
import { mapHeaders, parseLeadRow } from "./csv-leads";
import {
  ConvertError,
  convertLead,
  createLeadIfNew,
  logSystemActivity,
  removeLeads,
  updateLead,
  type LeadStatus,
} from "./leads";
import { BulkSchema, ContactFormSchema, followUpFromDate, OPEN_STATUSES, readLeadForm, TEMPERATURES } from "./validators";
import { STATUS_LABEL } from "./labels";
import { emitLeadEvent } from "./webhook-outbox";
import { findVisibleLeadIds, resolveOwner } from "./access";
import { canSeeAll } from "./visibility";

export type ActionState = { error: string } | { ok: string } | null;

export type ImportState =
  | { error: string }
  | { ok: string; created: number; duplicates: number; invalid: number; problems: string[] }
  | null;

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function refresh(id?: string): void {
  revalidatePath("/satis/adaylar");
  if (id) revalidatePath(`/satis/adaylar/${id}`);
}

export async function saveLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "satis_aday:update" : "satis_aday:create", "satis");

  const parsed = readLeadForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, followUpDate, ...values } = parsed.data;
  const input = { ...values, followUpAt: followUpFromDate(followUpDate) };
  // Formda sahip alanı yoksa (Satışçı) güncelleme mevcut sahibi korur.
  const ownerProvided = formData.has("ownerUserId");

  if (!isUpdate) {
    const limit = await checkLimit(session.tenantId, "satis", "max_leads");
    if (!limit.ok) return { error: limit.message };
  }

  const outcome = await withTenant(session.tenantId, async (tx): Promise<{ error: string } | { ok: string; id: string }> => {
    const owner = await resolveOwner(
      tx,
      session,
      // Satışçı yeni adayı boş bırakırsa kendisine atanır; yönetici boş bırakabilir.
      !isUpdate && !values.ownerUserId && !canSeeAll(session) ? session.userId : values.ownerUserId,
    );
    if (!owner.ok) return { error: owner.error };
    const data = { ...input, ownerUserId: owner.ownerUserId };

    if (isUpdate && id) {
      const updateData = ownerProvided ? data : { ...input, ownerUserId: undefined };
      if ((await findVisibleLeadIds(tx, session, [id])).length === 0) {
        return { error: "Bu adayı düzenleme yetkiniz yok." } ;
      }
      const result = await updateLead(tx, session.tenantId, id, updateData);
      return result.status === "duplicate"
        ? ({ error: "Bu telefon, e-posta ya da web sitesi başka bir adayda kayıtlı." })
        : ({ ok: "Aday güncellendi.", id });
    }

    const result = await createLeadIfNew(tx, session.tenantId, {
      ...data,
      source: "manual",
      createdBy: session.userId,
    });
    if (result.status === "duplicate") {
      return { error: "Bu aday zaten kayıtlı: aynı telefon, e-posta, web sitesi ya da ad ve şehir var." };
    }
    if (result.status === "ignored") return { error: "Bu aday eklenemez." };
    return { ok: "Aday eklendi.", id: result.id };
  });

  if ("error" in outcome) return { error: outcome.error };
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "lead.updated" : "lead.created",
    entityType: "crm_lead",
    entityId: outcome.id,
    metadata: { name: values.name },
  });
  refresh(outcome.id);
  return { ok: outcome.ok };
}

export async function setLeadStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:update", "satis");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!(OPEN_STATUSES as readonly string[]).includes(status)) return;

  await withTenant(session.tenantId, async (tx) => {
    const [visible] = await findVisibleLeadIds(tx, session, [id]);
    if (!visible) return;
    const [current] = await tx
      .select({ status: crmLeads.status })
      .from(crmLeads)
      .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, id)));
    // Dönüşmüş aday durumunu elle değiştiremez: dönüşüm geri alınmaz.
    if (!current || current.status === "converted" || current.status === status) return;
    await tx
      .update(crmLeads)
      .set({ status: status as LeadStatus, updatedAt: new Date() })
      .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, id)));
    await logSystemActivity(tx, session.tenantId, {
      leadId: id,
      subject: `Durum: ${STATUS_LABEL[current.status]} → ${STATUS_LABEL[status]}`,
      userId: session.userId,
    });
    await emitLeadEvent(tx, session.tenantId, "lead.updated", id);
  });
  refresh(id);
}

export async function setLeadTemperatureAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:update", "satis");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("temperature") ?? "");
  const temperature = raw === "" ? null : (TEMPERATURES as readonly string[]).includes(raw) ? raw : undefined;
  if (temperature === undefined) return;

  await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [id])).length === 0) return;
    await tx
      .update(crmLeads)
      .set({ temperature: temperature as "hot" | "warm" | "cold" | null, updatedAt: new Date() })
      .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, id)));
    await emitLeadEvent(tx, session.tenantId, "lead.updated", id);
  });
  refresh(id);
}

export async function assignLeadAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:update", "satis");
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("ownerUserId") ?? "") || null;

  const changed = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [id])).length === 0) return false;
    const owner = await resolveOwner(tx, session, requested);
    if (!owner.ok) return false;
    await tx
      .update(crmLeads)
      .set({ ownerUserId: owner.ownerUserId, updatedAt: new Date() })
      .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, id)));
    await logSystemActivity(tx, session.tenantId, {
      leadId: id,
      subject: owner.ownerUserId ? "Sahip atandı" : "Sahip kaldırıldı",
      userId: session.userId,
    });
    await emitLeadEvent(tx, session.tenantId, "lead.updated", id);
    return true;
  });
  if (!changed) return;
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "lead.assigned",
    entityType: "crm_lead",
    entityId: id,
    metadata: { ownerUserId: requested },
  });
  refresh(id);
}

export async function deleteLeadAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:delete", "satis");
  const id = String(formData.get("id") ?? "");
  const removed = await withTenant(session.tenantId, async (tx) => {
    const [visible] = await findVisibleLeadIds(tx, session, [id]);
    return visible ? removeLeads(tx, session.tenantId, [visible]) : [];
  });
  if (removed.length === 0) return;
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "lead.deleted",
    entityType: "crm_lead",
    entityId: id,
  });
  refresh();
  redirect("/satis/adaylar");
}

export async function bulkLeadAction(formData: FormData): Promise<void> {
  // Tek açılır liste: "status:contacted", "owner:<uuid>", "owner:" (sahibi kaldır), "delete:"
  const [opRaw, ...rest] = String(formData.get("bulk") ?? "").split(":");
  const parsed = BulkSchema.safeParse({
    ids: formData.getAll("ids").map(String),
    op: opRaw,
    value: rest.join(":"),
  });
  if (!parsed.success) return;
  const { ids, op, value } = parsed.data;
  const session = await requireModule(op === "delete" ? "satis_aday:delete" : "satis_aday:update", "satis");

  const done = await withTenant(session.tenantId, async (tx) => {
    const visible = await findVisibleLeadIds(tx, session, ids);
    if (visible.length === 0) return 0;
    const scope = and(eq(crmLeads.tenantId, session.tenantId), inArray(crmLeads.id, visible));
    if (op === "delete") {
      return (await removeLeads(tx, session.tenantId, visible)).length;
    }
    if (op === "status") {
      if (!(OPEN_STATUSES as readonly string[]).includes(value)) return 0;
      // Dönüşmüş adayların durumu değişmez
      await tx
        .update(crmLeads)
        .set({ status: value as LeadStatus, updatedAt: new Date() })
        .where(and(scope, inArray(crmLeads.status, ["new", "contacted", "qualified", "disqualified"])));
      for (const leadId of visible) await emitLeadEvent(tx, session.tenantId, "lead.updated", leadId);
      return visible.length;
    }
    if (op === "temperature") {
      const temperature = value === "" ? null : (TEMPERATURES as readonly string[]).includes(value) ? value : undefined;
      if (temperature === undefined) return 0;
      await tx
        .update(crmLeads)
        .set({ temperature: temperature as "hot" | "warm" | "cold" | null, updatedAt: new Date() })
        .where(scope);
      for (const leadId of visible) await emitLeadEvent(tx, session.tenantId, "lead.updated", leadId);
      return visible.length;
    }
    const owner = await resolveOwner(tx, session, value === "" ? null : value);
    if (!owner.ok) return 0;
    await tx.update(crmLeads).set({ ownerUserId: owner.ownerUserId, updatedAt: new Date() }).where(scope);
    for (const leadId of visible) await emitLeadEvent(tx, session.tenantId, "lead.updated", leadId);
    return visible.length;
  });

  if (done > 0) {
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      event: `lead.bulk_${op}`,
      entityType: "crm_lead",
      metadata: { count: done, value: op === "delete" ? undefined : value },
    });
  }
  refresh();
}

export async function convertLeadAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:update", "satis");
  const id = String(formData.get("id") ?? "");

  let failure: string | null = null;
  try {
    await withTenant(session.tenantId, async (tx) => {
      if ((await findVisibleLeadIds(tx, session, [id])).length === 0) {
        throw new ConvertError("Aday bulunamadı.", "not_found");
      }
      await convertLead(tx, session.tenantId, id, session.userId);
    });
  } catch (error: unknown) {
    if (!(error instanceof ConvertError)) throw error;
    failure = error.code;
  }
  if (failure) redirect(`/satis/adaylar/${id}?hata=${failure}`);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "lead.converted",
    entityType: "crm_lead",
    entityId: id,
  });
  refresh(id);
  revalidatePath("/crm/firmalar");
  redirect(`/satis/adaylar/${id}`);
}

export async function addContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("satis_aday:update", "satis");
  const parsed = ContactFormSchema.safeParse({
    leadId: formData.get("leadId"),
    fullName: formData.get("fullName") ?? "",
    title: formData.get("title") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const ok = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [parsed.data.leadId])).length === 0) return false;
    await tx.insert(crmContacts).values({ tenantId: session.tenantId, ...parsed.data });
    return true;
  });
  if (!ok) return { error: "Bu adaya kişi ekleme yetkiniz yok." };
  refresh(parsed.data.leadId);
  return { ok: "Kişi eklendi." };
}

export async function removeContactAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aday:update", "satis");
  const id = String(formData.get("id") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [leadId])).length === 0) return;
    await tx
      .delete(crmContacts)
      .where(
        and(eq(crmContacts.tenantId, session.tenantId), eq(crmContacts.id, id), eq(crmContacts.leadId, leadId)),
      );
  });
  refresh(leadId);
}

/**
 * CSV içe aktarma: başlık eşleme + tekilleştirme + sınır. Satır hatası içe aktarmayı durdurmaz,
 * raporda satır numarasıyla gösterilir. Toplu ekleme `max_leads` sınırını da gözetir.
 */
export async function importLeadsAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await requireModule("satis_aday:import", "satis");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Bir CSV dosyası seçin." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "Dosya 2 MB'tan büyük. Dosyayı bölüp tekrar deneyin." };

  const { headers, rows, lines } = parseCsv(await file.text());
  const columns = mapHeaders(headers);
  if (columns.name === undefined && columns.contactName === undefined) {
    return { error: "Başlık satırında ad sütunu bulunamadı. Sütunlardan birini 'Ad' ya da 'Firma' diye adlandırın." };
  }
  if (rows.length === 0) return { error: "Dosyada veri satırı yok." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Tek seferde en fazla ${MAX_IMPORT_ROWS} satır içe aktarılır.` };

  const limit = await checkLimit(session.tenantId, "satis", "max_leads", rows.length);
  if (!limit.ok) return { error: limit.message };

  const problems: string[] = [];
  let created = 0;
  let duplicates = 0;
  let invalid = 0;

  await withTenant(session.tenantId, async (tx) => {
    for (const [index, row] of rows.entries()) {
      const line = lines[index] ?? index + 2; // dosyadaki gerçek satır numarası
      const parsed = parseLeadRow(row, columns);
      if (!parsed.ok) {
        invalid += 1;
        if (problems.length < 20) problems.push(`Satır ${line}: ${parsed.error}`);
        continue;
      }
      const { estimatedValue, ...rest } = parsed.value;
      const result = await createLeadIfNew(tx, session.tenantId, {
        ...rest,
        estimatedValue,
        source: "csv",
        // Satışçı içe aktarırsa adaylar kendisine atanır, yönetici sahipsiz bırakır
        ownerUserId: canSeeAll(session) ? null : session.userId,
        createdBy: session.userId,
      });
      if (result.status === "created") created += 1;
      else {
        duplicates += 1;
        if (problems.length < 20) problems.push(`Satır ${line}: zaten kayıtlı, atlandı (${parsed.value.name}).`);
      }
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "lead.imported",
    entityType: "crm_lead",
    metadata: { created, duplicates, invalid, file: file.name.slice(0, 120) },
  });
  refresh();
  return {
    ok: `${created} aday eklendi, ${duplicates} yinelenen atlandı, ${invalid} satır hatalı.`,
    created,
    duplicates,
    invalid,
    problems,
  };
}
