import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  companies,
  companyResponsibles,
  companyShifts,
  inspections,
  users,
  vehicleArrivals,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

export type CompanyFilter = {
  q?: string;
  type?: string;
  durum?: string;
  page?: number;
  /** null = kısıtlama yok */
  scope: string[] | null;
};

function buildWhere(tenantId: string, f: CompanyFilter): SQL {
  const parts: SQL[] = [eq(companies.tenantId, tenantId)];
  if (f.scope !== null) {
    // Kapsamı boş kullanıcı hiçbir firmayı görmemeli; imkânsız id ile susturuyoruz.
    parts.push(
      f.scope.length > 0
        ? inArray(companies.id, f.scope)
        : eq(companies.id, "00000000-0000-0000-0000-000000000000"),
    );
  }
  if (f.q) {
    const like = `%${f.q}%`;
    parts.push(
      or(ilike(companies.name, like), ilike(companies.code, like), ilike(companies.taxNumber, like))!,
    );
  }
  if (f.type) parts.push(eq(companies.type, f.type as "musteri"));
  if (f.durum === "aktif") parts.push(eq(companies.isActive, true));
  if (f.durum === "pasif") parts.push(eq(companies.isActive, false));
  return and(...parts)!;
}

export async function listCompanies(tenantId: string, filter: CompanyFilter) {
  const where = buildWhere(tenantId, filter);
  const page = Math.max(1, filter.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(companies)
      .where(where)
      .orderBy(asc(companies.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(companies).where(where);
    return { rows, total: total?.value ?? 0, page, pageCount: Math.max(1, Math.ceil((total?.value ?? 0) / PAGE_SIZE)) };
  });
}

/** Açılır listeler için hafif firma listesi — kapsam süzgeci uygulanır. */
export async function companyOptions(tenantId: string, scope: string[] | null) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(buildWhere(tenantId, { scope, durum: "aktif" }))
      .orderBy(asc(companies.name)),
  );
}

export async function getCompany(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id))),
  );
  return rows[0] ?? null;
}

/**
 * Firma detayı: sorumlular, vardiyalar, araçlar, son girişler ve
 * son 30 günün giriş sayısı tek çağrıda.
 */
export async function companyDetail(tenantId: string, companyId: string, from: string) {
  return withTenant(tenantId, async (tx) => {
    const [company] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)));
    if (!company) return null;

    const responsibles = await tx
      .select({ id: companyResponsibles.id, userId: users.id, name: users.name, email: users.email })
      .from(companyResponsibles)
      .innerJoin(users, eq(users.id, companyResponsibles.userId))
      .where(
        and(
          eq(companyResponsibles.tenantId, tenantId),
          eq(companyResponsibles.companyId, companyId),
        ),
      )
      .orderBy(asc(users.name));

    const shifts = await tx
      .select()
      .from(companyShifts)
      .where(and(eq(companyShifts.tenantId, tenantId), eq(companyShifts.companyId, companyId)))
      .orderBy(asc(companyShifts.expectedAt));

    const fleet = await tx
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        brand: vehicles.brand,
        model: vehicles.model,
        capacity: vehicles.capacity,
        status: vehicles.status,
      })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.companyId, companyId)))
      .orderBy(asc(vehicles.sortOrder), asc(vehicles.plate));

    const recentArrivals = await tx
      .select({
        id: vehicleArrivals.id,
        arrivalDate: vehicleArrivals.arrivalDate,
        shift: vehicleArrivals.shift,
        arrivedAt: vehicleArrivals.arrivedAt,
        plannedAt: vehicleArrivals.plannedAt,
        plate: vehicles.plate,
      })
      .from(vehicleArrivals)
      .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
      .where(
        and(eq(vehicleArrivals.tenantId, tenantId), eq(vehicleArrivals.companyId, companyId)),
      )
      .orderBy(desc(vehicleArrivals.arrivalDate), desc(vehicleArrivals.arrivedAt))
      .limit(20);

    const [monthly] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(vehicleArrivals)
      .where(
        and(
          eq(vehicleArrivals.tenantId, tenantId),
          eq(vehicleArrivals.companyId, companyId),
          gte(vehicleArrivals.arrivalDate, from),
        ),
      );

    const [lastInspection] = await tx
      .select({ date: inspections.inspectionDate, result: inspections.result })
      .from(inspections)
      .innerJoin(vehicles, eq(vehicles.id, inspections.vehicleId))
      .where(and(eq(inspections.tenantId, tenantId), eq(vehicles.companyId, companyId)))
      .orderBy(desc(inspections.inspectionDate))
      .limit(1);

    return {
      company,
      responsibles,
      shifts,
      fleet,
      recentArrivals,
      monthlyArrivals: Number(monthly?.value ?? 0),
      lastInspection: lastInspection ?? null,
    };
  });
}
