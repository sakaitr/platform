import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  companies,
  passengers,
  routePlanAssignments,
  routePlanRoutes,
  routePlanStops,
  routePlans,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listRoutePlans(tenantId: string, status?: string) {
  const parts = [eq(routePlans.tenantId, tenantId)];
  if (status) parts.push(eq(routePlans.status, status as "taslak"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: routePlans.id,
        name: routePlans.name,
        shiftName: routePlans.shiftName,
        direction: routePlans.direction,
        status: routePlans.status,
        versionNo: routePlans.versionNo,
        metrics: routePlans.metrics,
        publishedAt: routePlans.publishedAt,
        createdAt: routePlans.createdAt,
        companyName: companies.name,
      })
      .from(routePlans)
      .leftJoin(companies, eq(companies.id, routePlans.companyId))
      .where(and(...parts))
      .orderBy(desc(routePlans.createdAt)),
  );
}

export async function getRoutePlan(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(routePlans).where(and(eq(routePlans.tenantId, tenantId), eq(routePlans.id, id))),
  );
  return rows[0] ?? null;
}

/** Planın araç rotaları ve her rotanın durakları. */
export async function planRoutesWithStops(tenantId: string, planId: string) {
  return withTenant(tenantId, async (tx) => {
    const routes = await tx
      .select({
        id: routePlanRoutes.id,
        name: routePlanRoutes.name,
        position: routePlanRoutes.position,
        metrics: routePlanRoutes.metrics,
        plate: vehicles.plate,
        capacity: vehicles.capacity,
      })
      .from(routePlanRoutes)
      .leftJoin(vehicles, eq(vehicles.id, routePlanRoutes.vehicleId))
      .where(and(eq(routePlanRoutes.tenantId, tenantId), eq(routePlanRoutes.planId, planId)))
      .orderBy(asc(routePlanRoutes.position));

    const stops = await tx
      .select({
        id: routePlanStops.id,
        planRouteId: routePlanStops.planRouteId,
        name: routePlanStops.name,
        lat: routePlanStops.lat,
        lng: routePlanStops.lng,
        position: routePlanStops.position,
        locked: routePlanStops.locked,
        passengerCount: routePlanStops.passengerCount,
      })
      .from(routePlanStops)
      .innerJoin(routePlanRoutes, eq(routePlanRoutes.id, routePlanStops.planRouteId))
      .where(and(eq(routePlanStops.tenantId, tenantId), eq(routePlanRoutes.planId, planId)))
      .orderBy(asc(routePlanStops.position));

    return routes.map((route) => ({
      ...route,
      stops: stops.filter((s) => s.planRouteId === route.id),
    }));
  });
}

/** Koordinatı olan aktif yolcular — planlamanın girdisi. */
export async function geocodedPassengers(tenantId: string, companyId?: string | null) {
  const parts = [
    eq(passengers.tenantId, tenantId),
    eq(passengers.isActive, true),
    isNotNull(passengers.pickupLat),
    isNotNull(passengers.pickupLng),
  ];
  if (companyId) parts.push(eq(passengers.companyId, companyId));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: passengers.id,
        name: passengers.fullName,
        lat: passengers.pickupLat,
        lng: passengers.pickupLng,
      })
      .from(passengers)
      .where(and(...parts))
      .orderBy(asc(passengers.fullName)),
  );
}

/** Koordinatı olmayan yolcu sayısı — planlama öncesi uyarı için. */
export async function ungeocodedCount(tenantId: string, companyId?: string | null): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ value: sql<number>`count(*)` })
      .from(passengers)
      .where(
        and(
          eq(passengers.tenantId, tenantId),
          eq(passengers.isActive, true),
          sql`${passengers.pickupLat} is null or ${passengers.pickupLng} is null`,
          companyId ? eq(passengers.companyId, companyId) : undefined,
        ),
      ),
  );
  return Number(rows[0]?.value ?? 0);
}

/** Haritada gösterilecek yayınlanmış/aktif planların durakları. */
export async function activePlanStops(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        planName: routePlans.name,
        routeName: routePlanRoutes.name,
        plate: vehicles.plate,
        stopName: routePlanStops.name,
        lat: routePlanStops.lat,
        lng: routePlanStops.lng,
        position: routePlanStops.position,
        passengerCount: routePlanStops.passengerCount,
      })
      .from(routePlanStops)
      .innerJoin(routePlanRoutes, eq(routePlanRoutes.id, routePlanStops.planRouteId))
      .innerJoin(routePlans, eq(routePlans.id, routePlanRoutes.planId))
      .leftJoin(vehicles, eq(vehicles.id, routePlanRoutes.vehicleId))
      .where(and(eq(routePlans.tenantId, tenantId), eq(routePlans.status, "aktif")))
      .orderBy(asc(routePlanRoutes.position), asc(routePlanStops.position)),
  );
}

export async function planAssignmentCount(tenantId: string, planId: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ value: sql<number>`count(*)` })
      .from(routePlanAssignments)
      .innerJoin(routePlanStops, eq(routePlanStops.id, routePlanAssignments.stopId))
      .innerJoin(routePlanRoutes, eq(routePlanRoutes.id, routePlanStops.planRouteId))
      .where(and(eq(routePlanAssignments.tenantId, tenantId), eq(routePlanRoutes.planId, planId))),
  );
  return Number(rows[0]?.value ?? 0);
}
