import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { companies, drivers, routes, tripLogs, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export type TripLogFilter = {
  from: string;
  to: string;
  companyId?: string;
  vehicleId?: string;
  status?: string;
  scope: string[] | null;
};

function buildWhere(tenantId: string, f: TripLogFilter): SQL {
  const parts: SQL[] = [
    eq(tripLogs.tenantId, tenantId),
    gte(tripLogs.logDate, f.from),
    lte(tripLogs.logDate, f.to),
  ];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(tripLogs.companyId, f.scope), isNull(tripLogs.companyId))!
        : isNull(tripLogs.companyId),
    );
  }
  if (f.companyId) parts.push(eq(tripLogs.companyId, f.companyId));
  if (f.vehicleId) parts.push(eq(tripLogs.vehicleId, f.vehicleId));
  if (f.status) parts.push(eq(tripLogs.status, f.status as "bekliyor"));
  return and(...parts)!;
}

export async function listTripLogs(tenantId: string, f: TripLogFilter) {
  const where = buildWhere(tenantId, f);
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: tripLogs.id,
        logDate: tripLogs.logDate,
        tripType: tripLogs.tripType,
        direction: tripLogs.direction,
        status: tripLogs.status,
        passengerCount: tripLogs.passengerCount,
        notes: tripLogs.notes,
        revertReason: tripLogs.revertReason,
        plate: vehicles.plate,
        routeName: routes.name,
        driverName: drivers.fullName,
        companyName: companies.name,
      })
      .from(tripLogs)
      .innerJoin(vehicles, eq(vehicles.id, tripLogs.vehicleId))
      .leftJoin(routes, eq(routes.id, tripLogs.routeId))
      .leftJoin(drivers, eq(drivers.id, tripLogs.driverId))
      .leftJoin(companies, eq(companies.id, tripLogs.companyId))
      .where(where)
      .orderBy(asc(tripLogs.logDate), asc(vehicles.plate)),
  );
}

/** Durum kırılımı — üstteki sayaçlar. */
export async function tripLogSummary(tenantId: string, f: TripLogFilter) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ status: tripLogs.status, adet: count(), yolcu: sql<number>`coalesce(sum(${tripLogs.passengerCount}), 0)` })
      .from(tripLogs)
      .where(buildWhere(tenantId, f))
      .groupBy(tripLogs.status),
  );

  const summary = { bekliyor: 0, onaylandi: 0, iptal: 0, toplamYolcu: 0 };
  for (const row of rows) {
    summary[row.status] = row.adet;
    summary.toplamYolcu += Number(row.yolcu);
  }
  return summary;
}

export async function getTripLog(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(tripLogs).where(and(eq(tripLogs.tenantId, tenantId), eq(tripLogs.id, id))),
  );
  return rows[0] ?? null;
}
