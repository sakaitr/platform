import { and, asc, count, desc, eq, gte, ilike, lte, type SQL } from "drizzle-orm";
import {
  auditLogs,
  entityFields,
  roles,
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
  terminologyOverrides,
  users,
} from "@/db/schema";
import { dbAdmin } from "@/db/admin";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { withTenant } from "@/db/tenant";

export async function listUsers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name)),
  );
}

export async function listOverrides(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId))
      .orderBy(asc(terminologyOverrides.termKey)),
  );
}

export async function listAllFields(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(entityFields)
      .where(eq(entityFields.tenantId, tenantId))
      .orderBy(asc(entityFields.entityKey), asc(entityFields.position)),
  );
}

export async function listUsersWithRoles(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isActive: users.isActive,
        roleId: users.roleId,
        roleLabel: roles.label,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name)),
  );
}

/** Kiracının modül lisansları — kurulu olmayanlar da listelenir. */
export async function listTenantModules(tenantId: string) {
  const rows = await dbAdmin
    .select()
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, tenantId));
  const byKey = new Map(rows.map((r) => [r.moduleKey, r]));

  return MODULE_REGISTRY.filter((m) => m.key !== "dashboard").map((module) => ({
    key: module.key,
    label: module.label,
    row: byKey.get(module.key) ?? null,
  }));
}

export async function listTenantCapabilities(tenantId: string) {
  const rows = await dbAdmin
    .select()
    .from(tenantCapabilities)
    .where(eq(tenantCapabilities.tenantId, tenantId));
  const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.capabilityKey));

  const all = MODULE_REGISTRY.flatMap((m) =>
    (m.capabilities ?? []).map((key) => ({ moduleKey: m.key, moduleLabel: m.label, key })),
  );
  return all.map((c) => ({ ...c, enabled: enabled.has(c.key) }));
}

export async function getSubscription(tenantId: string) {
  const rows = await dbAdmin
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export type AuditFilter = { event?: string; userId?: string; from?: string; to?: string; page?: number };

export const AUDIT_PAGE_SIZE = 100;

/** Denetim izi — kim, ne zaman, neyi değiştirdi. */
export async function listAuditLogs(tenantId: string, f: AuditFilter) {
  const parts: SQL[] = [eq(auditLogs.tenantId, tenantId)];
  if (f.event) parts.push(ilike(auditLogs.event, `%${f.event}%`));
  if (f.userId) parts.push(eq(auditLogs.userId, f.userId));
  if (f.from) parts.push(gte(auditLogs.createdAt, new Date(`${f.from}T00:00:00+03:00`)));
  if (f.to) parts.push(lte(auditLogs.createdAt, new Date(`${f.to}T23:59:59+03:00`)));
  const where = and(...parts)!;
  const page = Math.max(1, f.page ?? 1);

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: auditLogs.id,
        event: auditLogs.event,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        createdAt: auditLogs.createdAt,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE);

    const [total] = await tx.select({ value: count() }).from(auditLogs).where(where);
    const n = total?.value ?? 0;
    return { rows, total: n, page, pageCount: Math.max(1, Math.ceil(n / AUDIT_PAGE_SIZE)) };
  });
}

/** Kiracı özeti — operatör panelinde satır başına gösterilir. */
export async function listAllTenants() {
  const rows = await dbAdmin
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      sectorPack: tenants.sectorPack,
      sectorPackVersion: tenants.sectorPackVersion,
      isActive: tenants.isActive,
      createdAt: tenants.createdAt,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .orderBy(asc(tenants.name));

  const counts = await dbAdmin
    .select({ tenantId: users.tenantId, value: count() })
    .from(users)
    .groupBy(users.tenantId);
  const byTenant = new Map(counts.map((c) => [c.tenantId, c.value]));

  return rows.map((r) => ({ ...r, userCount: byTenant.get(r.id) ?? 0 }));
}
