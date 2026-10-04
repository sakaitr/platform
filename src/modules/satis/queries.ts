import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  crmActivities,
  crmContacts,
  crmDeals,
  crmLeads,
  crmStages,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ownerVisibility, type VisibilitySession } from "./visibility";

export const PAGE_SIZE = 50;

export const SORTS = {
  yeni: desc(crmLeads.createdAt),
  eski: asc(crmLeads.createdAt),
  ad: asc(crmLeads.name),
  puan: desc(crmLeads.score),
  takip: asc(sql`${crmLeads.followUpAt} NULLS LAST`),
} as const;
export type LeadSort = keyof typeof SORTS;

export type LeadFilter = {
  q?: string;
  status?: string;
  temperature?: string;
  source?: string;
  /** "ben" | "sahipsiz" | kullanıcı kimliği */
  owner?: string;
  sort?: string;
  page?: number;
};

const STATUSES = ["new", "contacted", "qualified", "disqualified", "converted"] as const;
const TEMPS = ["hot", "warm", "cold"] as const;
const SOURCES = ["atricard", "webform", "csv", "manual", "api"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function leadWhere(session: VisibilitySession, f: LeadFilter): SQL {
  const parts: (SQL | undefined)[] = [
    eq(crmLeads.tenantId, session.tenantId),
    ownerVisibility(crmLeads.ownerUserId, session),
  ];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    parts.push(
      or(
        ilike(crmLeads.name, like),
        ilike(crmLeads.contactName, like),
        ilike(crmLeads.phone, like),
        ilike(crmLeads.email, like),
        ilike(crmLeads.website, like),
        ilike(crmLeads.city, like),
      ),
    );
  }
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) {
    parts.push(eq(crmLeads.status, f.status as (typeof STATUSES)[number]));
  }
  if (f.temperature && (TEMPS as readonly string[]).includes(f.temperature)) {
    parts.push(eq(crmLeads.temperature, f.temperature as (typeof TEMPS)[number]));
  }
  if (f.source && (SOURCES as readonly string[]).includes(f.source)) {
    parts.push(eq(crmLeads.source, f.source as (typeof SOURCES)[number]));
  }
  if (f.owner === "ben") parts.push(eq(crmLeads.ownerUserId, session.userId));
  else if (f.owner === "sahipsiz") parts.push(isNull(crmLeads.ownerUserId));
  else if (f.owner && UUID_RE.test(f.owner)) parts.push(eq(crmLeads.ownerUserId, f.owner));
  return and(...parts)!;
}

const leadColumns = {
  id: crmLeads.id,
  name: crmLeads.name,
  contactName: crmLeads.contactName,
  phone: crmLeads.phone,
  email: crmLeads.email,
  website: crmLeads.website,
  city: crmLeads.city,
  sector: crmLeads.sector,
  service: crmLeads.service,
  score: crmLeads.score,
  temperature: crmLeads.temperature,
  status: crmLeads.status,
  source: crmLeads.source,
  eventName: crmLeads.eventName,
  ownerUserId: crmLeads.ownerUserId,
  ownerName: users.name,
  estimatedValue: crmLeads.estimatedValue,
  followUpAt: crmLeads.followUpAt,
  createdAt: crmLeads.createdAt,
};

export async function listLeads(session: VisibilitySession, filter: LeadFilter) {
  const where = leadWhere(session, filter);
  const page = Math.max(1, Math.floor(filter.page ?? 1) || 1);
  const order = SORTS[filter.sort && Object.hasOwn(SORTS, filter.sort) ? (filter.sort as LeadSort) : "yeni"];

  return withTenant(session.tenantId, async (tx) => {
    const rows = await tx
      .select(leadColumns)
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(where)
      .orderBy(order, asc(crmLeads.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const [total] = await tx.select({ value: count() }).from(crmLeads).where(where);
    const totalCount = total?.value ?? 0;
    return { rows, total: totalCount, page, pageCount: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) };
  });
}

/** Dışa aktarma: sayfalama yok, üst sınır 10.000. Görünürlük ve filtreler aynı. */
export async function listLeadsForExport(session: VisibilitySession, filter: LeadFilter) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        ...leadColumns,
        message: crmLeads.message,
        note: crmLeads.note,
      })
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(leadWhere(session, filter))
      .orderBy(desc(crmLeads.createdAt), asc(crmLeads.id))
      .limit(10_000),
  );
}

/** Aday detayı. Satışçı görmeye yetkili olmadığı adayı alamaz (null döner). */
export async function getLeadDetail(session: VisibilitySession, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withTenant(session.tenantId, async (tx) => {
    const [lead] = await tx
      .select({
        ...leadColumns,
        message: crmLeads.message,
        note: crmLeads.note,
        convertedCompanyId: crmLeads.convertedCompanyId,
        updatedAt: crmLeads.updatedAt,
      })
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(
        and(
          eq(crmLeads.tenantId, session.tenantId),
          eq(crmLeads.id, id),
          ownerVisibility(crmLeads.ownerUserId, session),
        ),
      );
    if (!lead) return null;

    const contacts = await tx
      .select()
      .from(crmContacts)
      .where(and(eq(crmContacts.tenantId, session.tenantId), eq(crmContacts.leadId, id)))
      .orderBy(asc(crmContacts.createdAt));
    const deals = await tx
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        value: crmDeals.value,
        currency: crmDeals.currency,
        stageLabel: crmStages.label,
        stageKind: crmStages.kind,
      })
      .from(crmDeals)
      .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
      .where(and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.leadId, id)))
      .orderBy(desc(crmDeals.createdAt));
    const activities = await tx
      .select()
      .from(crmActivities)
      .where(and(eq(crmActivities.tenantId, session.tenantId), eq(crmActivities.leadId, id)))
      .orderBy(desc(crmActivities.createdAt))
      .limit(50);
    return { lead, contacts, deals, activities };
  });
}

/** Sahip açılır listesi: kiracının etkin kullanıcıları. */
export async function listOwnerOptions(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
      .orderBy(asc(users.name)),
  );
}
