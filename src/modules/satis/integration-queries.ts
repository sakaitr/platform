import { desc, eq } from "drizzle-orm";
import { crmApiKeys, crmInboundEvents, crmIntegrations, crmWebhookDeliveries } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Entegrasyon ekranı sorguları. `secret_enc` HİÇBİR sorguda seçilmez: gizli anahtar arayüze, günlüğe ya da
 * sayfa verisine hiçbir koşulda ulaşmamalı. Tenant süzgeci RLS'e ek olarak açıkça da uygulanır.
 */

const safeIntegration = {
  id: crmIntegrations.id,
  kind: crmIntegrations.kind,
  name: crmIntegrations.name,
  url: crmIntegrations.url,
  events: crmIntegrations.events,
  enabled: crmIntegrations.enabled,
  consentAt: crmIntegrations.consentAt,
  consecutiveFailures: crmIntegrations.consecutiveFailures,
  disabledReason: crmIntegrations.disabledReason,
  lastUsedAt: crmIntegrations.lastUsedAt,
  createdAt: crmIntegrations.createdAt,
};

export async function listIntegrations(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select(safeIntegration).from(crmIntegrations).where(eq(crmIntegrations.tenantId, tenantId)).orderBy(crmIntegrations.createdAt),
  );
  return rows.map((r) => ({ ...r, events: Array.isArray(r.events) ? (r.events as string[]) : [] }));
}

export async function listRecentDeliveries(tenantId: string, limit = 50) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: crmWebhookDeliveries.id,
        integrationId: crmWebhookDeliveries.integrationId,
        integrationName: crmIntegrations.name,
        event: crmWebhookDeliveries.event,
        status: crmWebhookDeliveries.status,
        attempts: crmWebhookDeliveries.attempts,
        responseStatus: crmWebhookDeliveries.responseStatus,
        lastError: crmWebhookDeliveries.lastError,
        nextAttemptAt: crmWebhookDeliveries.nextAttemptAt,
        deliveredAt: crmWebhookDeliveries.deliveredAt,
        createdAt: crmWebhookDeliveries.createdAt,
      })
      .from(crmWebhookDeliveries)
      .innerJoin(crmIntegrations, eq(crmIntegrations.id, crmWebhookDeliveries.integrationId))
      .where(eq(crmWebhookDeliveries.tenantId, tenantId))
      .orderBy(desc(crmWebhookDeliveries.createdAt))
      .limit(limit),
  );
}

export async function listRecentInboundEvents(tenantId: string, limit = 30) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: crmInboundEvents.id,
        integrationName: crmIntegrations.name,
        event: crmInboundEvents.event,
        status: crmInboundEvents.status,
        error: crmInboundEvents.error,
        createdAt: crmInboundEvents.createdAt,
      })
      .from(crmInboundEvents)
      .innerJoin(crmIntegrations, eq(crmIntegrations.id, crmInboundEvents.integrationId))
      .where(eq(crmInboundEvents.tenantId, tenantId))
      .orderBy(desc(crmInboundEvents.createdAt))
      .limit(limit),
  );
}

export async function listApiKeys(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: crmApiKeys.id,
        name: crmApiKeys.name,
        prefix: crmApiKeys.prefix,
        scopes: crmApiKeys.scopes,
        lastUsedAt: crmApiKeys.lastUsedAt,
        revokedAt: crmApiKeys.revokedAt,
        createdAt: crmApiKeys.createdAt,
      })
      .from(crmApiKeys)
      .where(eq(crmApiKeys.tenantId, tenantId))
      .orderBy(desc(crmApiKeys.createdAt)),
  );
}

/** Kısıtlı alan adı gösterimi: alt yol ve sorgu dizesi (token barındırabilir) listede görünmez. */
export function displayUrl(raw: string | null): string {
  if (!raw) return "—";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}…` : url.pathname}`;
  } catch {
    return "—";
  }
}
