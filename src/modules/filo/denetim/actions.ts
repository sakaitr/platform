"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inspectionCriteria, inspectionTypes, inspections, tasks } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { storeFile, UploadError } from "@/lib/storage";
import { failedLabels, resolveResult, type CriterionAnswer } from "./logic";

export type ActionState = { error: string } | { ok: string } | null;

const AnswerSchema = z.enum(["onay", "red", "kosullu", "atlandi"]);

/**
 * Denetimi kaydeder. Sonuç elle seçilmez, kriterlerden hesaplanır:
 * bir red varsa kaldı, koşullu varsa şartlı, hepsi onaysa geçti.
 * Fotoğraflar kritere bağlı olarak yüklenir.
 */
export async function saveInspectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("denetimler:create", "filo");

  const vehicleId = String(formData.get("vehicleId") ?? "");
  const typeId = String(formData.get("typeId") ?? "");
  const inspectionDate = String(formData.get("inspectionDate") ?? "");
  const companyId = String(formData.get("companyId") ?? "") || null;
  const deadline = String(formData.get("deadline") ?? "").trim() || null;

  if (!vehicleId) return { error: "Araç seçin." };
  if (!typeId) return { error: "Denetim türü seçin." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) return { error: "Tarih seçin." };

  const criteria = await withTenant(session.tenantId, (tx) =>
    tx
      .select()
      .from(inspectionCriteria)
      .where(
        and(
          eq(inspectionCriteria.tenantId, session.tenantId),
          eq(inspectionCriteria.typeId, typeId),
          eq(inspectionCriteria.isActive, true),
        ),
      ),
  );
  if (criteria.length === 0) return { error: "Bu türde tanımlı kriter yok." };

  const answers: CriterionAnswer[] = criteria.map((c) => {
    const parsed = AnswerSchema.safeParse(formData.get(`k_${c.id}`));
    return {
      criterionId: c.id,
      label: c.label,
      answer: parsed.success ? parsed.data : "atlandi",
      note: String(formData.get(`n_${c.id}`) ?? "").trim() || null,
    };
  });

  const [typeRow] = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ label: inspectionTypes.label })
      .from(inspectionTypes)
      .where(and(eq(inspectionTypes.tenantId, session.tenantId), eq(inspectionTypes.id, typeId))),
  );

  const inspectionId = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .insert(inspections)
      .values({
        tenantId: session.tenantId,
        vehicleId,
        typeId,
        companyId,
        inspectorId: session.userId,
        inspectionDate,
        type: typeRow?.label ?? "rutin",
        result: resolveResult(answers),
        deadline,
        checklist: answers,
        notes: String(formData.get("notes") ?? "").trim() || null,
      })
      .returning({ id: inspections.id });
    return row!.id;
  });

  // Fotoğraflar: genel olanlar "foto", kritere ait olanlar "foto_<kriterId>".
  const uploads: Array<{ file: File; slot: string | null }> = [];
  for (const value of formData.getAll("foto")) {
    if (value instanceof File && value.size > 0) uploads.push({ file: value, slot: null });
  }
  for (const c of criteria) {
    for (const value of formData.getAll(`foto_${c.id}`)) {
      if (value instanceof File && value.size > 0) uploads.push({ file: value, slot: c.id });
    }
  }

  for (const upload of uploads) {
    try {
      await storeFile({
        tenantId: session.tenantId,
        userId: session.userId,
        file: upload.file,
        entityType: "inspection",
        entityId: inspectionId,
        slot: upload.slot,
      });
    } catch (error) {
      // Denetim kaydı durmasın: fotoğraf sonradan eklenebilir, kayıt kritik.
      if (!(error instanceof UploadError)) throw error;
      return {
        ok: `Denetim kaydedildi ancak bir fotoğraf yüklenemedi: ${error.message}`,
      };
    }
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "inspection.created",
    entityType: "inspection",
    entityId: inspectionId,
    metadata: { result: resolveResult(answers), photos: uploads.length },
  });
  revalidatePath("/filo/denetimler");
  return { ok: `Denetim kaydedildi — sonuç: ${resolveResult(answers)}.` };
}

/** Denetimdeki eksiklerden görev açar — takip edilmeden kalmasın. */
export async function createTaskFromInspectionAction(formData: FormData): Promise<void> {
  const session = await requireModule("denetimler:approve", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        checklist: inspections.checklist,
        deadline: inspections.deadline,
        vehicleId: inspections.vehicleId,
        date: inspections.inspectionDate,
      })
      .from(inspections)
      .where(and(eq(inspections.tenantId, session.tenantId), eq(inspections.id, id)));
    if (!row) return;

    const eksikler = failedLabels((row.checklist ?? []) as CriterionAnswer[]);
    if (eksikler.length === 0) return;

    await tx.insert(tasks).values({
      tenantId: session.tenantId,
      title: `Denetim eksikleri (${row.date})`,
      description: eksikler.map((label) => `• ${label}`).join("\n"),
      priority: "yuksek",
      dueDate: row.deadline,
      createdBy: session.userId,
    });
  });

  revalidatePath("/filo/denetimler");
  revalidatePath("/gorevler");
}

export async function deleteInspectionAction(formData: FormData): Promise<void> {
  const session = await requireModule("denetimler:delete", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(inspections).where(and(eq(inspections.tenantId, session.tenantId), eq(inspections.id, id))),
  );
  revalidatePath("/filo/denetimler");
}

/* ---------- Denetim türü ve kriterleri ---------- */

export async function saveInspectionTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("denetimler:update", "filo");

  const label = String(formData.get("label") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (label.length < 2) return { error: "Tür adı gerekli." };
  if (!/^[a-z0-9_]{2,50}$/.test(code)) return { error: "Kod yalnız harf, rakam ve alt çizgi içerebilir." };

  try {
    await withTenant(session.tenantId, (tx) =>
      tx.insert(inspectionTypes).values({
        tenantId: session.tenantId,
        code,
        label,
        position: Number(formData.get("position") ?? 0) || 0,
      }),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return { error: "Bu kod zaten kullanılıyor." };
    throw error;
  }

  revalidatePath("/filo/denetimler/turler");
  return { ok: "Denetim türü eklendi." };
}

export async function saveCriterionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("denetimler:update", "filo");

  const typeId = String(formData.get("typeId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  if (!typeId) return { error: "Denetim türü seçin." };
  if (label.length < 2) return { error: "Kriter metni gerekli." };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(inspectionCriteria).values({
      tenantId: session.tenantId,
      typeId,
      label,
      position: Number(formData.get("position") ?? 0) || 0,
    }),
  );
  revalidatePath("/filo/denetimler/turler");
  return { ok: "Kriter eklendi." };
}

export async function deleteCriterionAction(formData: FormData): Promise<void> {
  const session = await requireModule("denetimler:update", "filo");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(inspectionCriteria)
      .where(and(eq(inspectionCriteria.tenantId, session.tenantId), eq(inspectionCriteria.id, id))),
  );
  revalidatePath("/filo/denetimler/turler");
}
