import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { drivers, fuelCards, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { FILO_TABLES, getFiloRecord } from "./registry";

export const PAGE_SIZE = 50;

export type FiloRecordFilter = {
  vehicleId?: string;
  from?: string;
  to?: string;
  page?: number;
  scope: string[] | null;
};

type AnyTable = Record<string, never>;

/** Kayıt tablosunda araç dışında sürücü sütunu var mı. */
const HAS_DRIVER = new Set(["kazalar", "cezalar", "arizalar"]);

/**
 * Tek jenerik listeleme. Kayıt tipi ne olursa olsun aynı şekil döner:
 * satırlar + plaka + (varsa) sürücü adı + toplam.
 * Kapsam süzgeci aracın firmasından uygulanır — alt kayıtta firma sütunu yok.
 */
export async function listFiloRecords(tenantId: string, key: string, f: FiloRecordFilter) {
  const def = getFiloRecord(key);
  if (!def) throw new Error(`Bilinmeyen filo kaydı: ${key}`);
  const table = FILO_TABLES[key as keyof typeof FILO_TABLES] as unknown as Record<string, never>;
  const col = (name: string): never => table[name];

  const parts: SQL[] = [eq(col("tenantId"), tenantId)];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(vehicles.companyId, f.scope), isNull(vehicles.companyId))!
        : isNull(vehicles.companyId),
    );
  }
  if (f.vehicleId) parts.push(eq(col("vehicleId"), f.vehicleId));
  if (f.from) parts.push(gte(col(def.dateField), f.from));
  if (f.to) parts.push(lte(col(def.dateField), f.to));
  const where = and(...parts)!;
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const selection: Record<string, unknown> = {
      id: col("id"),
      plate: vehicles.plate,
      companyId: vehicles.companyId,
    };
    for (const column of def.columns) {
      if (column.key === "plate" || column.key === "driverName" || column.key === "tuketim") continue;
      selection[column.key] = col(column.key);
    }
    for (const field of def.fields({ vehicles: [], drivers: [], companies: [], terms: (k) => k })) {
      if (!(field.name in selection)) selection[field.name] = col(field.name);
    }
    if (HAS_DRIVER.has(key)) selection.driverName = drivers.fullName;
    if (key === "yakit") {
      selection.tuketim = sql<number | null>`
        case when ${col("currentKm")} is not null
              and ${col("previousKm")} is not null
              and ${col("currentKm")} > ${col("previousKm")}
             then round(${col("liters")} * 100.0 / (${col("currentKm")} - ${col("previousKm")}), 2)
        end`;
    }

    let query = tx
      .select(selection as never)
      .from(table as never)
      .innerJoin(vehicles, eq(vehicles.id, col("vehicleId")))
      .$dynamic();
    if (HAS_DRIVER.has(key)) query = query.leftJoin(drivers, eq(drivers.id, col("driverId")));

    const rows = (await query
      .where(where)
      .orderBy(desc(col(def.dateField)), asc(vehicles.plate))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE)) as Array<Record<string, unknown>>;

    const totals = (await tx
      .select({ value: count() })
      .from(table as never)
      .innerJoin(vehicles, eq(vehicles.id, col("vehicleId")))
      .where(where)) as Array<{ value: number }>;

    const n = totals[0]?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
  });
}

export async function getFiloRecordRow(tenantId: string, key: string, id: string) {
  const table = FILO_TABLES[key as keyof typeof FILO_TABLES] as unknown as Record<string, never>;
  if (!table) return null;
  const rows = (await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(table as never)
      .where(and(eq(table.tenantId, tenantId), eq(table.id, id))),
  )) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function fuelCardOptions(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: fuelCards.id, cardNo: fuelCards.cardNo, provider: fuelCards.provider })
      .from(fuelCards)
      .where(and(eq(fuelCards.tenantId, tenantId), eq(fuelCards.isActive, true)))
      .orderBy(asc(fuelCards.cardNo)),
  );
}
