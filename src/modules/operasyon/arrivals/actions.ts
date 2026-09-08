"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { vehicleArrivals } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { ArrivalSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function saveArrivalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "arrivals:update" : "arrivals:create", "operasyon");

  const parsed = ArrivalSchema.safeParse({
    id: formData.get("id") || undefined,
    vehicleId: formData.get("vehicleId") ?? "",
    companyId: formData.get("companyId") ?? "",
    driverId: formData.get("driverId") ?? "",
    arrivalDate: formData.get("arrivalDate") ?? "",
    shift: formData.get("shift") ?? "",
    arrivedAt: formData.get("arrivedAt") ?? "",
    plannedAt: formData.get("plannedAt") ?? "",
    note: formData.get("note") ?? "",
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
          .update(vehicleArrivals)
          .set(values)
          .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id)));
      } else {
        await tx
          .insert(vehicleArrivals)
          .values({ ...values, tenantId: session.tenantId, recordedBy: session.userId });
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu araç için aynı gün ve vardiyada zaten kayıt var." };
    }
    throw error;
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "arrival.updated" : "arrival.created",
    entityType: "vehicle_arrival",
    entityId: id,
    metadata: { date: values.arrivalDate, shift: values.shift },
  });
  revalidatePath("/operasyon/giris-kontrol");
  return { ok: "Geliş kaydedildi." };
}

export async function deleteArrivalAction(formData: FormData): Promise<void> {
  const session = await requireModule("arrivals:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(vehicleArrivals)
      .where(and(eq(vehicleArrivals.tenantId, session.tenantId), eq(vehicleArrivals.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "arrival.deleted",
    entityType: "vehicle_arrival",
    entityId: id,
  });
  revalidatePath("/operasyon/giris-kontrol");
}
