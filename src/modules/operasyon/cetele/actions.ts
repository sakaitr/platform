"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { tripLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { TripLogSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function saveTripLogAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "cetele:update" : "cetele:create", "operasyon");

  const parsed = TripLogSchema.safeParse({
    id: formData.get("id") || undefined,
    vehicleId: formData.get("vehicleId") ?? "",
    routeId: formData.get("routeId") ?? "",
    driverId: formData.get("driverId") ?? "",
    companyId: formData.get("companyId") ?? "",
    logDate: formData.get("logDate") ?? "",
    tripType: formData.get("tripType") ?? "",
    direction: formData.get("direction") ?? "",
    passengerCount: formData.get("passengerCount") ?? "",
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
        // Onaylı kayıt doğrudan değiştirilemez — önce geri alınmalı.
        const current = await tx
          .select({ status: tripLogs.status })
          .from(tripLogs)
          .where(and(eq(tripLogs.tenantId, session.tenantId), eq(tripLogs.id, id)));
        if (current[0]?.status === "onaylandi") throw new Error("ONAYLI");

        await tx
          .update(tripLogs)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(tripLogs.tenantId, session.tenantId), eq(tripLogs.id, id)));
      } else {
        await tx.insert(tripLogs).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ONAYLI") {
      return { error: "Onaylanmış çetele değiştirilemez. Önce onayı geri alın." };
    }
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu araç için aynı gün ve hareket tipinde zaten kayıt var." };
    }
    throw error;
  }

  revalidatePath("/operasyon/cetele");
  return { ok: isUpdate ? "Çetele güncellendi." : "Çetele eklendi." };
}

/** Toplu onay — hakediş bu kayıtlardan üretilir, onaysızı saymaz. */
export async function approveTripLogsAction(formData: FormData): Promise<void> {
  const session = await requireModule("cetele:approve", "operasyon");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(tripLogs)
      .set({ status: "onaylandi", approvedBy: session.userId, approvedAt: new Date(), revertReason: null })
      .where(and(eq(tripLogs.tenantId, session.tenantId), inArray(tripLogs.id, ids))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "trip_log.approved",
    entityType: "trip_log",
    metadata: { count: ids.length },
  });
  revalidatePath("/operasyon/cetele");
}

/** Onayı geri alma — neden zorunlu, iz kaybolmasın. */
export async function revertTripLogAction(formData: FormData): Promise<void> {
  const session = await requireModule("cetele:approve", "operasyon");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id || reason.length < 3) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(tripLogs)
      .set({ status: "bekliyor", approvedBy: null, approvedAt: null, revertReason: reason })
      .where(and(eq(tripLogs.tenantId, session.tenantId), eq(tripLogs.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "trip_log.reverted",
    entityType: "trip_log",
    entityId: id,
    metadata: { reason },
  });
  revalidatePath("/operasyon/cetele");
}

export async function deleteTripLogAction(formData: FormData): Promise<void> {
  const session = await requireModule("cetele:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(tripLogs)
      .where(
        and(
          eq(tripLogs.tenantId, session.tenantId),
          eq(tripLogs.id, id),
          // Onaylı kayıt silinemez: hakediş dayanağı.
          eq(tripLogs.status, "bekliyor"),
        ),
      ),
  );
  revalidatePath("/operasyon/cetele");
}
