import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  budgetEntries,
  companies,
  companyFinance,
  deliveryNotes,
  earnings,
  financeCategories,
  financeTransactions,
  ledgerEntries,
  pricingForms,
  reconciliations,
  routePrices,
  routes,
  tripLogs,
  vehicleOperators,
  vehicles,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

export const PAGE_SIZE = 50;

/** Firma kolonu hangi tabloya aitse olsun aynı kapsam kuralı. */
function companyScope(column: PgColumn, scope: string[] | null): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return isNull(column);
  return or(inArray(column, scope), isNull(column));
}

/* ---------- İşletenler ---------- */

export async function listOperators(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(companies.tenantId, tenantId), eq(companies.type, "isleten")];
  if (scope !== null) {
    parts.push(scope.length > 0 ? inArray(companies.id, scope) : sql`false`);
  }
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: companies.id,
        name: companies.name,
        taxNumber: companies.taxNumber,
        phone: companies.phone,
        isActive: companies.isActive,
        accountCode: companyFinance.accountCode,
        iban: companyFinance.iban,
        withholdingPolicy: companyFinance.withholdingPolicy,
        contractEnd: companyFinance.contractEnd,
      })
      .from(companies)
      .leftJoin(companyFinance, eq(companyFinance.companyId, companies.id))
      .where(and(...parts))
      .orderBy(asc(companies.name)),
  );
}

export async function getCompanyFinance(tenantId: string, companyId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(companyFinance)
      .where(and(eq(companyFinance.tenantId, tenantId), eq(companyFinance.companyId, companyId))),
  );
  return rows[0] ?? null;
}

export async function listVehicleOperators(tenantId: string, vehicleId?: string) {
  const parts: SQL[] = [eq(vehicleOperators.tenantId, tenantId)];
  if (vehicleId) parts.push(eq(vehicleOperators.vehicleId, vehicleId));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: vehicleOperators.id,
        plate: vehicles.plate,
        operatorName: companies.name,
        startsOn: vehicleOperators.startsOn,
        endsOn: vehicleOperators.endsOn,
        kind: vehicleOperators.kind,
      })
      .from(vehicleOperators)
      .innerJoin(vehicles, eq(vehicles.id, vehicleOperators.vehicleId))
      .innerJoin(companies, eq(companies.id, vehicleOperators.operatorId))
      .where(and(...parts))
      .orderBy(desc(vehicleOperators.startsOn)),
  );
}

/* ---------- Ücretlendirme formları ---------- */

export async function listPricingForms(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(pricingForms)
      .where(eq(pricingForms.tenantId, tenantId))
      .orderBy(asc(pricingForms.groupName), asc(pricingForms.name)),
  );
}

/* ---------- Hakediş ---------- */

export type EarningFilter = {
  operatorId?: string;
  status?: string;
  from?: string;
  to?: string;
  scope: string[] | null;
};

export async function listEarnings(tenantId: string, f: EarningFilter) {
  const parts: SQL[] = [eq(earnings.tenantId, tenantId)];
  const sc = companyScope(earnings.operatorId, f.scope);
  if (sc) parts.push(sc);
  if (f.operatorId) parts.push(eq(earnings.operatorId, f.operatorId));
  if (f.status) parts.push(eq(earnings.status, f.status as "taslak"));
  if (f.from) parts.push(gte(earnings.periodStart, f.from));
  if (f.to) parts.push(lte(earnings.periodEnd, f.to));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: earnings.id,
        documentNo: earnings.documentNo,
        operatorName: companies.name,
        plate: vehicles.plate,
        periodStart: earnings.periodStart,
        periodEnd: earnings.periodEnd,
        tripCount: earnings.tripCount,
        gross: earnings.gross,
        vat: earnings.vat,
        withholding: earnings.withholding,
        deductions: earnings.deductions,
        net: earnings.net,
        status: earnings.status,
      })
      .from(earnings)
      .innerJoin(companies, eq(companies.id, earnings.operatorId))
      .leftJoin(vehicles, eq(vehicles.id, earnings.vehicleId))
      .where(and(...parts))
      .orderBy(desc(earnings.periodStart), asc(companies.name)),
  );
}

export async function getEarning(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(earnings).where(and(eq(earnings.tenantId, tenantId), eq(earnings.id, id))),
  );
  return rows[0] ?? null;
}

/**
 * Hakedişe girecek onaylı çeteleler.
 * Zaten başka bir hakedişe bağlanmış olanlar dışarıda kalır — çift ödeme olmaz.
 */
export async function eligibleTripLogs(
  tenantId: string,
  input: { operatorId: string; vehicleId?: string | null; from: string; to: string },
) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: tripLogs.id,
        logDate: tripLogs.logDate,
        tripType: tripLogs.tripType,
        plate: vehicles.plate,
        passengerCount: tripLogs.passengerCount,
      })
      .from(tripLogs)
      .innerJoin(vehicles, eq(vehicles.id, tripLogs.vehicleId))
      .innerJoin(
        vehicleOperators,
        and(
          eq(vehicleOperators.vehicleId, tripLogs.vehicleId),
          eq(vehicleOperators.operatorId, input.operatorId),
          lte(vehicleOperators.startsOn, tripLogs.logDate),
          or(isNull(vehicleOperators.endsOn), gte(vehicleOperators.endsOn, tripLogs.logDate))!,
        ),
      )
      .where(
        and(
          eq(tripLogs.tenantId, tenantId),
          eq(tripLogs.status, "onaylandi"),
          gte(tripLogs.logDate, input.from),
          lte(tripLogs.logDate, input.to),
          input.vehicleId ? eq(tripLogs.vehicleId, input.vehicleId) : undefined,
          sql`not exists (select 1 from earning_trip_logs e where e.trip_log_id = ${tripLogs.id})`,
        ),
      )
      .orderBy(asc(tripLogs.logDate)),
  );
}

/* ---------- Cari ---------- */

export async function listLedger(tenantId: string, companyId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.tenantId, tenantId), eq(ledgerEntries.companyId, companyId)))
      .orderBy(asc(ledgerEntries.entryDate), asc(ledgerEntries.createdAt)),
  );
}

/** Firma bazlı bakiye listesi — borç/alacak özeti. */
export async function listBalances(tenantId: string, scope: string[] | null) {
  const parts: SQL[] = [eq(ledgerEntries.tenantId, tenantId)];
  const sc = companyScope(ledgerEntries.companyId, scope);
  if (sc) parts.push(sc);

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        companyId: companies.id,
        companyName: companies.name,
        debit: sql<string>`coalesce(sum(${ledgerEntries.debit}), 0)`,
        credit: sql<string>`coalesce(sum(${ledgerEntries.credit}), 0)`,
        balance: sql<string>`coalesce(sum(${ledgerEntries.debit}) - sum(${ledgerEntries.credit}), 0)`,
        lastEntry: sql<string | null>`max(${ledgerEntries.entryDate})`,
      })
      .from(ledgerEntries)
      .innerJoin(companies, eq(companies.id, ledgerEntries.companyId))
      .where(and(...parts))
      .groupBy(companies.id, companies.name)
      .orderBy(asc(companies.name)),
  );
}

/* ---------- Mutabakat ---------- */

export async function listReconciliations(tenantId: string, period?: string) {
  const parts: SQL[] = [eq(reconciliations.tenantId, tenantId)];
  if (period) parts.push(eq(reconciliations.period, period));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: reconciliations.id,
        companyName: companies.name,
        period: reconciliations.period,
        balance: reconciliations.balance,
        status: reconciliations.status,
        sentAt: reconciliations.sentAt,
        respondedAt: reconciliations.respondedAt,
        objection: reconciliations.objection,
      })
      .from(reconciliations)
      .innerJoin(companies, eq(companies.id, reconciliations.companyId))
      .where(and(...parts))
      .orderBy(desc(reconciliations.period), asc(companies.name)),
  );
}

/* ---------- Gelir / gider ---------- */

export type TransactionFilter = {
  kind?: string;
  categoryId?: string;
  companyId?: string;
  from?: string;
  to?: string;
  page?: number;
  scope: string[] | null;
};

function transactionWhere(tenantId: string, f: TransactionFilter): SQL {
  const parts: SQL[] = [eq(financeTransactions.tenantId, tenantId)];
  const sc = companyScope(financeTransactions.companyId, f.scope);
  if (sc) parts.push(sc);
  if (f.kind) parts.push(eq(financeTransactions.kind, f.kind as "gider"));
  if (f.categoryId) parts.push(eq(financeTransactions.categoryId, f.categoryId));
  if (f.companyId) parts.push(eq(financeTransactions.companyId, f.companyId));
  if (f.from) parts.push(gte(financeTransactions.entryDate, f.from));
  if (f.to) parts.push(lte(financeTransactions.entryDate, f.to));
  return and(...parts)!;
}

export async function listTransactions(tenantId: string, f: TransactionFilter) {
  const where = transactionWhere(tenantId, f);
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: financeTransactions.id,
        kind: financeTransactions.kind,
        entryDate: financeTransactions.entryDate,
        documentNo: financeTransactions.documentNo,
        amount: financeTransactions.amount,
        vat: financeTransactions.vat,
        amountTry: financeTransactions.amountTry,
        currency: financeTransactions.currency,
        status: financeTransactions.status,
        description: financeTransactions.description,
        categoryName: financeCategories.name,
        companyName: companies.name,
        plate: vehicles.plate,
        routeName: routes.name,
      })
      .from(financeTransactions)
      .leftJoin(financeCategories, eq(financeCategories.id, financeTransactions.categoryId))
      .leftJoin(companies, eq(companies.id, financeTransactions.companyId))
      .leftJoin(vehicles, eq(vehicles.id, financeTransactions.vehicleId))
      .leftJoin(routes, eq(routes.id, financeTransactions.routeId))
      .where(where)
      .orderBy(desc(financeTransactions.entryDate), desc(financeTransactions.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);

    const totals = await tx
      .select({
        kind: financeTransactions.kind,
        toplam: sql<string>`coalesce(sum(${financeTransactions.amountTry}), 0)`,
        adet: sql<number>`count(*)`,
      })
      .from(financeTransactions)
      .where(where)
      .groupBy(financeTransactions.kind);

    const summary = { gelir: "0", gider: "0", adet: 0 };
    for (const row of totals) {
      summary[row.kind] = row.toplam;
      summary.adet += Number(row.adet);
    }
    const pageCount = Math.max(1, Math.ceil(summary.adet / PAGE_SIZE));
    return { rows, summary, page, pageCount };
  });
}

export async function getTransaction(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(financeTransactions)
      .where(and(eq(financeTransactions.tenantId, tenantId), eq(financeTransactions.id, id))),
  );
  return rows[0] ?? null;
}

export async function listCategories(tenantId: string, kind?: string) {
  const parts: SQL[] = [eq(financeCategories.tenantId, tenantId)];
  if (kind) parts.push(eq(financeCategories.kind, kind as "gider"));
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(financeCategories)
      .where(and(...parts))
      .orderBy(asc(financeCategories.kind), asc(financeCategories.name)),
  );
}

/* ---------- Kâr-zarar ---------- */

/** Aylık gelir/gider ve bütçe karşılaştırması. */
export async function profitAndLoss(tenantId: string, from: string, to: string) {
  return withTenant(tenantId, async (tx) => {
    const monthly = await tx
      .select({
        donem: sql<string>`to_char(${financeTransactions.entryDate}, 'YYYY-MM')`,
        kind: financeTransactions.kind,
        toplam: sql<string>`coalesce(sum(${financeTransactions.amountTry}), 0)`,
      })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.tenantId, tenantId),
          eq(financeTransactions.status, "tamamlandi"),
          gte(financeTransactions.entryDate, from),
          lte(financeTransactions.entryDate, to),
        ),
      )
      .groupBy(sql`1`, financeTransactions.kind)
      .orderBy(sql`1`);

    const byCategory = await tx
      .select({
        kategori: financeCategories.name,
        kind: financeTransactions.kind,
        toplam: sql<string>`coalesce(sum(${financeTransactions.amountTry}), 0)`,
      })
      .from(financeTransactions)
      .leftJoin(financeCategories, eq(financeCategories.id, financeTransactions.categoryId))
      .where(
        and(
          eq(financeTransactions.tenantId, tenantId),
          eq(financeTransactions.status, "tamamlandi"),
          gte(financeTransactions.entryDate, from),
          lte(financeTransactions.entryDate, to),
        ),
      )
      .groupBy(financeCategories.name, financeTransactions.kind)
      .orderBy(desc(sql`3`));

    const budgets = await tx
      .select({
        donem: budgetEntries.period,
        toplam: sql<string>`coalesce(sum(${budgetEntries.amount}), 0)`,
      })
      .from(budgetEntries)
      .where(
        and(
          eq(budgetEntries.tenantId, tenantId),
          gte(budgetEntries.period, from.slice(0, 7)),
          lte(budgetEntries.period, to.slice(0, 7)),
        ),
      )
      .groupBy(budgetEntries.period);

    return { monthly, byCategory, budgets };
  });
}

export async function listBudgets(tenantId: string, period?: string) {
  const parts: SQL[] = [eq(budgetEntries.tenantId, tenantId)];
  if (period) parts.push(eq(budgetEntries.period, period));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: budgetEntries.id,
        period: budgetEntries.period,
        amount: budgetEntries.amount,
        notes: budgetEntries.notes,
        categoryName: financeCategories.name,
        companyName: companies.name,
      })
      .from(budgetEntries)
      .leftJoin(financeCategories, eq(financeCategories.id, budgetEntries.categoryId))
      .leftJoin(companies, eq(companies.id, budgetEntries.companyId))
      .where(and(...parts))
      .orderBy(desc(budgetEntries.period)),
  );
}

/* ---------- İrsaliye ---------- */

export async function listDeliveryNotes(tenantId: string, f: { status?: string; scope: string[] | null }) {
  const parts: SQL[] = [eq(deliveryNotes.tenantId, tenantId)];
  const sc = companyScope(deliveryNotes.companyId, f.scope);
  if (sc) parts.push(sc);
  if (f.status) parts.push(eq(deliveryNotes.status, f.status as "taslak"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: deliveryNotes.id,
        documentNo: deliveryNotes.documentNo,
        issueDate: deliveryNotes.issueDate,
        shipDate: deliveryNotes.shipDate,
        description: deliveryNotes.description,
        quantity: deliveryNotes.quantity,
        unit: deliveryNotes.unit,
        status: deliveryNotes.status,
        fromAddress: deliveryNotes.fromAddress,
        toAddress: deliveryNotes.toAddress,
        companyName: companies.name,
        plate: vehicles.plate,
      })
      .from(deliveryNotes)
      .leftJoin(companies, eq(companies.id, deliveryNotes.companyId))
      .leftJoin(vehicles, eq(vehicles.id, deliveryNotes.vehicleId))
      .where(and(...parts))
      .orderBy(desc(deliveryNotes.issueDate), desc(deliveryNotes.documentNo)),
  );
}

export async function getDeliveryNote(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(deliveryNotes).where(and(eq(deliveryNotes.tenantId, tenantId), eq(deliveryNotes.id, id))),
  );
  return rows[0] ?? null;
}

/* ---------- Güzergah fiyatları ---------- */

export async function listRoutePrices(tenantId: string, routeId?: string) {
  const parts: SQL[] = [eq(routePrices.tenantId, tenantId)];
  if (routeId) parts.push(eq(routePrices.routeId, routeId));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: routePrices.id,
        routeName: routes.name,
        price: routePrices.price,
        currency: routePrices.currency,
        validFrom: routePrices.validFrom,
        validTo: routePrices.validTo,
        companyName: sql<string | null>`(select name from companies where id = ${routePrices.companyId})`,
        supplierName: sql<string | null>`(select name from companies where id = ${routePrices.supplierId})`,
      })
      .from(routePrices)
      .innerJoin(routes, eq(routes.id, routePrices.routeId))
      .where(and(...parts))
      .orderBy(desc(routePrices.validFrom)),
  );
}
