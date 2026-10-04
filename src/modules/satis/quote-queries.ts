import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { companies, crmDeals, crmLeads, crmQuotes, tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ownerVisibility, type VisibilitySession } from "./visibility";
import type { QuoteItem } from "./quotes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["draft", "sent", "accepted", "rejected"] as const;

export async function listQuotes(session: VisibilitySession, filter: { q?: string; status?: string } = {}) {
  const parts: (SQL | undefined)[] = [
    eq(crmQuotes.tenantId, session.tenantId),
    ownerVisibility(crmDeals.ownerUserId, session),
  ];
  if (filter.status && (STATUSES as readonly string[]).includes(filter.status)) {
    parts.push(eq(crmQuotes.status, filter.status as (typeof STATUSES)[number]));
  }
  if (filter.q) {
    const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(or(ilike(crmQuotes.number, like), ilike(crmQuotes.title, like), ilike(crmDeals.title, like)));
  }
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: crmQuotes.id,
        number: crmQuotes.number,
        title: crmQuotes.title,
        status: crmQuotes.status,
        total: crmQuotes.total,
        currency: crmQuotes.currency,
        validUntil: crmQuotes.validUntil,
        createdAt: crmQuotes.createdAt,
        dealId: crmDeals.id,
        dealTitle: crmDeals.title,
      })
      .from(crmQuotes)
      .innerJoin(crmDeals, eq(crmDeals.id, crmQuotes.dealId))
      .where(and(...parts))
      .orderBy(desc(crmQuotes.createdAt))
      .limit(500),
  );
}

export async function getQuote(session: VisibilitySession, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: crmQuotes.id,
        number: crmQuotes.number,
        title: crmQuotes.title,
        status: crmQuotes.status,
        items: crmQuotes.items,
        total: crmQuotes.total,
        currency: crmQuotes.currency,
        validUntil: crmQuotes.validUntil,
        notes: crmQuotes.notes,
        createdAt: crmQuotes.createdAt,
        dealId: crmDeals.id,
        dealTitle: crmDeals.title,
        companyName: companies.name,
        companyPhone: companies.phone,
        companyEmail: companies.email,
        leadName: crmLeads.name,
        leadContact: crmLeads.contactName,
        leadPhone: crmLeads.phone,
        leadEmail: crmLeads.email,
        ownerName: users.name,
        ownerEmail: users.email,
        tenantName: tenants.name,
      })
      .from(crmQuotes)
      .innerJoin(crmDeals, eq(crmDeals.id, crmQuotes.dealId))
      .innerJoin(tenants, eq(tenants.id, crmQuotes.tenantId))
      .leftJoin(companies, eq(companies.id, crmDeals.companyId))
      .leftJoin(crmLeads, eq(crmLeads.id, crmDeals.leadId))
      .leftJoin(users, eq(users.id, crmDeals.ownerUserId))
      .where(
        and(
          eq(crmQuotes.tenantId, session.tenantId),
          eq(crmQuotes.id, id),
          ownerVisibility(crmDeals.ownerUserId, session),
        ),
      );
    return row ? { ...row, items: row.items as QuoteItem[] } : null;
  });
}

/** Yeni teklif için açık fırsatlar (kapanmamış), görünürlüğe uyar. */
export async function listQuotableDeals(session: VisibilitySession) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({ id: crmDeals.id, title: crmDeals.title })
      .from(crmDeals)
      .where(
        and(
          eq(crmDeals.tenantId, session.tenantId),
          ownerVisibility(crmDeals.ownerUserId, session),
        ),
      )
      .orderBy(desc(crmDeals.updatedAt))
      .limit(300),
  );
}

export async function getDealTitle(session: VisibilitySession, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: crmDeals.id, title: crmDeals.title })
      .from(crmDeals)
      .where(and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.id, id), ownerVisibility(crmDeals.ownerUserId, session)));
    return row ?? null;
  });
}
