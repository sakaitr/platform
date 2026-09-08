import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  announcements,
  blacklist,
  companies,
  contacts,
  driverEvaluations,
  driverRecords,
  drivers,
  leaveRequests,
  leaveTypes,
  portalUserCompanies,
  portalUsers,
  suggestions,
  tasks,
  ticketMessages,
  tickets,
  users,
  vehicles,
  warnings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";

/* ---------- Görevler ---------- */

export type TaskFilter = { status?: string; assignedTo?: string; priority?: string };

export async function listTasks(tenantId: string, f: TaskFilter) {
  const parts: SQL[] = [eq(tasks.tenantId, tenantId)];
  if (f.status) parts.push(eq(tasks.status, f.status as "yapilacak"));
  if (f.assignedTo) parts.push(eq(tasks.assignedTo, f.assignedTo));
  if (f.priority) parts.push(eq(tasks.priority, f.priority as "normal"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        description: tasks.description,
        assigneeName: users.name,
        companyName: companies.name,
      })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assignedTo))
      .leftJoin(companies, eq(companies.id, tasks.companyId))
      .where(and(...parts))
      .orderBy(asc(tasks.dueDate), desc(tasks.createdAt)),
  );
}

export async function getTask(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id))),
  );
  return rows[0] ?? null;
}

/* ---------- Destek talepleri ---------- */

export type TicketFilter = { status?: string; priority?: string; source?: string; scope: string[] | null };

export async function listTickets(tenantId: string, f: TicketFilter) {
  const parts: SQL[] = [eq(tickets.tenantId, tenantId)];
  if (f.scope !== null) {
    parts.push(
      f.scope.length > 0
        ? or(inArray(tickets.companyId, f.scope), isNull(tickets.companyId))!
        : isNull(tickets.companyId),
    );
  }
  if (f.status) parts.push(eq(tickets.status, f.status as "acik"));
  if (f.priority) parts.push(eq(tickets.priority, f.priority as "normal"));
  if (f.source) parts.push(eq(tickets.source, f.source as "ic"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: tickets.id,
        ticketNo: tickets.ticketNo,
        title: tickets.title,
        status: tickets.status,
        priority: tickets.priority,
        source: tickets.source,
        slaDueAt: tickets.slaDueAt,
        createdAt: tickets.createdAt,
        companyName: companies.name,
        plate: vehicles.plate,
        assigneeName: users.name,
      })
      .from(tickets)
      .leftJoin(companies, eq(companies.id, tickets.companyId))
      .leftJoin(vehicles, eq(vehicles.id, tickets.vehicleId))
      .leftJoin(users, eq(users.id, tickets.assignedTo))
      .where(and(...parts))
      .orderBy(desc(tickets.createdAt)),
  );
}

export async function getTicket(tenantId: string, id: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(tickets).where(and(eq(tickets.tenantId, tenantId), eq(tickets.id, id))),
  );
  return rows[0] ?? null;
}

/** Talep mesajları. `includeInternal` false ise portal görünümü — iç notlar gizlenir. */
export async function listTicketMessages(tenantId: string, ticketId: string, includeInternal: boolean) {
  const parts: SQL[] = [eq(ticketMessages.tenantId, tenantId), eq(ticketMessages.ticketId, ticketId)];
  if (!includeInternal) parts.push(eq(ticketMessages.isInternal, false));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: ticketMessages.id,
        body: ticketMessages.body,
        fromCustomer: ticketMessages.fromCustomer,
        isInternal: ticketMessages.isInternal,
        createdAt: ticketMessages.createdAt,
        userName: users.name,
      })
      .from(ticketMessages)
      .leftJoin(users, eq(users.id, ticketMessages.userId))
      .where(and(...parts))
      .orderBy(asc(ticketMessages.createdAt)),
  );
}

export async function ticketSummary(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ status: tickets.status, adet: count() })
      .from(tickets)
      .where(eq(tickets.tenantId, tenantId))
      .groupBy(tickets.status),
  );
  const summary: Record<string, number> = { acik: 0, islemde: 0, bekliyor: 0, cozuldu: 0, kapandi: 0 };
  for (const row of rows) summary[row.status] = row.adet;
  return summary;
}

/* ---------- Öneri / uyarı ---------- */

export async function listSuggestions(tenantId: string, open?: boolean) {
  const parts: SQL[] = [eq(suggestions.tenantId, tenantId)];
  if (open !== undefined) parts.push(eq(suggestions.isOpen, open));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: suggestions.id,
        documentNo: suggestions.documentNo,
        title: suggestions.title,
        kind: suggestions.kind,
        isOpen: suggestions.isOpen,
        description: suggestions.description,
        createdAt: suggestions.createdAt,
        assigneeName: users.name,
      })
      .from(suggestions)
      .leftJoin(users, eq(users.id, suggestions.assignedTo))
      .where(and(...parts))
      .orderBy(desc(suggestions.createdAt)),
  );
}

export async function listWarnings(tenantId: string, done?: boolean) {
  const parts: SQL[] = [eq(warnings.tenantId, tenantId)];
  if (done !== undefined) parts.push(eq(warnings.isDone, done));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: warnings.id,
        documentNo: warnings.documentNo,
        reason: warnings.reason,
        deadline: warnings.deadline,
        isDone: warnings.isDone,
        plate: vehicles.plate,
        driverName: drivers.fullName,
      })
      .from(warnings)
      .leftJoin(vehicles, eq(vehicles.id, warnings.vehicleId))
      .leftJoin(drivers, eq(drivers.id, warnings.driverId))
      .where(and(...parts))
      .orderBy(asc(warnings.deadline), desc(warnings.createdAt)),
  );
}

/* ---------- İK ---------- */

export async function listLeaveTypes(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.select().from(leaveTypes).where(eq(leaveTypes.tenantId, tenantId)).orderBy(asc(leaveTypes.name)),
  );
}

export async function listLeaveRequests(tenantId: string, f: { userId?: string; status?: string }) {
  const parts: SQL[] = [eq(leaveRequests.tenantId, tenantId)];
  if (f.userId) parts.push(eq(leaveRequests.userId, f.userId));
  if (f.status) parts.push(eq(leaveRequests.status, f.status as "bekliyor"));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: leaveRequests.id,
        userName: users.name,
        typeName: leaveTypes.name,
        startsOn: leaveRequests.startsOn,
        endsOn: leaveRequests.endsOn,
        dayCount: leaveRequests.dayCount,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        approverNote: leaveRequests.approverNote,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .leftJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...parts))
      .orderBy(desc(leaveRequests.startsOn)),
  );
}

/* ---------- Sürücü sicili ---------- */

export async function listDriverRecords(tenantId: string, driverId?: string) {
  const parts: SQL[] = [eq(driverRecords.tenantId, tenantId)];
  if (driverId) parts.push(eq(driverRecords.driverId, driverId));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: driverRecords.id,
        driverName: drivers.fullName,
        plate: vehicles.plate,
        incidentDate: driverRecords.incidentDate,
        category: driverRecords.category,
        severity: driverRecords.severity,
        description: driverRecords.description,
        actionTaken: driverRecords.actionTaken,
      })
      .from(driverRecords)
      .innerJoin(drivers, eq(drivers.id, driverRecords.driverId))
      .leftJoin(vehicles, eq(vehicles.id, driverRecords.vehicleId))
      .where(and(...parts))
      .orderBy(desc(driverRecords.incidentDate)),
  );
}

/** Değerlendirme listesi; ortalama puan SQL'de hesaplanır. */
export async function listDriverEvaluations(tenantId: string, driverId?: string) {
  const parts: SQL[] = [eq(driverEvaluations.tenantId, tenantId)];
  if (driverId) parts.push(eq(driverEvaluations.driverId, driverId));
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: driverEvaluations.id,
        driverName: drivers.fullName,
        plate: vehicles.plate,
        evaluationDate: driverEvaluations.evaluationDate,
        punctuality: driverEvaluations.punctuality,
        driving: driverEvaluations.driving,
        communication: driverEvaluations.communication,
        cleanliness: driverEvaluations.cleanliness,
        routeCompliance: driverEvaluations.routeCompliance,
        appearance: driverEvaluations.appearance,
        ortalama: sql<string>`round((
          ${driverEvaluations.punctuality} + ${driverEvaluations.driving} +
          ${driverEvaluations.communication} + ${driverEvaluations.cleanliness} +
          ${driverEvaluations.routeCompliance} + ${driverEvaluations.appearance}
        )::numeric / 6, 2)`,
        notes: driverEvaluations.notes,
      })
      .from(driverEvaluations)
      .innerJoin(drivers, eq(drivers.id, driverEvaluations.driverId))
      .leftJoin(vehicles, eq(vehicles.id, driverEvaluations.vehicleId))
      .where(and(...parts))
      .orderBy(desc(driverEvaluations.evaluationDate)),
  );
}

/* ---------- Portal kullanıcıları ---------- */

export async function listPortalUsers(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: portalUsers.id,
        email: portalUsers.email,
        fullName: portalUsers.fullName,
        isActive: portalUsers.isActive,
        lastLoginAt: portalUsers.lastLoginAt,
        companyName: companies.name,
      })
      .from(portalUsers)
      .leftJoin(portalUserCompanies, eq(portalUserCompanies.portalUserId, portalUsers.id))
      .leftJoin(companies, eq(companies.id, portalUserCompanies.companyId))
      .where(eq(portalUsers.tenantId, tenantId))
      .orderBy(asc(portalUsers.fullName)),
  );

  // Bir kullanıcı birden çok firmaya bağlı olabilir; satırları tek kayıtta topluyoruz.
  const merged = new Map<string, { id: string; email: string; fullName: string; isActive: boolean; lastLoginAt: Date | null; companies: string[] }>();
  for (const row of rows) {
    const existing = merged.get(row.id);
    if (existing) {
      if (row.companyName) existing.companies.push(row.companyName);
    } else {
      merged.set(row.id, {
        id: row.id,
        email: row.email,
        fullName: row.fullName,
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt,
        companies: row.companyName ? [row.companyName] : [],
      });
    }
  }
  return [...merged.values()];
}

export async function portalUserCompanyIds(tenantId: string, portalUserId: string): Promise<string[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ companyId: portalUserCompanies.companyId })
      .from(portalUserCompanies)
      .where(
        and(
          eq(portalUserCompanies.tenantId, tenantId),
          eq(portalUserCompanies.portalUserId, portalUserId),
        ),
      ),
  );
  return rows.map((r) => r.companyId);
}

/* ---------- Rehber, kara liste, duyuru ---------- */

export async function listContacts(tenantId: string, q?: string) {
  const parts: SQL[] = [eq(contacts.tenantId, tenantId)];
  if (q) {
    const like = `%${q}%`;
    parts.push(or(ilike(contacts.name, like), ilike(contacts.phone, like), ilike(contacts.category, like))!);
  }
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: contacts.id,
        name: contacts.name,
        category: contacts.category,
        title: contacts.title,
        phone: contacts.phone,
        email: contacts.email,
        notes: contacts.notes,
        companyName: companies.name,
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(and(...parts))
      .orderBy(asc(contacts.category), asc(contacts.name)),
  );
}

export async function listBlacklist(tenantId: string, active?: boolean) {
  const parts: SQL[] = [eq(blacklist.tenantId, tenantId)];
  if (active !== undefined) parts.push(eq(blacklist.isActive, active));
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(blacklist)
      .where(and(...parts))
      .orderBy(desc(blacklist.addedOn)),
  );
}

/** Kara liste kontrolü — yolcu/sürücü eklerken uyarı için. */
export async function isBlacklisted(
  tenantId: string,
  input: { idNumber?: string | null; plate?: string | null },
): Promise<boolean> {
  const checks: SQL[] = [];
  if (input.idNumber) checks.push(eq(blacklist.idNumber, input.idNumber));
  if (input.plate) checks.push(eq(blacklist.plate, input.plate));
  if (checks.length === 0) return false;

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: blacklist.id })
      .from(blacklist)
      .where(and(eq(blacklist.tenantId, tenantId), eq(blacklist.isActive, true), or(...checks)!))
      .limit(1),
  );
  return rows.length > 0;
}

export async function listAnnouncements(tenantId: string, onlyActive = false) {
  const parts: SQL[] = [eq(announcements.tenantId, tenantId)];
  if (onlyActive) parts.push(eq(announcements.isActive, true));
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(announcements)
      .where(and(...parts))
      .orderBy(desc(announcements.createdAt)),
  );
}
