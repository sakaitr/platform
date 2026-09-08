import { and, asc, count, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { companies, passengers } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

export type PassengerFilter = {
  q?: string;
  companyId?: string;
  type?: string;
  durum?: string;
  page?: number;
  scope: string[] | null;
};

function buildWhere(tenantId: string, f: PassengerFilter): SQL {
  const parts: SQL[] = [eq(passengers.tenantId, tenantId)];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(passengers.companyId, f.scope), isNull(passengers.companyId))!
        : isNull(passengers.companyId),
    );
  }
  if (f.q) {
    const like = `%${f.q}%`;
    parts.push(
      or(
        ilike(passengers.fullName, like),
        ilike(passengers.phone, like),
        ilike(passengers.idNumber, like),
        ilike(passengers.barcode, like),
      )!,
    );
  }
  if (f.companyId) parts.push(eq(passengers.companyId, f.companyId));
  if (f.type) parts.push(eq(passengers.type, f.type as "yolcu"));
  if (f.durum === "aktif") parts.push(eq(passengers.isActive, true));
  if (f.durum === "pasif") parts.push(eq(passengers.isActive, false));
  return and(...parts)!;
}

export async function listPassengers(tenantId: string, f: PassengerFilter) {
  const where = buildWhere(tenantId, f);
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: passengers.id,
        fullName: passengers.fullName,
        phone: passengers.phone,
        type: passengers.type,
        grade: passengers.grade,
        branch: passengers.branch,
        serviceStatus: passengers.serviceStatus,
        isActive: passengers.isActive,
        pickupAddress: passengers.pickupAddress,
        companyName: companies.name,
      })
      .from(passengers)
      .leftJoin(companies, eq(companies.id, passengers.companyId))
      .where(where)
      .orderBy(asc(passengers.fullName))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(passengers).where(where);
    const n = total?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / PAGE_SIZE)) };
  });
}

export async function getPassenger(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(passengers).where(and(eq(passengers.tenantId, tenantId), eq(passengers.id, id))),
  );
  return rows[0] ?? null;
}
