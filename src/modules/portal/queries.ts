import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { companies, ticketMessages, tickets, vehicleArrivals, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { PortalSession } from "@/lib/portal/session";

/** Portalın tüm sorguları oturumun firmalarıyla sınırlıdır. */
export async function portalTickets(session: PortalSession) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: tickets.id,
        ticketNo: tickets.ticketNo,
        title: tickets.title,
        status: tickets.status,
        priority: tickets.priority,
        createdAt: tickets.createdAt,
        companyName: companies.name,
      })
      .from(tickets)
      .leftJoin(companies, eq(companies.id, tickets.companyId))
      .where(
        and(eq(tickets.tenantId, session.tenantId), inArray(tickets.companyId, session.companyIds)),
      )
      .orderBy(desc(tickets.createdAt)),
  );
}

export async function portalTicket(session: PortalSession, id: string) {
  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.tenantId, session.tenantId),
          eq(tickets.id, id),
          inArray(tickets.companyId, session.companyIds),
        ),
      ),
  );
  return rows[0] ?? null;
}

/** Müşteriye yalnız iç olmayan mesajlar gösterilir. */
export async function portalMessages(session: PortalSession, ticketId: string) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: ticketMessages.id,
        body: ticketMessages.body,
        fromCustomer: ticketMessages.fromCustomer,
        createdAt: ticketMessages.createdAt,
      })
      .from(ticketMessages)
      .where(
        and(
          eq(ticketMessages.tenantId, session.tenantId),
          eq(ticketMessages.ticketId, ticketId),
          eq(ticketMessages.isInternal, false),
        ),
      )
      .orderBy(asc(ticketMessages.createdAt)),
  );
}

/** Müşterinin kendi firmasına ait araç gelişleri. */
export async function portalArrivals(session: PortalSession, from: string) {
  return withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: vehicleArrivals.id,
        arrivalDate: vehicleArrivals.arrivalDate,
        shift: vehicleArrivals.shift,
        arrivedAt: vehicleArrivals.arrivedAt,
        plannedAt: vehicleArrivals.plannedAt,
        plate: vehicles.plate,
        companyName: companies.name,
      })
      .from(vehicleArrivals)
      .innerJoin(vehicles, eq(vehicles.id, vehicleArrivals.vehicleId))
      .leftJoin(companies, eq(companies.id, vehicleArrivals.companyId))
      .where(
        and(
          eq(vehicleArrivals.tenantId, session.tenantId),
          inArray(vehicleArrivals.companyId, session.companyIds),
          gte(vehicleArrivals.arrivalDate, from),
        ),
      )
      .orderBy(desc(vehicleArrivals.arrivalDate), asc(vehicleArrivals.arrivedAt)),
  );
}
