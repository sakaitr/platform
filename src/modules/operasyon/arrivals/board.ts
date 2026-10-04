import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import {
  companyShifts,
  drivers,
  routeAssignments,
  routes,
  vehicleArrivals,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export type BoardRow = {
  vehicleId: string;
  plate: string;
  capacity: number | null;
  driverName: string | null;
  sortOrder: number;
  /** Geliş kaydı varsa dolu. */
  arrivalId: string | null;
  arrivedAt: string | null;
  plannedAt: string | null;
  expectedPassengers: number | null;
  actualPassengers: number | null;
  note: string | null;
  routeName: string | null;
  status: "bekliyor" | "zamaninda" | "gecikmeli";
  delayMinutes: number | null;
};

export type ShiftInfo = {
  id: string;
  name: string;
  expectedAt: string;
  toleranceEarly: number;
  toleranceLate: number;
};

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Giriş kontrol tahtası: firmanın BÜTÜN aktif araçları listelenir,
 * o gün/vardiya için geliş kaydı olan işaretli gelir.
 *
 * aycanops'taki kullanım deseni bu: kapıdaki görevli boş sayfaya kayıt
 * girmez, beklenen listeden gelen aracı işaretler.
 */
export async function arrivalBoard(
  tenantId: string,
  input: { companyId: string; date: string; shift: string },
): Promise<BoardRow[]> {
  const shift = await getShift(tenantId, input.companyId, input.shift);

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        vehicleId: vehicles.id,
        plate: vehicles.plate,
        capacity: vehicles.capacity,
        sortOrder: vehicles.sortOrder,
        driverName: drivers.fullName,
        arrivalId: vehicleArrivals.id,
        arrivedAt: vehicleArrivals.arrivedAt,
        plannedAt: vehicleArrivals.plannedAt,
        expectedPassengers: vehicleArrivals.expectedPassengers,
        actualPassengers: vehicleArrivals.actualPassengers,
        note: vehicleArrivals.note,
        routeName: routes.name,
      })
      .from(vehicles)
      // Sürücü araca değil, güzergah atamasına bağlı: o gün geçerli olan atama.
      .leftJoin(
        routeAssignments,
        and(
          eq(routeAssignments.vehicleId, vehicles.id),
          lte(routeAssignments.startsOn, input.date),
          or(isNull(routeAssignments.endsOn), gte(routeAssignments.endsOn, input.date))!,
        ),
      )
      .leftJoin(drivers, eq(drivers.id, routeAssignments.driverId))
      .leftJoin(
        vehicleArrivals,
        and(
          eq(vehicleArrivals.vehicleId, vehicles.id),
          eq(vehicleArrivals.arrivalDate, input.date),
          eq(vehicleArrivals.shift, input.shift),
        ),
      )
      .leftJoin(routes, eq(routes.id, vehicleArrivals.routeId))
      .where(
        and(
          eq(vehicles.tenantId, tenantId),
          eq(vehicles.companyId, input.companyId),
          eq(vehicles.status, "aktif"),
        ),
      )
      .orderBy(asc(vehicles.sortOrder), asc(vehicles.plate)),
  );

  return rows.map((row) => {
    // Planlanan saat: kayıtta varsa o, yoksa vardiyanın beklenen saati.
    const planned = row.plannedAt ?? shift?.expectedAt ?? null;
    if (!row.arrivedAt) {
      return { ...row, plannedAt: planned, status: "bekliyor" as const, delayMinutes: null };
    }
    if (!planned) {
      return { ...row, plannedAt: null, status: "zamaninda" as const, delayMinutes: null };
    }

    const delay = toMinutes(row.arrivedAt) - toMinutes(planned);
    const tolerance = shift?.toleranceLate ?? 0;
    return {
      ...row,
      plannedAt: planned,
      status: delay > tolerance ? ("gecikmeli" as const) : ("zamaninda" as const),
      delayMinutes: delay,
    };
  });
}

export async function listShifts(tenantId: string, companyId: string): Promise<ShiftInfo[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: companyShifts.id,
        name: companyShifts.name,
        expectedAt: companyShifts.expectedAt,
        toleranceEarly: companyShifts.toleranceEarly,
        toleranceLate: companyShifts.toleranceLate,
      })
      .from(companyShifts)
      .where(
        and(
          eq(companyShifts.tenantId, tenantId),
          eq(companyShifts.companyId, companyId),
          eq(companyShifts.isActive, true),
        ),
      )
      .orderBy(asc(companyShifts.expectedAt)),
  );
}

async function getShift(
  tenantId: string,
  companyId: string,
  name: string,
): Promise<ShiftInfo | null> {
  const rows = await listShifts(tenantId, companyId);
  return rows.find((s) => s.name === name) ?? null;
}

/**
 * Şu saate en yakın vardiyayı seçer (±3 saat).
 * Sabah 07:40'ta sayfayı açan görevli sabah vardiyasını hazır bulur.
 */
export function pickShift(shifts: readonly ShiftInfo[], nowMinutes: number): string | null {
  if (shifts.length === 0) return null;

  let best: ShiftInfo | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const shift of shifts) {
    const distance = Math.abs(nowMinutes - toMinutes(shift.expectedAt));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = shift;
    }
  }
  return bestDistance <= 180 ? best!.name : shifts[0]!.name;
}

/**
 * Plaka son ekiyle eşleştirir — görevli "01" yazınca 34ABC01 bulunur.
 * Birden çok eşleşme dönerse kullanıcıya seçtirilir.
 */
export function matchByPlate(rows: readonly BoardRow[], query: string): BoardRow[] {
  const needle = query.toLocaleUpperCase("tr-TR").replace(/[\s-]+/g, "");
  if (needle.length === 0) return [];
  return rows.filter((r) => r.plate.endsWith(needle));
}

/** Firmanın o gün/vardiya için geliş özeti. */
export function boardSummary(rows: readonly BoardRow[]): {
  toplam: number;
  gelen: number;
  bekleyen: number;
  geciken: number;
} {
  return {
    toplam: rows.length,
    gelen: rows.filter((r) => r.arrivalId !== null).length,
    bekleyen: rows.filter((r) => r.status === "bekliyor").length,
    geciken: rows.filter((r) => r.status === "gecikmeli").length,
  };
}
