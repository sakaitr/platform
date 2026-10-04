import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { companies, crmActivities, crmDeals, crmLeads, crmQuotes, crmStages, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { istanbulDayKey } from "@/lib/time";
import { istanbulDayRange } from "./dates";
import { ensureDefaultStages } from "./stage-service";
import { ownerVisibility, type VisibilitySession } from "./visibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listStages(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    await ensureDefaultStages(tx, tenantId);
    return tx
      .select()
      .from(crmStages)
      .where(eq(crmStages.tenantId, tenantId))
      .orderBy(asc(crmStages.position), asc(crmStages.createdAt));
  });
}

/** Aşama başına en fazla bu kadar kart yüklenir; fazlası "daha fazla" ile liste görünümüne bırakılır. */
export const BOARD_CARDS_PER_STAGE = 100;

export async function getBoard(session: VisibilitySession, filter: { owner?: string } = {}) {
  const stages = await listStages(session.tenantId);
  const where: (SQL | undefined)[] = [
    eq(crmDeals.tenantId, session.tenantId),
    ownerVisibility(crmDeals.ownerUserId, session),
  ];
  if (filter.owner === "ben") where.push(eq(crmDeals.ownerUserId, session.userId));
  else if (filter.owner === "sahipsiz") where.push(isNull(crmDeals.ownerUserId));
  else if (filter.owner && UUID_RE.test(filter.owner)) where.push(eq(crmDeals.ownerUserId, filter.owner));

  return withTenant(session.tenantId, async (tx) => {
    const deals = await tx
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        stageId: crmDeals.stageId,
        value: crmDeals.value,
        currency: crmDeals.currency,
        ownerUserId: crmDeals.ownerUserId,
        ownerName: users.name,
        expectedCloseAt: crmDeals.expectedCloseAt,
        closedAt: crmDeals.closedAt,
        leadName: crmLeads.name,
        companyName: companies.name,
      })
      .from(crmDeals)
      .leftJoin(users, eq(users.id, crmDeals.ownerUserId))
      .leftJoin(crmLeads, eq(crmLeads.id, crmDeals.leadId))
      .leftJoin(companies, eq(companies.id, crmDeals.companyId))
      .where(and(...where))
      // Açık aşamada yakın kapanış üstte; kapalı aşamada en son kapanan üstte
      .orderBy(desc(crmDeals.updatedAt), asc(crmDeals.id));

    const totals = new Map<string, { count: number; value: number }>();
    for (const deal of deals) {
      const t = totals.get(deal.stageId) ?? { count: 0, value: 0 };
      t.count += 1;
      t.value += Number(deal.value);
      totals.set(deal.stageId, t);
    }
    const columns = stages.map((stage) => {
      const all = deals.filter((d) => d.stageId === stage.id);
      return {
        stage,
        deals: all.slice(0, BOARD_CARDS_PER_STAGE),
        count: totals.get(stage.id)?.count ?? 0,
        value: totals.get(stage.id)?.value ?? 0,
        truncated: all.length > BOARD_CARDS_PER_STAGE,
      };
    });
    return { columns };
  });
}

export async function getDealDetail(session: VisibilitySession, id: string) {
  if (!UUID_RE.test(id)) return null;
  return withTenant(session.tenantId, async (tx) => {
    const [deal] = await tx
      .select({
        id: crmDeals.id,
        title: crmDeals.title,
        stageId: crmDeals.stageId,
        stageLabel: crmStages.label,
        stageKind: crmStages.kind,
        value: crmDeals.value,
        currency: crmDeals.currency,
        ownerUserId: crmDeals.ownerUserId,
        ownerName: users.name,
        expectedCloseAt: crmDeals.expectedCloseAt,
        closedAt: crmDeals.closedAt,
        lostReason: crmDeals.lostReason,
        note: crmDeals.note,
        companyId: crmDeals.companyId,
        companyName: companies.name,
        leadId: crmDeals.leadId,
        leadName: crmLeads.name,
        createdAt: crmDeals.createdAt,
      })
      .from(crmDeals)
      .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
      .leftJoin(users, eq(users.id, crmDeals.ownerUserId))
      .leftJoin(companies, eq(companies.id, crmDeals.companyId))
      .leftJoin(crmLeads, eq(crmLeads.id, crmDeals.leadId))
      .where(
        and(
          eq(crmDeals.tenantId, session.tenantId),
          eq(crmDeals.id, id),
          ownerVisibility(crmDeals.ownerUserId, session),
        ),
      );
    if (!deal) return null;

    const activities = await tx
      .select({
        id: crmActivities.id,
        type: crmActivities.type,
        subject: crmActivities.subject,
        note: crmActivities.note,
        dueAt: crmActivities.dueAt,
        doneAt: crmActivities.doneAt,
        isSystem: crmActivities.isSystem,
        assigneeUserId: crmActivities.assigneeUserId,
        assigneeName: users.name,
        createdAt: crmActivities.createdAt,
      })
      .from(crmActivities)
      .leftJoin(users, eq(users.id, crmActivities.assigneeUserId))
      .where(and(eq(crmActivities.tenantId, session.tenantId), eq(crmActivities.dealId, id)))
      .orderBy(desc(crmActivities.createdAt))
      .limit(100);
    const quotes = await tx
      .select({
        id: crmQuotes.id,
        number: crmQuotes.number,
        title: crmQuotes.title,
        status: crmQuotes.status,
        total: crmQuotes.total,
        currency: crmQuotes.currency,
      })
      .from(crmQuotes)
      .where(and(eq(crmQuotes.tenantId, session.tenantId), eq(crmQuotes.dealId, id)))
      .orderBy(desc(crmQuotes.createdAt));
    return { deal, activities, quotes };
  });
}

export async function listCompanyOptions(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.type, "musteri"), eq(companies.isActive, true)))
      .orderBy(asc(companies.name))
      .limit(500),
  );
}

export async function listLeadOptions(session: VisibilitySession) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({ id: crmLeads.id, name: crmLeads.name })
      .from(crmLeads)
      .where(
        and(
          eq(crmLeads.tenantId, session.tenantId),
          ownerVisibility(crmLeads.ownerUserId, session),
          ne(crmLeads.status, "converted"),
        ),
      )
      .orderBy(desc(crmLeads.createdAt))
      .limit(300),
  );
}

export type TaskView = "acik" | "tamam";

export type TaskFilter = {
  view?: TaskView;
  /** "ben" (varsayılan) | "hepsi" | kullanıcı kimliği */
  assignee?: string;
};

/**
 * Görev listesi. Satışçı yalnız kendine atanmış ya da sahipsiz görevleri görür;
 * yönetici "hepsi" ya da belirli bir kişiyi seçebilir. Vade gruplaması (gecikmiş/bugün/hafta)
 * `taskBucket` ile arayüzde yapılır; burada yalnız sıralı ham liste döner.
 */
export async function listTasks(session: VisibilitySession, filter: TaskFilter = {}) {
  const parts: (SQL | undefined)[] = [
    eq(crmActivities.tenantId, session.tenantId),
    eq(crmActivities.type, "task"),
    ownerVisibility(crmActivities.assigneeUserId, session),
  ];
  const assignee = filter.assignee ?? "ben";
  if (assignee === "ben") parts.push(eq(crmActivities.assigneeUserId, session.userId));
  else if (assignee === "sahipsiz") parts.push(isNull(crmActivities.assigneeUserId));
  else if (UUID_RE.test(assignee)) parts.push(eq(crmActivities.assigneeUserId, assignee));

  const since = new Date(Date.now() - 30 * 86_400_000);
  if (filter.view === "tamam") {
    parts.push(sql`${crmActivities.doneAt} IS NOT NULL`, gte(crmActivities.doneAt, since));
  } else {
    parts.push(isNull(crmActivities.doneAt));
  }

  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: crmActivities.id,
        subject: crmActivities.subject,
        note: crmActivities.note,
        dueAt: crmActivities.dueAt,
        doneAt: crmActivities.doneAt,
        assigneeUserId: crmActivities.assigneeUserId,
        assigneeName: users.name,
        leadId: crmActivities.leadId,
        leadName: crmLeads.name,
        dealId: crmActivities.dealId,
        dealTitle: crmDeals.title,
      })
      .from(crmActivities)
      .leftJoin(users, eq(users.id, crmActivities.assigneeUserId))
      .leftJoin(crmLeads, eq(crmLeads.id, crmActivities.leadId))
      .leftJoin(crmDeals, eq(crmDeals.id, crmActivities.dealId))
      .where(and(...parts))
      .orderBy(sql`${crmActivities.dueAt} ASC NULLS LAST`, desc(crmActivities.createdAt))
      .limit(500),
  );
}

/**
 * "Bugün aranacaklar": takip tarihi bugün ya da geçmiş olan, henüz dönüşmemiş/elenmemiş adaylar.
 * Satışçı yalnız kendi ve sahipsiz adaylarını görür.
 */
export async function listFollowUpLeads(session: VisibilitySession, owner: "ben" | "hepsi" = "ben") {
  const { end } = istanbulDayRange(istanbulDayKey());
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: crmLeads.id,
        name: crmLeads.name,
        contactName: crmLeads.contactName,
        phone: crmLeads.phone,
        followUpAt: crmLeads.followUpAt,
        ownerName: users.name,
      })
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(
        and(
          eq(crmLeads.tenantId, session.tenantId),
          ownerVisibility(crmLeads.ownerUserId, session),
          owner === "ben" ? or(eq(crmLeads.ownerUserId, session.userId), isNull(crmLeads.ownerUserId)) : undefined,
          lt(crmLeads.followUpAt, end),
          inArray(crmLeads.status, ["new", "contacted", "qualified"]),
        ),
      )
      .orderBy(asc(crmLeads.followUpAt))
      .limit(200),
  );
}

/** Açık ve geciken görev sayıları (kenar çubuğu/dashboard için). */
export async function taskCounts(session: VisibilitySession) {
  const { start, end } = istanbulDayRange(istanbulDayKey());
  return withTenant(session.tenantId, async (tx) => {
    const base = and(
      eq(crmActivities.tenantId, session.tenantId),
      eq(crmActivities.type, "task"),
      isNull(crmActivities.doneAt),
      or(eq(crmActivities.assigneeUserId, session.userId), isNull(crmActivities.assigneeUserId)),
    );
    const [row] = await tx
      .select({
        overdue: sql<number>`count(*) FILTER (WHERE ${crmActivities.dueAt} < ${start})::int`,
        today: sql<number>`count(*) FILTER (WHERE ${crmActivities.dueAt} >= ${start} AND ${crmActivities.dueAt} < ${end})::int`,
      })
      .from(crmActivities)
      .where(base);
    return { overdue: row?.overdue ?? 0, today: row?.today ?? 0 };
  });
}
