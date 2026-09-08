import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import {
  companies,
  drivers,
  routeAssignments,
  routes,
  tripLogs,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export type Direction = "giris" | "cikis";

export type BoardEntry = {
  /** Satır anahtarı: güzergah + yön. */
  key: string;
  routeId: string;
  routeName: string;
  routeCode: string | null;
  companyName: string | null;
  shiftName: string | null;
  direction: Direction | null;
  /** O gün geçerli atamadan gelen araç. */
  vehicleId: string | null;
  plate: string | null;
  driverName: string | null;
  /** Bu satır o gün için zaten işlenmiş mi. */
  tripLogId: string | null;
  status: "islenmedi" | "bekliyor" | "onaylandi" | "iptal";
  passengerCount: number | null;
};

/** Yönü olmayan güzergah tek satır, iki yönlü olan iki satır üretir. */
function directionsOf(direction: string): Array<Direction | null> {
  if (direction === "gidis") return ["giris"];
  if (direction === "donus") return ["cikis"];
  return ["giris", "cikis"];
}

/**
 * Çetele tahtası: o gün koşması gereken güzergahlar listelenir,
 * işlenmiş olanlar durumuyla gelir.
 *
 * aycanops'taki kullanım deseni bu: operasyon sorumlusu boş forma kayıt
 * girmez, günün hatlarını toplu işaretler.
 */
export async function tripBoard(
  tenantId: string,
  input: { date: string; companyId?: string; scope: string[] | null },
): Promise<BoardEntry[]> {
  const parts: SQL[] = [eq(routes.tenantId, tenantId), eq(routes.isActive, true)];
  if (input.companyId) parts.push(eq(routes.companyId, input.companyId));
  if (input.scope !== null) {
    parts.push(
      input.scope.length > 0
        ? or(inArray(routes.companyId, input.scope), isNull(routes.companyId))!
        : isNull(routes.companyId),
    );
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        routeId: routes.id,
        routeName: routes.name,
        routeCode: routes.code,
        direction: routes.direction,
        shiftName: routes.shiftName,
        companyId: routes.companyId,
        companyName: companies.name,
        vehicleId: vehicles.id,
        plate: vehicles.plate,
        driverName: drivers.fullName,
      })
      .from(routes)
      .leftJoin(companies, eq(companies.id, routes.companyId))
      // O gün geçerli atama: başlamış ve bitmemiş olan.
      .leftJoin(
        routeAssignments,
        and(
          eq(routeAssignments.routeId, routes.id),
          lte(routeAssignments.startsOn, input.date),
          or(isNull(routeAssignments.endsOn), gte(routeAssignments.endsOn, input.date))!,
        ),
      )
      .leftJoin(vehicles, eq(vehicles.id, routeAssignments.vehicleId))
      .leftJoin(drivers, eq(drivers.id, routeAssignments.driverId))
      .where(and(...parts))
      .orderBy(asc(companies.name), asc(routes.name));

    const logs = await tx
      .select({
        id: tripLogs.id,
        routeId: tripLogs.routeId,
        direction: tripLogs.direction,
        status: tripLogs.status,
        passengerCount: tripLogs.passengerCount,
      })
      .from(tripLogs)
      .where(and(eq(tripLogs.tenantId, tenantId), eq(tripLogs.logDate, input.date)));

    const entries: BoardEntry[] = [];
    for (const row of rows) {
      for (const direction of directionsOf(row.direction)) {
        const log = logs.find(
          (l) => l.routeId === row.routeId && (l.direction ?? null) === direction,
        );
        entries.push({
          key: `${row.routeId}::${direction ?? ""}`,
          routeId: row.routeId,
          routeName: row.routeName,
          routeCode: row.routeCode,
          companyName: row.companyName,
          shiftName: row.shiftName,
          direction,
          vehicleId: row.vehicleId,
          plate: row.plate,
          driverName: row.driverName,
          tripLogId: log?.id ?? null,
          status: log ? log.status : "islenmedi",
          passengerCount: log?.passengerCount ?? null,
        });
      }
    }
    return entries;
  });
}

export function boardSummary(entries: readonly BoardEntry[]): {
  toplam: number;
  islenmedi: number;
  bekliyor: number;
  onaylandi: number;
  aracsiz: number;
} {
  return {
    toplam: entries.length,
    islenmedi: entries.filter((e) => e.status === "islenmedi").length,
    bekliyor: entries.filter((e) => e.status === "bekliyor").length,
    onaylandi: entries.filter((e) => e.status === "onaylandi").length,
    aracsiz: entries.filter((e) => e.vehicleId === null).length,
  };
}

/** İşlenmemiş ve aracı olan satırlar — toplu kayıt bunları alır. */
export function processable(entries: readonly BoardEntry[]): BoardEntry[] {
  return entries.filter((e) => e.status === "islenmedi" && e.vehicleId !== null);
}
