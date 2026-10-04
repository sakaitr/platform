import { and, asc, count, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { companies, drivers, vehicleArrivals, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export type ArrivalFilter = {
  date: string;
  companyId?: string;
  shift?: string;
  scope: string[] | null;
};

function buildWhere(tenantId: string, f: ArrivalFilter): SQL {
  const parts: SQL[] = [
    eq(vehicleArrivals.tenantId, tenantId),
    eq(vehicleArrivals.arrivalDate, f.date),
  ];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(vehicleArrivals.companyId, f.scope), isNull(vehicleArrivals.companyId))!
        : isNull(vehicleArrivals.companyId),
    );
  }
  if (f.companyId) parts.push(eq(vehicleArrivals.companyId, f.companyId));
  if (f.shift) parts.push(eq(vehicleArrivals.shift, f.shift));
  return and(...parts)!;
}

export async function listArrivals(tenantId: string, f: ArrivalFilter) {
  const where = buildWhere(tenantId, f);
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: vehicleArrivals.id,
        plate: vehicles.plate,
        companyName: companies.name,
        driverName: drivers.fullName,
        shift: vehicleArrivals.shift,
        arrivedAt: vehicleArrivals.arrivedAt,
        plannedAt: vehicleArrivals.plannedAt,
        note: vehicleArrivals.note,
      })
      .from(vehicleArrivals)
      .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
      .leftJoin(companies, eq(companies.id, vehicleArrivals.companyId))
      .leftJoin(drivers, eq(drivers.id, vehicleArrivals.driverId))
      .where(where)
      .orderBy(asc(vehicleArrivals.arrivedAt), asc(vehicles.plate)),
  );
}

/** O gün kullanılmış vardiya adları — filtre kutusunu doldurur. */
export async function shiftsOnDate(tenantId: string, date: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .selectDistinct({ shift: vehicleArrivals.shift })
      .from(vehicleArrivals)
      .where(and(eq(vehicleArrivals.tenantId, tenantId), eq(vehicleArrivals.arrivalDate, date)))
      .orderBy(asc(vehicleArrivals.shift)),
  );
  return rows.map((r) => r.shift);
}

export async function arrivalCount(tenantId: string, date: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ value: count() })
      .from(vehicleArrivals)
      .where(and(eq(vehicleArrivals.tenantId, tenantId), eq(vehicleArrivals.arrivalDate, date))),
  );
  return rows[0]?.value ?? 0;
}

/** Gecikme dakikası. Planlanan yoksa null. */
export function delayMinutes(planned: string | null, arrived: string): number | null {
  if (!planned) return null;
  const toMin = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return toMin(arrived) - toMin(planned);
}
