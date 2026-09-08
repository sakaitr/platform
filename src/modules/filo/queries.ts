import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import {
  companies,
  driverDocuments,
  drivers,
  fuelCards,
  inspections,
  vehicleCompanies,
  vehicleDocuments,
  vehicleMaintenance,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

/** Kapsamlı kullanıcı: yalnız kendi firmalarının + firmasız (kiracıya ait) kayıtlar. */
function scopeClause(
  column: typeof vehicles.companyId | typeof drivers.companyId | typeof fuelCards.companyId,
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
  /** plaka | firma | marka | kapasite */
  sirala?: string;
  page?: number;
  scope: string[] | null;
};

function vehicleOrder(f: VehicleFilter) {
  switch (f.sirala) {
    case "firma":
      return [asc(companies.name), asc(vehicles.plate)];
    case "marka":
      return [asc(vehicles.brand), asc(vehicles.model)];
    case "kapasite":
      return [desc(vehicles.capacity), asc(vehicles.plate)];
    default:
      return [asc(vehicles.plate)];
  }
}

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
        titleHolder: vehicles.titleHolder,
      })
      .from(vehicles)
      .leftJoin(companies, eq(companies.id, vehicles.companyId))
      .where(where)
      .orderBy(...vehicleOrder(f))
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

export async function listFuelCards(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(fuelCards.tenantId, tenantId)];
  const sc = scopeClause(fuelCards.companyId, scope);
  if (sc) parts.push(sc);
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: fuelCards.id,
        cardNo: fuelCards.cardNo,
        provider: fuelCards.provider,
        limitKind: fuelCards.limitKind,
        limitValue: fuelCards.limitValue,
        isActive: fuelCards.isActive,
        plate: vehicles.plate,
        companyName: companies.name,
      })
      .from(fuelCards)
      .leftJoin(vehicles, eq(vehicles.id, fuelCards.vehicleId))
      .leftJoin(companies, eq(companies.id, fuelCards.companyId))
      .where(and(...parts))
      .orderBy(asc(fuelCards.cardNo)),
  );
}

export async function getFuelCard(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(fuelCards).where(and(eq(fuelCards.tenantId, tenantId), eq(fuelCards.id, id))),
  );
  return rows[0] ?? null;
}

/** Aracın ek firma atamaları. */
export async function vehicleCompanyNames(tenantId: string, vehicleId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: vehicleCompanies.id, companyId: companies.id, name: companies.name })
      .from(vehicleCompanies)
      .innerJoin(companies, eq(companies.id, vehicleCompanies.companyId))
      .where(
        and(eq(vehicleCompanies.tenantId, tenantId), eq(vehicleCompanies.vehicleId, vehicleId)),
      )
      .orderBy(asc(companies.name)),
  );
}

/** Araç detay sayfası için tek seferde toplanan özet. */
export async function vehicleDetail(tenantId: string, vehicleId: string) {
  return withTenant(tenantId, async (tx) => {
    const [vehicle] = await tx
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        modelYear: vehicles.modelYear,
        capacity: vehicles.capacity,
        vehicleType: vehicles.vehicleType,
        titleHolder: vehicles.titleHolder,
        status: vehicles.status,
        notes: vehicles.notes,
        sortOrder: vehicles.sortOrder,
        companyId: vehicles.companyId,
        companyName: companies.name,
      })
      .from(vehicles)
      .leftJoin(companies, eq(companies.id, vehicles.companyId))
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.id, vehicleId)));
    if (!vehicle) return null;

    const documents = await tx
      .select()
      .from(vehicleDocuments)
      .where(
        and(eq(vehicleDocuments.tenantId, tenantId), eq(vehicleDocuments.vehicleId, vehicleId)),
      )
      .orderBy(asc(vehicleDocuments.expiresOn));

    const maintenance = await tx
      .select({
        id: vehicleMaintenance.id,
        maintenanceDate: vehicleMaintenance.maintenanceDate,
        type: vehicleMaintenance.type,
        kmAtService: vehicleMaintenance.kmAtService,
        cost: vehicleMaintenance.cost,
        status: vehicleMaintenance.status,
      })
      .from(vehicleMaintenance)
      .where(
        and(
          eq(vehicleMaintenance.tenantId, tenantId),
          eq(vehicleMaintenance.vehicleId, vehicleId),
        ),
      )
      .orderBy(desc(vehicleMaintenance.maintenanceDate))
      .limit(10);

    const inspections_ = await tx
      .select({
        id: inspections.id,
        inspectionDate: inspections.inspectionDate,
        type: inspections.type,
        result: inspections.result,
      })
      .from(inspections)
      .where(and(eq(inspections.tenantId, tenantId), eq(inspections.vehicleId, vehicleId)))
      .orderBy(desc(inspections.inspectionDate))
      .limit(10);

    return { vehicle, documents, maintenance, inspections: inspections_ };
  });
}

export async function listDriverDocuments(tenantId: string, driverId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(driverDocuments)
      .where(and(eq(driverDocuments.tenantId, tenantId), eq(driverDocuments.driverId, driverId)))
      .orderBy(asc(driverDocuments.expiresOn)),
  );
}
