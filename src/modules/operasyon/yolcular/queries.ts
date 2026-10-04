import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { companies, passengers, paymentPlans, routes, serviceChanges } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

export type PassengerFilter = {
  q?: string;
  companyId?: string;
  routeId?: string;
  type?: string;
  durum?: string;
  /** ad | firma | tur | durum */
  sirala?: string;
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
  if (f.routeId) parts.push(eq(passengers.routeId, f.routeId));
  return and(...parts)!;
}

/** Sıralama seçenekleri — aycanops'taki "Ada göre / Firmaya göre / Türe göre / Duruma göre". */
function orderBy(f: PassengerFilter) {
  switch (f.sirala) {
    case "firma":
      return [asc(companies.name), asc(passengers.fullName)];
    case "tur":
      return [asc(passengers.type), asc(passengers.fullName)];
    case "durum":
      return [asc(passengers.serviceStatus), asc(passengers.fullName)];
    default:
      return [asc(passengers.fullName)];
  }
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
        contractStatus: passengers.contractStatus,
        direction: passengers.direction,
        isActive: passengers.isActive,
        pickupAddress: passengers.pickupAddress,
        barcode: passengers.barcode,
        companyName: companies.name,
        routeName: routes.name,
        planName: paymentPlans.name,
      })
      .from(passengers)
      .leftJoin(companies, eq(companies.id, passengers.companyId))
      .leftJoin(routes, eq(routes.id, passengers.routeId))
      .leftJoin(paymentPlans, eq(paymentPlans.id, passengers.paymentPlanId))
      .where(where)
      .orderBy(...orderBy(f))
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

export async function listPaymentPlans(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(paymentPlans)
      .where(eq(paymentPlans.tenantId, tenantId))
      .orderBy(asc(paymentPlans.name)),
  );
}

/** Yolcunun servis değişiklikleri — geçici güzergah geçmişi. */
export async function listServiceChanges(tenantId: string, passengerId?: string) {
  const parts: SQL[] = [eq(serviceChanges.tenantId, tenantId)];
  if (passengerId) parts.push(eq(serviceChanges.passengerId, passengerId));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: serviceChanges.id,
        passengerName: passengers.fullName,
        startsOn: serviceChanges.startsOn,
        endsOn: serviceChanges.endsOn,
        direction: serviceChanges.direction,
        notes: serviceChanges.notes,
        temporaryRoute: routes.name,
      })
      .from(serviceChanges)
      .innerJoin(passengers, eq(passengers.id, serviceChanges.passengerId))
      .leftJoin(routes, eq(routes.id, serviceChanges.temporaryRouteId))
      .where(and(...parts))
      .orderBy(desc(serviceChanges.startsOn)),
  );
}
