"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { dailyEntries, dailyQuestions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { istanbulDayKey } from "@/lib/time";
import { DailyQuestionSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function saveQuestionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("gunluk:update", "operasyon");

  const parsed = DailyQuestionSchema.safeParse({
    id: formData.get("id") || undefined,
    label: formData.get("label") ?? "",
    type: formData.get("type") ?? "evet_hayir",
    options: formData.get("options") ?? "",
    required: formData.get("required") === "on",
    position: formData.get("position") ?? "0",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    if (id) {
      await tx
        .update(dailyQuestions)
        .set(values)
        .where(and(eq(dailyQuestions.tenantId, session.tenantId), eq(dailyQuestions.id, id)));
    } else {
      await tx.insert(dailyQuestions).values({ ...values, tenantId: session.tenantId });
    }
  });

  revalidatePath("/operasyon/gunluk");
  return { ok: id ? "Soru güncellendi." : "Soru eklendi." };
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const session = await requireModule("gunluk:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(dailyQuestions)
      .where(and(eq(dailyQuestions.tenantId, session.tenantId), eq(dailyQuestions.id, id))),
  );
  revalidatePath("/operasyon/gunluk");
}

/**
 * Günlük check-in gönderimi. Aynı gün ikinci kayıt açılmaz;
 * mevcut kayıt üzerine yazılır (tekil dizin zaten garanti eder).
 */
export async function submitDailyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("gunluk:create", "operasyon");
  const day = istanbulDayKey();

  const questions = await withTenant(session.tenantId, (tx) =>
    tx
      .select()
      .from(dailyQuestions)
      .where(and(eq(dailyQuestions.tenantId, session.tenantId), eq(dailyQuestions.isActive, true))),
  );

  const answers: Record<string, string | string[]> = {};
  for (const q of questions) {
    const raw = q.type === "checklist" ? formData.getAll(`q_${q.id}`) : formData.get(`q_${q.id}`);
    const value = Array.isArray(raw) ? raw.map(String) : raw === null ? "" : String(raw);
    const empty = Array.isArray(value) ? value.length === 0 : value.trim().length === 0;
    if (q.required && empty) return { error: `"${q.label}" zorunlu.` };
    if (!empty) answers[q.id] = value;
  }

  await withTenant(session.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: dailyEntries.id })
      .from(dailyEntries)
      .where(
        and(
          eq(dailyEntries.tenantId, session.tenantId),
          eq(dailyEntries.userId, session.userId),
          eq(dailyEntries.entryDate, day),
        ),
      );

    const note = String(formData.get("note") ?? "").trim() || null;
    if (existing[0]) {
      await tx
        .update(dailyEntries)
        .set({ answers, note, updatedAt: new Date() })
        .where(eq(dailyEntries.id, existing[0].id));
    } else {
      await tx.insert(dailyEntries).values({
        tenantId: session.tenantId,
        userId: session.userId,
        entryDate: day,
        answers,
        note,
      });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "daily.submitted",
    entityType: "daily_entry",
    metadata: { day },
  });
  revalidatePath("/operasyon/gunluk");
  return { ok: "Günlük kaydedildi." };
}
