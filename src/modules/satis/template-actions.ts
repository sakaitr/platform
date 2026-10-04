"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { crmTemplates } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { requireModule } from "@/lib/auth";
import { findVisibleLeadIds } from "./access";
import { logSystemActivity } from "./leads";
import { unknownPlaceholders } from "./templates";

export type ActionState = { error: string } | { ok: string } | null;

const TemplateSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(2, "Şablon adı en az 2 karakter olmalı.").max(150, "Şablon adı en fazla 150 karakter olabilir."),
    channel: z.enum(["whatsapp", "email"], { errorMap: () => ({ message: "Kanalı seçin." }) }),
    subject: z.string().trim().max(255, "Konu en fazla 255 karakter olabilir."),
    body: z.string().trim().min(2, "Mesaj metni en az 2 karakter olmalı.").max(4000, "Mesaj en fazla 4000 karakter olabilir."),
  })
  .superRefine((value, ctx) => {
    const unknown = unknownPlaceholders(`${value.subject} ${value.body}`);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Tanınmayan yer tutucu: ${unknown.map((u) => `{${u}}`).join(", ")}. Kullanılabilir: {firma} {ad} {hizmet} {sehir} {sektor}`,
      });
    }
  });

export async function saveTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "satis_sablon:update" : "satis_sablon:create", "satis");
  const parsed = TemplateSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    channel: formData.get("channel") ?? "",
    subject: formData.get("subject") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, name, channel, subject, body } = parsed.data;

  const result = await withTenant(session.tenantId, async (tx): Promise<{ error: string } | { ok: string; id: string }> => {
    const clash = await tx
      .select({ id: crmTemplates.id })
      .from(crmTemplates)
      .where(and(eq(crmTemplates.tenantId, session.tenantId), eq(crmTemplates.name, name), id ? ne(crmTemplates.id, id) : undefined));
    if (clash.length > 0) return { error: `"${name}" adında başka bir şablon var. Farklı bir ad yazın.` };

    const values = { name, channel, subject: channel === "email" ? subject || null : null, body };
    if (isUpdate && id) {
      const updated = await tx
        .update(crmTemplates)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(crmTemplates.tenantId, session.tenantId), eq(crmTemplates.id, id)))
        .returning({ id: crmTemplates.id });
      return updated[0] ? { ok: "Şablon güncellendi.", id } : { error: "Şablon bulunamadı." };
    }
    const [row] = await tx.insert(crmTemplates).values({ tenantId: session.tenantId, ...values }).returning({ id: crmTemplates.id });
    return { ok: "Şablon eklendi.", id: row!.id };
  });
  if ("error" in result) return result;

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "template.updated" : "template.created",
    entityType: "crm_template",
    entityId: result.id,
    metadata: { name },
  });
  revalidatePath("/satis/sablonlar");
  return { ok: result.ok };
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_sablon:delete", "satis");
  const id = String(formData.get("id") ?? "");
  const removed = await withTenant(session.tenantId, (tx) =>
    tx
      .delete(crmTemplates)
      .where(and(eq(crmTemplates.tenantId, session.tenantId), eq(crmTemplates.id, id)))
      .returning({ id: crmTemplates.id }),
  );
  if (removed.length === 0) return;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "template.deleted", entityType: "crm_template", entityId: id });
  revalidatePath("/satis/sablonlar");
}

/** Mesaj uygulama dışında gönderilir; kullanıcı isterse "gönderdim" diye zaman çizelgesine not düşer. */
export async function logTemplateUseAction(formData: FormData): Promise<void> {
  const session = await requireModule("satis_aktivite:create", "satis");
  const leadId = String(formData.get("leadId") ?? "");
  const name = String(formData.get("name") ?? "").slice(0, 150);
  const channel = formData.get("channel") === "email" ? "E-posta" : "WhatsApp";
  if (!name) return;
  const ok = await withTenant(session.tenantId, async (tx) => {
    if ((await findVisibleLeadIds(tx, session, [leadId])).length === 0) return false;
    await logSystemActivity(tx, session.tenantId, { leadId, subject: `${channel} gönderildi: ${name}`, userId: session.userId });
    return true;
  });
  if (ok) revalidatePath(`/satis/adaylar/${leadId}`);
}
