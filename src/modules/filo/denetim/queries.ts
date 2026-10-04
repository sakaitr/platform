import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  companies,
  inspectionCriteria,
  inspectionTypes,
  inspections,
  users,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { listFiles } from "@/lib/storage";

export type InspectionFilter = {
  vehicleId?: string;
  companyId?: string;
  typeId?: string;
  result?: string;
  from?: string;
  to?: string;
};

export async function listInspections(tenantId: string, f: InspectionFilter) {
  const parts: SQL[] = [eq(inspections.tenantId, tenantId)];
  if (f.vehicleId) parts.push(eq(inspections.vehicleId, f.vehicleId));
  if (f.companyId) parts.push(eq(inspections.companyId, f.companyId));
  if (f.typeId) parts.push(eq(inspections.typeId, f.typeId));
  if (f.result) parts.push(eq(inspections.result, f.result as "gecti"));
  if (f.from) parts.push(gte(inspections.inspectionDate, f.from));
  if (f.to) parts.push(lte(inspections.inspectionDate, f.to));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: inspections.id,
        inspectionDate: inspections.inspectionDate,
        type: inspections.type,
        typeLabel: inspectionTypes.label,
        result: inspections.result,
        deadline: inspections.deadline,
        checklist: inspections.checklist,
        notes: inspections.notes,
        plate: vehicles.plate,
        companyName: companies.name,
        inspectorName: users.name,
      })
      .from(inspections)
      .innerJoin(vehicles, eq(vehicles.id, inspections.vehicleId))
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspections.typeId))
      .leftJoin(companies, eq(companies.id, inspections.companyId))
      .leftJoin(users, eq(users.id, inspections.inspectorId))
      .where(and(...parts))
      .orderBy(desc(inspections.inspectionDate)),
  );
}

export async function getInspection(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: inspections.id,
        vehicleId: inspections.vehicleId,
        typeId: inspections.typeId,
        companyId: inspections.companyId,
        inspectionDate: inspections.inspectionDate,
        type: inspections.type,
        result: inspections.result,
        deadline: inspections.deadline,
        checklist: inspections.checklist,
        notes: inspections.notes,
        plate: vehicles.plate,
        typeLabel: inspectionTypes.label,
      })
      .from(inspections)
      .innerJoin(vehicles, eq(vehicles.id, inspections.vehicleId))
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspections.typeId))
      .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, id))),
  );
  const row = rows[0];
  if (!row) return null;

  const photos = await listFiles(tenantId, "inspection", id);
  return { ...row, photos };
}

export async function listInspectionTypes(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(inspectionTypes)
      .where(eq(inspectionTypes.tenantId, tenantId))
      .orderBy(asc(inspectionTypes.position), asc(inspectionTypes.label)),
  );
}

/** Bir tipin kriterleri — sihirbaz bu sırayla ilerler. */
export async function listCriteria(tenantId: string, typeId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(inspectionCriteria)
      .where(
        and(
          eq(inspectionCriteria.tenantId, tenantId),
          eq(inspectionCriteria.typeId, typeId),
          eq(inspectionCriteria.isActive, true),
        ),
      )
      .orderBy(asc(inspectionCriteria.position), asc(inspectionCriteria.label)),
  );
}

export async function listAllCriteria(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: inspectionCriteria.id,
        label: inspectionCriteria.label,
        position: inspectionCriteria.position,
        isActive: inspectionCriteria.isActive,
        typeLabel: inspectionTypes.label,
        typeId: inspectionCriteria.typeId,
      })
      .from(inspectionCriteria)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionCriteria.typeId))
      .where(eq(inspectionCriteria.tenantId, tenantId))
      .orderBy(asc(inspectionTypes.label), asc(inspectionCriteria.position)),
  );
}

/** Hiç denetlenmemiş aktif araçlar — denetim planlamasının açığı. */
export async function neverInspected(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: vehicles.id, plate: vehicles.plate, companyName: companies.name })
      .from(vehicles)
      .leftJoin(companies, eq(companies.id, vehicles.companyId))
      .where(
        and(
          eq(vehicles.tenantId, tenantId),
          eq(vehicles.status, "aktif"),
          sql`not exists (select 1 from inspections i where i.vehicle_id = ${vehicles.id})`,
        ),
      )
      .orderBy(asc(vehicles.plate)),
  );
}
