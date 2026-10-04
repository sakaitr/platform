"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { companies, crmActivities, crmDeals, crmLeads } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { requireModule } from "@/lib/auth";
import { checkLimit } from "@/lib/limits";
import { findVisibleActivityIds, findVisibleDealIds, findVisibleLeadIds, resolveOwner } from "./access";
import { followUpAfter } from "./dates";
import { createActivity, createDeal, DealError, moveDeal } from "./deals";
import { logSystemActivity } from "./leads";
import { addStage, deleteStage, moveStage, StageError, updateStage } from "./stage-service";
import {
  ActivityFormSchema,
  dateTimeFromLocal,
  followUpFromDate,
  readDealForm,
  StageFormSchema,
} from "./validators";
import { canSeeAll } from "./visibility";

export type ActionState = { error: string } | { ok: string } | null;
export type MoveResult = { ok: true } | { error: string };

function refreshPipeline(dealId?: string | null, leadId?: string | null): void {
  revalidatePath("/satis/pipeline");
  revalidatePath("/satis/gorevler");
  if (dealId) revalidatePath(`/satis/pipeline/${dealId}`);
  if (leadId) revalidatePath(`/satis/adaylar/${leadId}`);
}

// ---- Fırsat ----------------------------------------------------------------------------------

export async function saveDealAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "satis_firsat:update" : "satis_firsat:create", "satis");

  const parsed = readDealForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, expectedCloseDate, ...values } = parsed.data;
  const ownerProvided = formData.has("ownerUserId");

  const outcome = await withTenant(
    session.tenantId,
    async (tx): Promise<{ error: string } | { ok: string; id: string; leadId: string | null }> => {
      // Satışçı yeni fırsatı kendine atar; yönetici boş bırakabilir
      const requestedOwner = !isUpdate && !values.ownerUserId && !canSeeAll(session) ? session.userId : values.ownerUserId;
      const owner = await resolveOwner(tx, session, requestedOwner);
      if (!owner.ok) return { error: owner.error };

      if (values.companyId) {
        const [company] = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(and(eq(companies.tenantId, session.tenantId), eq(companies.id, values.companyId)));
        if (!company) return { error: "Seçilen firma bulunamadı." };
      }
      if (values.leadId && (await findVisibleLeadIds(tx, session, [values.leadId])).length === 0) {
        return { error: "Seçilen aday bulunamadı." };
      }

      const expectedCloseAt = followUpFromDate(expectedCloseDate);
      if (isUpdate && id) {
        if ((await findVisibleDealIds(tx, session, [id])).length === 0) {
          return { error: "Bu fırsatı düzenleme yetkiniz yok." };
        }
        await tx
          .update(crmDeals)
          .set({
            title: values.title,
            value: (values.value ?? 0).toFixed(2),
            companyId: values.companyId,
            leadId: values.leadId,
            expectedCloseAt,
            note: values.note,
            ...(ownerProvided ? { ownerUserId: owner.ownerUserId } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, id)));
        return { ok: "Fırsat güncellendi.", id, leadId: values.leadId };
      }

      try {
        const dealId = await createDeal(tx, session.tenantId, {
          title: values.title,
          stageId: values.stageId,
          value: values.value,
          companyId: values.companyId,
          leadId: values.leadId,
          ownerUserId: owner.ownerUserId,
          expectedCloseAt,
          note: values.note,
          createdBy: session.userId,
        });
        return { ok: "Fırsat eklendi.", id: dealId, leadId: values.leadId };
      } catch (error: unknown) {
        if (error instanceof DealError) return { error: error.message };
        throw error;
      }
    },
  );

  if ("error" in outcome) return { error: outcome.error };
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "deal.updated" : "deal.created",
    entityType: "crm_deal",
    entityId: outcome.id,
    metadata: { title: values.title },
  });
  refreshPipeline(outcome.id, outcome.leadId);
  return { ok: outcome.ok };
}

/**
 * Aşama taşıma. Hem kanban sürüklemesi (istemci) hem aşama seçici formu buradan geçer.
 * `lostReason` yalnız `lost` aşaması için zorunludur.
 */
export async function moveDealAction(dealId: string, stageId: string, lostReason?: string): Promise<MoveResult> {
  const session = await requireModule("satis_firsat:update", "satis");
  try {
    const moved = await withTenant(session.tenantId, async (tx) => {
      if ((await findVisibleDealIds(tx, session, [dealId])).length === 0) {
        throw new DealError("Bu fırsatı taşıma yetkiniz yok.", "not_found");
      }
      return moveDeal(tx, session.tenantId, dealId, stageId, { lostReason, userId: session.userId });
    });
    if (moved.changed) {
      await writeAuditLog({
        tenantId: session.tenantId,
        userId: session.userId,
        event: "deal.stage_changed",
        entityType: "crm_deal",
        entityId: dealId,
        metadata: { from: moved.from.label, to: moved.to.label },
      });
    }
    refreshPipeline(dealId, moved.leadId);
    return { ok: true };
  } catch (error: unknown) {
    if (error instanceof DealError) return { error: error.message };
    throw error;
  }
}

/** JavaScript'siz çalışan aşama seçici (fırsat detay sayfası). */
export async function moveDealFormAction(formData: FormData): Promise<void> {
  const dealId = String(formData.get("dealId") ?? "");
  const result = await moveDealAction(
    dealId,
    String(formData.get("stageId") ?? ""),
    String(formData.get("lostReason") ?? ""),
  );
  if ("error" in result) redirect(`/satis/pipeline/${dealId}?hata=${encodeURIComponent(result.error)}`);
}

export async function deleteDealAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_firsat:delete", "satis");
  const id = String(formData.get("id") ?? "");
  const removed = await withTenant(session.tenantId, async (tx) => {
    const [visible] = await findVisibleDealIds(tx, session, [id]);
    if (!visible) return false;
    await tx.delete(crmDeals).where(and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, visible)));
    return true;
  });
  if (!removed) return;
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "deal.deleted",
    entityType: "crm_deal",
    entityId: id,
  });
  refreshPipeline();
  redirect("/satis/pipeline");
}

// ---- Aktivite ve görev -----------------------------------------------------------------------

export async function addActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("satis_aktivite:create", "satis");
  const parsed = ActivityFormSchema.safeParse({
    leadId: formData.get("leadId") ?? "",
    dealId: formData.get("dealId") ?? "",
    type: formData.get("type") ?? "note",
    subject: formData.get("subject") ?? "",
    note: formData.get("note") ?? "",
    due: formData.get("due") ?? "",
    assigneeUserId: formData.get("assigneeUserId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const input = parsed.data;

  const outcome = await withTenant(session.tenantId, async (tx): Promise<{ error: string } | { ok: string }> => {
    if (input.dealId && (await findVisibleDealIds(tx, session, [input.dealId])).length === 0) {
      return { error: "Bu fırsata kayıt ekleme yetkiniz yok." };
    }
    if (input.leadId && (await findVisibleLeadIds(tx, session, [input.leadId])).length === 0) {
      return { error: "Bu adaya kayıt ekleme yetkiniz yok." };
    }
    // Görev atanan kişisi: boşsa kendisi; satışçı yalnız kendine atayabilir
    const owner = await resolveOwner(tx, session, input.assigneeUserId ?? (input.type === "task" ? session.userId : null));
    if (!owner.ok) return { error: owner.error };
    await createActivity(tx, session.tenantId, {
      type: input.type,
      subject: input.subject,
      note: input.note,
      dueAt: dateTimeFromLocal(input.due),
      assigneeUserId: input.type === "task" ? owner.ownerUserId : null,
      leadId: input.leadId,
      dealId: input.dealId,
      createdBy: session.userId,
    });
    return { ok: input.type === "task" ? "Görev eklendi." : "Kayıt eklendi." };
  });

  if ("error" in outcome) return { error: outcome.error };
  refreshPipeline(input.dealId, input.leadId);
  return outcome;
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aktivite:update", "satis");
  const id = String(formData.get("id") ?? "");
  const reopen = formData.get("reopen") === "1";
  const touched = await withTenant(session.tenantId, async (tx) => {
    const [visible] = await findVisibleActivityIds(tx, session, [id]);
    if (!visible) return null;
    const [row] = await tx
      .update(crmActivities)
      .set({ doneAt: reopen ? null : new Date(), updatedAt: new Date() })
      .where(and(eq(crmActivities.tenantId, session.tenantId), eq(crmActivities.id, visible), eq(crmActivities.type, "task")))
      .returning({ dealId: crmActivities.dealId, leadId: crmActivities.leadId });
    return row ?? null;
  });
  if (touched) refreshPipeline(touched.dealId, touched.leadId);
}

export async function deleteActivityAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aktivite:delete", "satis");
  const id = String(formData.get("id") ?? "");
  const touched = await withTenant(session.tenantId, async (tx) => {
    const [visible] = await findVisibleActivityIds(tx, session, [id]);
    if (!visible) return null;
    // Sistemin yazdığı kayıtlar (durum değişikliği) denetim izidir, silinmez
    const [row] = await tx
      .delete(crmActivities)
      .where(and(eq(crmActivities.tenantId, session.tenantId), eq(crmActivities.id, visible), eq(crmActivities.isSystem, false)))
      .returning({ dealId: crmActivities.dealId, leadId: crmActivities.leadId });
    return row ?? null;
  });
  if (touched) refreshPipeline(touched.dealId, touched.leadId);
}

/**
 * Aday "görüşüldü" olunca önerilen takip: 3 gün sonrasına görev. Kullanıcı onaylar (butona basar),
 * sistem kendiliğinden görev yaratmaz. Adayın takip tarihi de boşsa aynı güne ayarlanır.
 */
export async function createFollowUpTaskAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aktivite:create", "satis");
  const leadId = String(formData.get("leadId") ?? "");
  const days = Math.min(30, Math.max(1, Number(formData.get("days") ?? 3) || 3));
  const when = followUpAfter(days);

  const done = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [leadId])).length === 0) return false;
    const [lead] = await tx
      .select({ name: crmLeads.name, ownerUserId: crmLeads.ownerUserId, followUpAt: crmLeads.followUpAt })
      .from(crmLeads)
      .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, leadId)));
    if (!lead) return false;
    await createActivity(tx, session.tenantId, {
      type: "task",
      subject: `Takip: ${lead.name}`,
      dueAt: when,
      assigneeUserId: lead.ownerUserId ?? session.userId,
      leadId,
      createdBy: session.userId,
    });
    if (!lead.followUpAt) {
      await tx
        .update(crmLeads)
        .set({ followUpAt: when, updatedAt: new Date() })
        .where(and(eq(crmLeads.tenantId, session.tenantId), eq(crmLeads.id, leadId)));
    }
    await logSystemActivity(tx, session.tenantId, { leadId, subject: `Takip görevi eklendi (${days} gün sonra)`, userId: session.userId });
    return true;
  });
  if (done) refreshPipeline(null, leadId);
}

// ---- Aşama düzenleme -------------------------------------------------------------------------

async function stageMutation(
  permission: "satis_asama:update",
  work: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string) => Promise<string>,
): Promise<ActionState> {
  const session = await requireModule(permission, "satis");
  try {
    const message = await withTenant(session.tenantId, (tx) => work(tx, session.tenantId));
    await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "pipeline.stage_changed", entityType: "crm_stage", metadata: { message } });
    revalidatePath("/satis/pipeline");
    revalidatePath("/satis/pipeline/asamalar");
    return { ok: message };
  } catch (error: unknown) {
    if (error instanceof StageError) return { error: error.message };
    throw error;
  }
}

export async function saveStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = StageFormSchema.safeParse({
    id: formData.get("id") || undefined,
    label: formData.get("label") ?? "",
    kind: formData.get("kind") ?? "open",
    color: formData.get("color") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;
  return stageMutation("satis_asama:update", async (tx, tenantId) => {
    if (id) {
      await updateStage(tx, tenantId, id, values);
      return "Aşama güncellendi.";
    }
    await addStage(tx, tenantId, values);
    return "Aşama eklendi.";
  });
}

export async function moveStageAction(formData: FormData): Promise<void> {
  const direction = formData.get("direction") === "up" ? "up" : "down";
  const id = String(formData.get("id") ?? "");
  await stageMutation("satis_asama:update", async (tx, tenantId) => {
    await moveStage(tx, tenantId, id, direction);
    return "Aşama sırası değişti.";
  });
}

export async function deleteStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "");
  const target = String(formData.get("moveTo") ?? "") || null;
  return stageMutation("satis_asama:update", async (tx, tenantId) => {
    const { moved } = await deleteStage(tx, tenantId, id, target);
    return moved > 0 ? `Aşama silindi, ${moved} fırsat taşındı.` : "Aşama silindi.";
  });
}
