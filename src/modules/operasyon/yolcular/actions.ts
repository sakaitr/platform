"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { passengers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { PassengerSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function savePassengerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "yolcular:update" : "yolcular:create", "operasyon");

  const parsed = PassengerSchema.safeParse({
    id: formData.get("id") || undefined,
    fullName: formData.get("fullName") ?? "",
    companyId: formData.get("companyId") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    idNumber: formData.get("idNumber") ?? "",
    type: formData.get("type") ?? "yolcu",
    grade: formData.get("grade") ?? "",
    branch: formData.get("branch") ?? "",
    barcode: formData.get("barcode") ?? "",
    pickupAddress: formData.get("pickupAddress") ?? "",
    dropoffAddress: formData.get("dropoffAddress") ?? "",
    serviceStatus: formData.get("serviceStatus") ?? "aktif",
    isActive: formData.get("isActive") === "on",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  try {
    await withTenant(session.tenantId, async (tx) => {
      if (isUpdate && id) {
        await tx
          .update(passengers)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(passengers.tenantId, session.tenantId), eq(passengers.id, id)));
      } else {
        await tx.insert(passengers).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu barkod numarası zaten kullanılıyor." };
    }
    throw error;
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "passenger.updated" : "passenger.created",
    entityType: "passenger",
    entityId: id,
    metadata: { fullName: values.fullName },
  });
  revalidatePath("/operasyon/yolcular");
  return { ok: isUpdate ? "Kayıt güncellendi." : "Kayıt eklendi." };
}

export async function deletePassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("yolcular:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(passengers).where(and(eq(passengers.tenantId, session.tenantId), eq(passengers.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "passenger.deleted",
    entityType: "passenger",
    entityId: id,
  });
  revalidatePath("/operasyon/yolcular");
}
