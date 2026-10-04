import { and, asc, count, eq } from "drizzle-orm";
import { SECTOR_PACKS } from "@/lib/sector/packs";
import { crmDeals, crmStages } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { stageKeyFromLabel, swapPosition, validateStageSet, type StageKind } from "./stages";

/**
 * `satis` modülü satis_crm dışında bir pakete sonradan açılmış olabilir (operatör paneli); o zaman
 * paket kurulumu aşamaları yazmamıştır. Aşama yoksa paketin varsayılan beş aşaması yazılır.
 * İdempotent: (kiracı, anahtar) benzersiz olduğu için eşzamanlı çağrı çoğaltmaz.
 */
export async function ensureDefaultStages(tx: TenantTx, tenantId: string): Promise<void> {
  const [row] = await tx.select({ n: count() }).from(crmStages).where(eq(crmStages.tenantId, tenantId));
  if ((row?.n ?? 0) > 0) return;
  const defaults = SECTOR_PACKS.satis_crm!.crmDefaults!.stages;
  await tx
    .insert(crmStages)
    .values(
      defaults.map((stage, index) => ({
        tenantId,
        key: stage.key,
        label: stage.label,
        kind: stage.kind,
        color: stage.color ?? null,
        position: index + 1,
      })),
    )
    .onConflictDoNothing();
}

export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}

async function loadStages(tx: TenantTx, tenantId: string) {
  return tx
    .select()
    .from(crmStages)
    .where(eq(crmStages.tenantId, tenantId))
    .orderBy(asc(crmStages.position), asc(crmStages.createdAt));
}

async function dealCount(tx: TenantTx, tenantId: string, stageId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(crmDeals)
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.stageId, stageId)));
  return row?.n ?? 0;
}

/** Aynı etiketten türeyen anahtar çakışırsa sonuna sayı ekler. */
function uniqueKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}${i}`.slice(0, 50);
    if (!taken.has(candidate)) return candidate;
  }
}

export async function addStage(
  tx: TenantTx,
  tenantId: string,
  input: { label: string; kind: StageKind; color?: string | null },
): Promise<string> {
  const stages = await loadStages(tx, tenantId);
  const error = validateStageSet([...stages, { label: input.label, kind: input.kind }]);
  if (error) throw new StageError(error);

  const key = uniqueKey(stageKeyFromLabel(input.label), new Set(stages.map((s) => s.key)));
  const position = (stages.at(-1)?.position ?? 0) + 1;
  const [row] = await tx
    .insert(crmStages)
    .values({ tenantId, key, label: input.label.trim(), kind: input.kind, color: input.color ?? null, position })
    .returning({ id: crmStages.id });
  return row!.id;
}

/** Ad ve renk her zaman; tür yalnız aşamada fırsat yokken (kapanış tarihleri tutarlı kalsın) değişir. */
export async function updateStage(
  tx: TenantTx,
  tenantId: string,
  id: string,
  input: { label: string; kind: StageKind; color?: string | null },
): Promise<void> {
  const stages = await loadStages(tx, tenantId);
  const current = stages.find((s) => s.id === id);
  if (!current) throw new StageError("Aşama bulunamadı.");

  if (input.kind !== current.kind && (await dealCount(tx, tenantId, id)) > 0) {
    throw new StageError("Bu aşamada fırsat var. Türünü değiştirmeden önce fırsatları başka aşamaya taşıyın.");
  }
  const next = stages.map((s) => (s.id === id ? { label: input.label, kind: input.kind } : { label: s.label, kind: s.kind }));
  const error = validateStageSet(next);
  if (error) throw new StageError(error);

  await tx
    .update(crmStages)
    .set({ label: input.label.trim(), kind: input.kind, color: input.color ?? null, updatedAt: new Date() })
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, id)));
}

export async function moveStage(
  tx: TenantTx,
  tenantId: string,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const stages = await loadStages(tx, tenantId);
  for (const change of swapPosition(stages, id, direction)) {
    await tx
      .update(crmStages)
      .set({ position: change.position, updatedAt: new Date() })
      .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, change.id)));
  }
}

/**
 * Aşamayı siler. Fırsatı olan aşama, fırsatlar AYNI TÜRDEKİ başka bir aşamaya taşınmadan silinmez
 * (tür değişirse kapanış tarihi ve neden anlamsızlaşır). Silince pipeline kuralları yine sağlanmalı.
 */
export async function deleteStage(
  tx: TenantTx,
  tenantId: string,
  id: string,
  moveDealsTo?: string | null,
): Promise<{ moved: number }> {
  const stages = await loadStages(tx, tenantId);
  const stage = stages.find((s) => s.id === id);
  if (!stage) throw new StageError("Aşama bulunamadı.");

  const remaining = stages.filter((s) => s.id !== id);
  const error = validateStageSet(remaining.map((s) => ({ label: s.label, kind: s.kind })));
  if (error) throw new StageError(`Bu aşama silinemez: ${error.replace(/\.$/, "")}.`);

  const deals = await dealCount(tx, tenantId, id);
  if (deals > 0) {
    const target = remaining.find((s) => s.id === moveDealsTo);
    if (!moveDealsTo || !target) {
      throw new StageError(`Bu aşamada ${deals} fırsat var. Silmeden önce fırsatların taşınacağı aşamayı seçin.`);
    }
    if (target.kind !== stage.kind) {
      throw new StageError("Fırsatlar yalnızca aynı türdeki bir aşamaya taşınabilir.");
    }
    await tx
      .update(crmDeals)
      .set({ stageId: target.id, updatedAt: new Date() })
      .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.stageId, id)));
  }
  await tx.delete(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.id, id)));
  return { moved: deals };
}
