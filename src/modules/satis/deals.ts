import { and, asc, eq, sql } from "drizzle-orm";
import { crmActivities, crmDeals, crmLeads, crmStages, type CrmStage } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { logSystemActivity } from "./leads";

export class DealError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "stage_not_found" | "lost_reason_required" | "no_open_stage",
  ) {
    super(message);
    this.name = "DealError";
  }
}

export type NewDealInput = {
  title: string;
  stageId?: string | null;
  value?: number | null;
  companyId?: string | null;
  leadId?: string | null;
  ownerUserId?: string | null;
  expectedCloseAt?: Date | null;
  note?: string | null;
  createdBy?: string | null;
};

const blank = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

/** Fırsat açar; aşama verilmezse ilk açık aşama. */
export async function createDeal(tx: TenantTx, tenantId: string, input: NewDealInput): Promise<string> {
  let stageId = input.stageId ?? null;
  if (stageId) {
    const [stage] = await tx
      .select({ id: crmStages.id, kind: crmStages.kind })
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, stageId)));
    if (!stage) throw new DealError("Aşama bulunamadı.", "stage_not_found");
    // Doğrudan kapalı aşamada fırsat açılmaz: kapanış nedeni/tarihi taşıma akışından geçmeli.
    if (stage.kind !== "open") stageId = null;
  }
  if (!stageId) {
    const [first] = await tx
      .select({ id: crmStages.id })
      .from(crmStages)
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.kind, "open")))
      .orderBy(asc(crmStages.position))
      .limit(1);
    if (!first) throw new DealError("Pipeline'da açık aşama yok. Önce bir aşama ekleyin.", "no_open_stage");
    stageId = first.id;
  }

  const [deal] = await tx
    .insert(crmDeals)
    .values({
      tenantId,
      title: input.title.trim(),
      stageId,
      value: (input.value ?? 0).toFixed(2),
      companyId: input.companyId ?? null,
      leadId: input.leadId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      expectedCloseAt: input.expectedCloseAt ?? null,
      note: blank(input.note),
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: crmDeals.id });

  await logSystemActivity(tx, tenantId, {
    dealId: deal!.id,
    leadId: input.leadId ?? null,
    subject: "Fırsat oluşturuldu",
    userId: input.createdBy ?? null,
  });
  return deal!.id;
}

export type MoveDealResult = {
  changed: boolean;
  from: Pick<CrmStage, "id" | "label" | "kind">;
  to: Pick<CrmStage, "id" | "label" | "kind">;
  leadId: string | null;
  leadConverted: boolean;
};

/**
 * Fırsatı aşamaya taşır (kanban sürükleme, aşama seçici).
 * - `won`/`lost` aşamasına geçince `closed_at` yazılır; açık aşamaya dönünce temizlenir.
 * - `lost` için neden zorunlu; `lost` dışına çıkınca neden silinir.
 * - `won` olunca bağlı aday `converted` olur (firma açmaz: dönüştürme akışının işi).
 * - Her taşıma fırsatın (ve adayın) zaman çizelgesine sistem kaydı yazar.
 */
export async function moveDeal(
  tx: TenantTx,
  tenantId: string,
  dealId: string,
  stageId: string,
  options: { lostReason?: string | null; userId?: string | null } = {},
): Promise<MoveDealResult> {
  const [deal] = await tx
    .select()
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)))
    .for("update")
    .limit(1);
  if (!deal) throw new DealError("Fırsat bulunamadı.", "not_found");

  const stages = await tx
    .select({ id: crmStages.id, label: crmStages.label, kind: crmStages.kind })
    .from(crmStages)
    .where(eq(crmStages.tenantId, tenantId));
  const from = stages.find((s) => s.id === deal.stageId);
  const to = stages.find((s) => s.id === stageId);
  if (!from) throw new DealError("Mevcut aşama bulunamadı.", "stage_not_found");
  if (!to) throw new DealError("Aşama bulunamadı.", "stage_not_found");

  if (to.id === from.id) {
    return { changed: false, from, to, leadId: deal.leadId, leadConverted: false };
  }

  const reason = blank(options.lostReason);
  if (to.kind === "lost" && !reason) {
    throw new DealError("Kaybedilen fırsat için neden yazın.", "lost_reason_required");
  }

  await tx
    .update(crmDeals)
    .set({
      stageId: to.id,
      closedAt: to.kind === "open" ? null : new Date(),
      lostReason: to.kind === "lost" ? reason : null,
      updatedAt: new Date(),
    })
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)));

  let leadConverted = false;
  if (to.kind === "won" && deal.leadId) {
    const updated = await tx
      .update(crmLeads)
      .set({ status: "converted", updatedAt: new Date() })
      .where(
        and(
          eq(crmLeads.tenantId, tenantId),
          eq(crmLeads.id, deal.leadId),
          sql`${crmLeads.status} <> 'converted'`,
        ),
      )
      .returning({ id: crmLeads.id });
    leadConverted = updated.length > 0;
  }

  const subject = `Aşama: ${from.label} → ${to.label}`;
  await logSystemActivity(tx, tenantId, {
    dealId,
    leadId: deal.leadId,
    subject,
    note: to.kind === "lost" ? `Neden: ${reason}` : null,
    userId: options.userId ?? null,
  });

  return { changed: true, from, to, leadId: deal.leadId, leadConverted };
}

export type NewActivityInput = {
  type: "call" | "meeting" | "email" | "note" | "task";
  subject: string;
  note?: string | null;
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
  createdBy?: string | null;
};

/** Aktivite/görev yazar. En az bir bağlantı (aday, fırsat, firma) zorunlu. Not/arama/görüşme anında tamamlanmış sayılır. */
export async function createActivity(tx: TenantTx, tenantId: string, input: NewActivityInput): Promise<string> {
  if (!input.leadId && !input.dealId && !input.companyId) {
    throw new Error("Aktivite bir aday, fırsat ya da firmaya bağlı olmalı.");
  }
  const [row] = await tx
    .insert(crmActivities)
    .values({
      tenantId,
      type: input.type,
      subject: input.subject.trim(),
      note: blank(input.note),
      dueAt: input.dueAt ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      companyId: input.companyId ?? null,
      // Görev tamamlanana kadar açık; diğer türler olmuş bir şeyin kaydıdır.
      doneAt: input.type === "task" ? null : new Date(),
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: crmActivities.id });
  return row!.id;
}
