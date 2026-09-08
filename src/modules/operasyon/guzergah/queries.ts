import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import {
  companies,
  companyShifts,
  drivers,
  openRoutes,
  routeAssignments,
  routePassengers,
  routes,
  passengers,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

export type RouteFilter = {
  q?: string;
  companyId?: string;
  durum?: string;
  page?: number;
  scope: string[] | null;
};

function scoped(scope: string[] | null): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return isNull(routes.companyId);
  return or(inArray(routes.companyId, scope), isNull(routes.companyId));
}

export async function listRoutes(tenantId: string, f: RouteFilter) {
  const parts: SQL[] = [eq(routes.tenantId, tenantId)];
  const sc = scoped(f.scope);
  if (sc) parts.push(sc);
  if (f.q) parts.push(or(ilike(routes.name, `%${f.q}%`), ilike(routes.code, `%${f.q}%`))!);
  if (f.companyId) parts.push(eq(routes.companyId, f.companyId));
  if (f.durum === "aktif") parts.push(eq(routes.isActive, true));
  if (f.durum === "pasif") parts.push(eq(routes.isActive, false));
  const where = and(...parts)!;
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: routes.id,
        name: routes.name,
        code: routes.code,
        direction: routes.direction,
        capacity: routes.capacity,
        shiftName: routes.shiftName,
        distanceKm: routes.distanceKm,
        durationMin: routes.durationMin,
        isActive: routes.isActive,
        companyName: companies.name,
        plate: vehicles.plate,
        driverName: drivers.fullName,
      })
      .from(routes)
      .leftJoin(companies, eq(companies.id, routes.companyId))
      .leftJoin(vehicles, eq(vehicles.id, routes.vehicleId))
      .leftJoin(drivers, eq(drivers.id, routes.driverId))
      .where(where)
      .orderBy(asc(routes.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(routes).where(where);
    const n = total?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
  });
}

export async function getRoute(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(routes).where(and(eq(routes.tenantId, tenantId), eq(routes.id, id))),
  );
  return rows[0] ?? null;
}

export async function routeOptions(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(routes.tenantId, tenantId), eq(routes.isActive, true)];
  const sc = scoped(scope);
  if (sc) parts.push(sc);
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: routes.id, name: routes.name, companyId: routes.companyId })
      .from(routes)
      .where(and(...parts))
      .orderBy(asc(routes.name)),
  );
}

/** Atama geçmişi — güncel atama en üstte (bitiş tarihi boş olan). */
export async function listAssignments(tenantId: string, routeId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: routeAssignments.id,
        plate: vehicles.plate,
        driverName: drivers.fullName,
        tripType: routeAssignments.tripType,
        startsOn: routeAssignments.startsOn,
        endsOn: routeAssignments.endsOn,
        kind: routeAssignments.kind,
        notes: routeAssignments.notes,
      })
      .from(routeAssignments)
      .innerJoin(vehicles, eq(vehicles.id, routeAssignments.vehicleId))
      .leftJoin(drivers, eq(drivers.id, routeAssignments.driverId))
      .where(and(eq(routeAssignments.tenantId, tenantId), eq(routeAssignments.routeId, routeId)))
      .orderBy(desc(routeAssignments.startsOn)),
  );
}

export async function listRoutePassengers(tenantId: string, routeId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: routePassengers.id,
        passengerId: passengers.id,
        fullName: passengers.fullName,
        phone: passengers.phone,
        stopName: routePassengers.stopName,
      })
      .from(routePassengers)
      .innerJoin(passengers, eq(passengers.id, routePassengers.passengerId))
      .where(and(eq(routePassengers.tenantId, tenantId), eq(routePassengers.routeId, routeId)))
      .orderBy(asc(passengers.fullName)),
  );
}

export type OpenRouteFilter = { durum?: string; scope: string[] | null };

export async function listOpenRoutes(tenantId: string, f: OpenRouteFilter) {
  const parts: SQL[] = [eq(openRoutes.tenantId, tenantId)];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(openRoutes.companyId, f.scope), isNull(openRoutes.companyId))!
        : isNull(openRoutes.companyId),
    );
  }
  if (f.durum) parts.push(eq(openRoutes.status, f.durum as "acik"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: openRoutes.id,
        name: openRoutes.name,
        distanceKm: openRoutes.distanceKm,
        durationMin: openRoutes.durationMin,
        price: openRoutes.price,
        status: openRoutes.status,
        notes: openRoutes.notes,
        companyName: companies.name,
        createdAt: openRoutes.createdAt,
      })
      .from(openRoutes)
      .leftJoin(companies, eq(companies.id, openRoutes.companyId))
      .where(and(...parts))
      .orderBy(desc(openRoutes.createdAt)),
  );
}

export async function getOpenRoute(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(openRoutes).where(and(eq(openRoutes.tenantId, tenantId), eq(openRoutes.id, id))),
  );
  return rows[0] ?? null;
}

/** Tüm firmaların vardiyaları — yönetim sayfası için. */
export async function listAllShifts(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(companyShifts.tenantId, tenantId)];
  if (scope !== null) {
    parts.push(scope.length > 0 ? inArray(companyShifts.companyId, scope) : eq(companyShifts.id, companyShifts.tenantId));
  }
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: companyShifts.id,
        name: companyShifts.name,
        expectedAt: companyShifts.expectedAt,
        toleranceEarly: companyShifts.toleranceEarly,
        toleranceLate: companyShifts.toleranceLate,
        isActive: companyShifts.isActive,
        companyName: companies.name,
      })
      .from(companyShifts)
      .innerJoin(companies, eq(companies.id, companyShifts.companyId))
      .where(and(...parts))
      .orderBy(asc(companies.name), asc(companyShifts.expectedAt)),
  );
}
