"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import {
  routePlanAssignments,
  routePlanRoutes,
  routePlanStops,
  routePlans,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { RoutePlanSchema } from "../validators";
import { planRoutes } from "./planner";
import { geocodedPassengers } from "./queries";

export type ActionState = { error: string } | { ok: string } | null;

export async function createRoutePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireModule("rota_planlama:create", "operasyon");

  const parsed = RoutePlanSchema.safeParse({
    name: formData.get("name") ?? "",
    companyId: formData.get("companyId") ?? "",
    shiftName: formData.get("shiftName") ?? "",
    direction: formData.get("direction") ?? "gidis",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx.insert(routePlans).values({ ...parsed.data, tenantId: session.tenantId, createdBy: session.userId }),
  );
  revalidatePath("/operasyon/rota-planlama");
  return { ok: "Plan oluşturuldu. Şimdi rotaları üretebilirsiniz." };
}

/**
 * Planın rotalarını üretir. Var olan rotalar silinip yeniden kurulur —
 * yayınlanmış plan yeniden üretilemez, çünkü sahadaki atamalar ona bağlı.
 */
export async function generatePlanAction(formData: FormData): Promise<void> {
  const session = await requireModule("rota_planlama:update", "operasyon");
  const planId = String(formData.get("planId") ?? "");
  const depotLat = Number(String(formData.get("depotLat") ?? "").replace(",", "."));
  const depotLng = Number(String(formData.get("depotLng") ?? "").replace(",", "."));
  if (!planId || !Number.isFinite(depotLat) || !Number.isFinite(depotLng)) return;

  const plan = await withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(routePlans)
      .where(and(eq(routePlans.tenantId, session.tenantId), eq(routePlans.id, planId)));
    return rows[0] ?? null;
  });
  if (!plan || plan.status !== "taslak") return;

  const [people, fleet] = await Promise.all([
    geocodedPassengers(session.tenantId, plan.companyId),
    withTenant(session.tenantId, (tx) =>
      tx
        .select({ id: vehicles.id, plate: vehicles.plate, capacity: vehicles.capacity })
        .from(vehicles)
        .where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.status, "aktif"))),
    ),
  ]);

  const result = planRoutes({
    depot: { lat: depotLat, lng: depotLng },
    passengers: people.map((p) => ({
      id: p.id,
      name: p.name,
      lat: Number(p.lat),
      lng: Number(p.lng),
    })),
    vehicles: fleet.map((v) => ({ id: v.id, label: v.plate, capacity: v.capacity ?? 0 })),
  });

  await withTenant(session.tenantId, async (tx) => {
    // Eski rotaları temizle: duraklar ve atamalar cascade ile gider.
    await tx
      .delete(routePlanRoutes)
      .where(and(eq(routePlanRoutes.tenantId, session.tenantId), eq(routePlanRoutes.planId, planId)));

    for (const [index, route] of result.routes.entries()) {
      const [planRoute] = await tx
        .insert(routePlanRoutes)
        .values({
          tenantId: session.tenantId,
          planId,
          vehicleId: route.vehicleId,
          name: route.vehicleLabel,
          position: index,
          metrics: { mesafeMetre: route.distance, durakSayisi: route.stops.length },
        })
        .returning({ id: routePlanRoutes.id });

      for (const stop of route.stops) {
        const [planStop] = await tx
          .insert(routePlanStops)
          .values({
            tenantId: session.tenantId,
            planRouteId: planRoute!.id,
            name: stop.name,
            lat: String(stop.lat),
            lng: String(stop.lng),
            position: stop.order,
            passengerCount: 1,
          })
          .returning({ id: routePlanStops.id });

        await tx.insert(routePlanAssignments).values({
          tenantId: session.tenantId,
          stopId: planStop!.id,
          passengerId: stop.id,
        });
      }
    }

    await tx
      .update(routePlans)
      .set({
        metrics: {
          toplamMetre: result.totalDistance,
          aracSayisi: result.routes.length,
          yolcuSayisi: result.routes.reduce((sum, r) => sum + r.stops.length, 0),
          yerlesmeyen: result.unassigned.length,
        },
        updatedAt: new Date(),
      })
      .where(eq(routePlans.id, planId));
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "route_plan.generated",
    entityType: "route_plan",
    entityId: planId,
    metadata: { routes: result.routes.length, unassigned: result.unassigned.length },
  });
  revalidatePath(`/operasyon/rota-planlama/${planId}`);
}

const PLAN_FLOW: Record<string, readonly string[]> = {
  taslak: ["yayinlandi", "arsiv"],
  yayinlandi: ["aktif", "arsiv"],
  aktif: ["arsiv"],
  arsiv: [],
};

/**
 * Plan durumunu ilerletir. "aktif" tektir: yeni plan aktifleşince
 * önceki aktif plan arşive düşer, sahada iki plan birden geçerli olmasın.
 */
export async function setPlanStatusAction(formData: FormData): Promise<void> {
  const session = await requireModule("rota_planlama:publish", "operasyon");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!id || !(to in PLAN_FLOW)) return;

  await withTenant(session.tenantId, async (tx) => {
    const [current] = await tx
      .select({ status: routePlans.status })
      .from(routePlans)
      .where(and(eq(routePlans.tenantId, session.tenantId), eq(routePlans.id, id)));
    if (!current || !PLAN_FLOW[current.status]!.includes(to)) return;

    if (to === "aktif") {
      await tx
        .update(routePlans)
        .set({ status: "arsiv", updatedAt: new Date() })
        .where(
          and(
            eq(routePlans.tenantId, session.tenantId),
            eq(routePlans.status, "aktif"),
            ne(routePlans.id, id),
          ),
        );
    }

    const now = new Date();
    await tx
      .update(routePlans)
      .set({
        status: to as "yayinlandi",
        publishedAt: to === "yayinlandi" ? now : undefined,
        publishedBy: to === "yayinlandi" ? session.userId : undefined,
        updatedAt: now,
      })
      .where(eq(routePlans.id, id));
  });

  revalidatePath("/operasyon/rota-planlama");
  revalidatePath(`/operasyon/rota-planlama/${id}`);
}

/** Taslağı yeni sürüm olarak kopyalar — yayınlanmış plan bozulmadan denenir. */
export async function cloneRoutePlanAction(formData: FormData): Promise<void> {
  const session = await requireModule("rota_planlama:create", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await withTenant(session.tenantId, async (tx) => {
    const [source] = await tx
      .select()
      .from(routePlans)
      .where(and(eq(routePlans.tenantId, session.tenantId), eq(routePlans.id, id)));
    if (!source) return;

    await tx.insert(routePlans).values({
      tenantId: session.tenantId,
      companyId: source.companyId,
      name: source.name,
      shiftName: source.shiftName,
      direction: source.direction,
      versionNo: source.versionNo + 1,
      status: "taslak",
      createdBy: session.userId,
    });
  });
  revalidatePath("/operasyon/rota-planlama");
}

export async function deleteRoutePlanAction(formData: FormData): Promise<void> {
  const session = await requireModule("rota_planlama:delete", "operasyon");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(routePlans)
      .where(
        and(
          eq(routePlans.tenantId, session.tenantId),
          eq(routePlans.id, id),
          // Aktif plan silinemez; önce arşive alınmalı.
          ne(routePlans.status, "aktif"),
        ),
      ),
  );
  revalidatePath("/operasyon/rota-planlama");
}
