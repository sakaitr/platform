import { and, asc, count, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { companies, drivers, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

/** Kapsamlı kullanıcı: yalnız kendi firmalarının + firmasız (kiracıya ait) kayıtlar. */
function scopeClause(
  column: typeof vehicles.companyId | typeof drivers.companyId,
  scope: string[] | null,
): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return isNull(column);
  return or(inArray(column, scope), isNull(column));
}

export type VehicleFilter = {
  q?: string;
  companyId?: string;
  status?: string;
  page?: number;
  scope: string[] | null;
};

export async function listVehicles(tenantId: string, f: VehicleFilter) {
  const parts: SQL[] = [eq(vehicles.tenantId, tenantId)];
  const sc = scopeClause(vehicles.companyId, f.scope);
  if (sc) parts.push(sc);
  if (f.q) {
    const like = `%${f.q.toLocaleUpperCase("tr-TR").replace(/[\s-]+/g, "")}%`;
    parts.push(or(ilike(vehicles.plate, like), ilike(vehicles.brand, `%${f.q}%`), ilike(vehicles.model, `%${f.q}%`))!);
  }
  if (f.companyId) parts.push(eq(vehicles.companyId, f.companyId));
  if (f.status) parts.push(eq(vehicles.status, f.status as "aktif"));
  const where = and(...parts)!;
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        modelYear: vehicles.modelYear,
        capacity: vehicles.capacity,
        vehicleType: vehicles.vehicleType,
        status: vehicles.status,
        companyId: vehicles.companyId,
        companyName: companies.name,
      })
      .from(vehicles)
      .leftJoin(companies, eq(companies.id, vehicles.companyId))
      .where(where)
      .orderBy(asc(vehicles.plate))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(vehicles).where(where);
    const n = total?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
  });
}

export async function getVehicle(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(vehicles).where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.id, id))),
  );
  return rows[0] ?? null;
}

/** Açılır listeler — plaka + kapasite (güzergah atamasında kapasite lazım). */
export async function vehicleOptions(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(vehicles.tenantId, tenantId), eq(vehicles.status, "aktif")];
  const sc = scopeClause(vehicles.companyId, scope);
  if (sc) parts.push(sc);
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: vehicles.id, plate: vehicles.plate, capacity: vehicles.capacity, companyId: vehicles.companyId })
      .from(vehicles)
      .where(and(...parts))
      .orderBy(asc(vehicles.plate)),
  );
}

export type DriverFilter = { q?: string; status?: string; page?: number; scope: string[] | null };

export async function listDrivers(tenantId: string, f: DriverFilter) {
  const parts: SQL[] = [eq(drivers.tenantId, tenantId)];
  const sc = scopeClause(drivers.companyId, f.scope);
  if (sc) parts.push(sc);
  if (f.q) parts.push(or(ilike(drivers.fullName, `%${f.q}%`), ilike(drivers.phone, `%${f.q}%`))!);
  if (f.status) parts.push(eq(drivers.status, f.status as "aktif"));
  const where = and(...parts)!;
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: drivers.id,
        fullName: drivers.fullName,
        phone: drivers.phone,
        licenseClass: drivers.licenseClass,
        licenseExpiry: drivers.licenseExpiry,
        status: drivers.status,
        companyName: companies.name,
      })
      .from(drivers)
      .leftJoin(companies, eq(companies.id, drivers.companyId))
      .where(where)
      .orderBy(asc(drivers.fullName))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(drivers).where(where);
    const n = total?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
  });
}

export async function getDriver(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(drivers).where(and(eq(drivers.tenantId, tenantId), eq(drivers.id, id))),
  );
  return rows[0] ?? null;
}
