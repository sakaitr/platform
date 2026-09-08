import { and, asc, count, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { companies } from "@/db/schema";
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
