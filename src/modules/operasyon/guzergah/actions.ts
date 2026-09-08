"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { openRoutes, routeAssignments, routePassengers, routes } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { istanbulDayKey, shiftDay } from "@/lib/time";
import { OpenRouteSchema, RouteAssignmentSchema, RouteSchema } from "../validators";

export type ActionState = { error: string } | { ok: string } | null;

const read = (formData: FormData, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, String(formData.get(k) ?? "")]));

const ROUTE_KEYS = [
  "name", "code", "companyId", "direction", "capacity", "shiftName",
  "morningDeparture", "morningArrival", "eveningDeparture", "eveningArrival",
  "vehicleId", "driverId", "distanceKm", "durationMin", "notes",
] as const;

export async function saveRouteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "guzergahlar:update" : "guzergahlar:create", "operasyon");

  const parsed = RouteSchema.safeParse({
    ...read(formData, ROUTE_KEYS),
    id: formData.get("id") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (values.companyId && !isInScope(session.scope, values.companyId)) {
    return { error: "Seçilen firma kapsamınızda değil." };
  }

  await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(routes)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(routes.tenantId, session.tenantId), eq(routes.id, id)));
    } else {
      await tx.insert(routes).values({ ...values, tenantId: session.tenantId });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "route.updated" : "route.created",
    entityType: "route",
    entityId: id,
    metadata: { name: values.name },
  });
  revalidatePath("/operasyon/guzergahlar");
  return { ok: isUpdate ? "Güzergah güncellendi." : "Güzergah eklendi." };
}

export async function deleteRouteAction(formData: FormData): Promise<void> {
  const session = await requireModule("guzergahlar:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(routes).where(and(eq(routes.tenantId, session.tenantId), eq(routes.id, id))),
  );
  revalidatePath("/operasyon/guzergahlar");
}

/**
 * Araç/sürücü ataması. Aynı güzergah + hareket tipi için açık atama varsa
 * önce onu bir gün öncesinden kapatır — iki atama üst üste binmez.
 */
export async function assignRouteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("guzergahlar:assign", "operasyon");

  const parsed = RouteAssignmentSchema.safeParse({
    routeId: formData.get("routeId") ?? "",
    vehicleId: formData.get("vehicleId") ?? "",
    driverId: formData.get("driverId") ?? "",
    tripType: formData.get("tripType") ?? "",
    startsOn: formData.get("startsOn") || istanbulDayKey(),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { routeId, vehicleId, driverId, tripType, startsOn, notes } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    const open = await tx
      .select({ id: routeAssignments.id, startsOn: routeAssignments.startsOn })
      .from(routeAssignments)
      .where(
        and(
          eq(routeAssignments.tenantId, session.tenantId),
          eq(routeAssignments.routeId, routeId),
          isNull(routeAssignments.endsOn),
        ),
      );

    for (const row of open) {
      // Yeni atama eskisinden önce başlıyorsa aynı güne kapat, geçmişe taşma olmasın.
      const endsOn = row.startsOn >= startsOn ? startsOn : shiftDay(startsOn, -1);
      await tx.update(routeAssignments).set({ endsOn }).where(eq(routeAssignments.id, row.id));
    }

    await tx.insert(routeAssignments).values({
      tenantId: session.tenantId,
      routeId,
      vehicleId,
      driverId,
      tripType,
      startsOn,
      notes,
      createdBy: session.userId,
    });

    await tx
      .update(routes)
      .set({ vehicleId, driverId, updatedAt: new Date() })
      .where(and(eq(routes.tenantId, session.tenantId), eq(routes.id, routeId)));
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "route.assigned",
    entityType: "route",
    entityId: routeId,
    metadata: { vehicleId, startsOn },
  });
  revalidatePath(`/operasyon/guzergahlar/${routeId}`);
  return { ok: "Atama kaydedildi." };
}

export async function addRoutePassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("guzergahlar:assign", "operasyon");
  const routeId = String(formData.get("routeId") ?? "");
  const passengerId = String(formData.get("passengerId") ?? "");
  const stopName = String(formData.get("stopName") ?? "").trim() || null;
  if (!routeId || !passengerId) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(routePassengers)
      .values({ tenantId: session.tenantId, routeId, passengerId, stopName })
      .onConflictDoNothing(),
  );
  revalidatePath(`/operasyon/guzergahlar/${routeId}`);
}

export async function removeRoutePassengerAction(formData: FormData): Promise<void> {
  const session = await requireModule("guzergahlar:assign", "operasyon");
  const id = String(formData.get("id") ?? "");
  const routeId = String(formData.get("routeId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(routePassengers)
      .where(and(eq(routePassengers.tenantId, session.tenantId), eq(routePassengers.id, id))),
  );
  revalidatePath(`/operasyon/guzergahlar/${routeId}`);
}

const OPEN_KEYS = ["name", "companyId", "distanceKm", "durationMin", "price", "status", "notes"] as const;

export async function saveOpenRouteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requireModule(isUpdate ? "guzergahlar:update" : "guzergahlar:create", "operasyon");

  const parsed = OpenRouteSchema.safeParse({
    ...read(formData, OPEN_KEYS),
    id: formData.get("id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  await withTenant(session.tenantId, async (tx) => {
    const closedAt = values.status === "kapandi" ? new Date() : null;
    if (isUpdate && id) {
      await tx
        .update(openRoutes)
        .set({ ...values, closedAt, updatedAt: new Date() })
        .where(and(eq(openRoutes.tenantId, session.tenantId), eq(openRoutes.id, id)));
    } else {
      await tx
        .insert(openRoutes)
        .values({ ...values, closedAt, tenantId: session.tenantId, createdBy: session.userId });
    }
  });

  revalidatePath("/operasyon/acik-guzergahlar");
  return { ok: isUpdate ? "Kayıt güncellendi." : "Açık güzergah eklendi." };
}

export async function deleteOpenRouteAction(formData: FormData): Promise<void> {
  const session = await requireModule("guzergahlar:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx.delete(openRoutes).where(and(eq(openRoutes.tenantId, session.tenantId), eq(openRoutes.id, id))),
  );
  revalidatePath("/operasyon/acik-guzergahlar");
}
