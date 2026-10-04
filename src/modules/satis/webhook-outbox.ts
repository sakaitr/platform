import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { companies, crmDeals, crmIntegrations, crmLeads, crmStages, crmWebhookDeliveries, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  buildDealPayload,
  buildLeadDeletedPayload,
  buildLeadPayload,
  PAYLOAD_VERSION,
  type OutboundEvent,
  type PersonRef,
} from "./webhooks";

/**
 * Olay kutusu (outbox). Olay, değişikliği yapan transaction'ın İÇİNDE teslim kaydı olarak yazılır:
 * değişiklik geri alınırsa olay da gitmez, kaydedilirse olay kaybolmaz. Gönderim asenkrondur
 * (worker); istek webhook yüzünden yavaşlamaz. Yük olay anında üretilip kayda yazılır, tekrar
 * denemede aday yeniden okunmaz (aday silinmiş olabilir).
 *
 * Uç yoksa ya da kapalıysa hiçbir şey yazılmaz.
 */

type Endpoint = { id: string; events: string[] };

async function subscribers(tx: TenantTx, tenantId: string, event: OutboundEvent): Promise<Endpoint[]> {
  const rows = await tx
    .select({ id: crmIntegrations.id, events: crmIntegrations.events, url: crmIntegrations.url })
    .from(crmIntegrations)
    .where(
      and(
        eq(crmIntegrations.tenantId, tenantId),
        eq(crmIntegrations.kind, "webhook_outbound"),
        eq(crmIntegrations.enabled, true),
      ),
    );
  return rows
    .filter((r) => r.url && Array.isArray(r.events) && (r.events as string[]).includes(event))
    .map((r) => ({ id: r.id, events: r.events as string[] }));
}

export async function emitWebhookEvent(
  tx: TenantTx,
  tenantId: string,
  event: OutboundEvent,
  payload: object,
  options: { leadId?: string | null; now?: Date } = {},
): Promise<number> {
  const endpoints = await subscribers(tx, tenantId, event);
  if (endpoints.length === 0) return 0;
  const now = options.now ?? new Date();
  await tx.insert(crmWebhookDeliveries).values(
    endpoints.map((endpoint) => ({
      tenantId,
      integrationId: endpoint.id,
      event,
      payload,
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: now,
      leadId: options.leadId ?? null,
    })),
  );
  return endpoints.length;
}

async function hasSubscribers(tx: TenantTx, tenantId: string, ...events: OutboundEvent[]): Promise<boolean> {
  for (const event of events) if ((await subscribers(tx, tenantId, event)).length > 0) return true;
  return false;
}

async function ownerRef(tx: TenantTx, tenantId: string, userId: string | null): Promise<PersonRef> {
  if (!userId) return null;
  const [user] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return user ?? null;
}

async function leadSnapshot(tx: TenantTx, tenantId: string, leadId: string) {
  const [lead] = await tx
    .select({
      id: crmLeads.id,
      name: crmLeads.name,
      contactName: crmLeads.contactName,
      phone: crmLeads.phone,
      email: crmLeads.email,
      website: crmLeads.website,
      city: crmLeads.city,
      sector: crmLeads.sector,
      message: crmLeads.message,
      service: crmLeads.service,
      source: crmLeads.source,
      status: crmLeads.status,
      temperature: crmLeads.temperature,
      score: crmLeads.score,
      eventName: crmLeads.eventName,
      estimatedValue: crmLeads.estimatedValue,
      followUpAt: crmLeads.followUpAt,
      createdAt: crmLeads.createdAt,
      ownerUserId: crmLeads.ownerUserId,
    })
    .from(crmLeads)
    .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, leadId)));
  return lead ?? null;
}

/** `lead.created` / `lead.updated`. Aday satırı o anki haliyle okunur ve yüke yazılır. */
export async function emitLeadEvent(
  tx: TenantTx,
  tenantId: string,
  event: "lead.created" | "lead.updated",
  leadId: string,
): Promise<void> {
  if (!(await hasSubscribers(tx, tenantId, event))) return;
  const lead = await leadSnapshot(tx, tenantId, leadId);
  if (!lead) return;
  const owner = await ownerRef(tx, tenantId, lead.ownerUserId);
  const now = new Date();
  await emitWebhookEvent(tx, tenantId, event, buildLeadPayload(event, lead, owner, now), { leadId, now });
}

/**
 * KVKK sırası: aday silinince (1) o adayın henüz teslim edilmemiş (bekleyen) `lead.created` /
 * `lead.updated` teslimleri İPTAL edilir, (2) tüm eski teslimlerin yükündeki kişisel veri silinir,
 * (3) `lead.deleted` yine gönderilir. Alıcı geç gelen bir `created`'a karşı mezar taşı tutmalıdır.
 */
export async function retireLeadDeliveries(tx: TenantTx, tenantId: string, leadIds: readonly string[]): Promise<void> {
  if (leadIds.length === 0) return;
  const ids = [...leadIds];
  const scope = and(
    eq(crmWebhookDeliveries.tenantId, tenantId),
    inArray(crmWebhookDeliveries.leadId, ids),
    ne(crmWebhookDeliveries.event, "lead.deleted"),
  );
  await tx
    .update(crmWebhookDeliveries)
    .set({ status: "cancelled", nextAttemptAt: null, lastError: "Aday silindi, teslim iptal edildi.", updatedAt: new Date() })
    .where(and(scope, eq(crmWebhookDeliveries.status, "pending")));
  await tx
    .update(crmWebhookDeliveries)
    .set({
      payload: sql`jsonb_build_object('event', ${crmWebhookDeliveries.event}, 'version', ${PAYLOAD_VERSION}::int, 'id', ${crmWebhookDeliveries.leadId}::text, 'redacted', true)`,
      updatedAt: new Date(),
    })
    .where(scope);
}

export async function emitLeadDeleted(
  tx: TenantTx,
  tenantId: string,
  leadId: string,
  reason: "erasure_request" | "owner_deleted" | "account_removed",
): Promise<void> {
  // Bekleyenleri iptal etmek abonelik olmasa da gerekir (uç sonradan açılmış olabilir)
  await retireLeadDeliveries(tx, tenantId, [leadId]);
  const now = new Date();
  await emitWebhookEvent(tx, tenantId, "lead.deleted", buildLeadDeletedPayload(leadId, reason, now), { leadId, now });
}

/** Fırsat aşama değişimi: `deal.stage_changed` her zaman, `won`/`lost` aşamasında ek olarak `deal.won` / `deal.lost`. */
export async function emitDealMoved(
  tx: TenantTx,
  tenantId: string,
  dealId: string,
  from: { label: string; kind: "open" | "won" | "lost" },
  to: { label: string; kind: "open" | "won" | "lost" },
): Promise<void> {
  const events: ("deal.stage_changed" | "deal.won" | "deal.lost")[] = ["deal.stage_changed"];
  if (to.kind === "won") events.push("deal.won");
  if (to.kind === "lost") events.push("deal.lost");
  if (!(await hasSubscribers(tx, tenantId, ...events))) return;

  const [deal] = await tx
    .select({
      id: crmDeals.id,
      title: crmDeals.title,
      value: crmDeals.value,
      currency: crmDeals.currency,
      leadId: crmDeals.leadId,
      ownerUserId: crmDeals.ownerUserId,
      expectedCloseAt: crmDeals.expectedCloseAt,
      closedAt: crmDeals.closedAt,
      lostReason: crmDeals.lostReason,
      companyName: companies.name,
      stageLabel: crmStages.label,
    })
    .from(crmDeals)
    .innerJoin(crmStages, eq(crmStages.id, crmDeals.stageId))
    .leftJoin(companies, eq(companies.id, crmDeals.companyId))
    .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId)));
  if (!deal) return;
  const owner = await ownerRef(tx, tenantId, deal.ownerUserId);
  const now = new Date();
  for (const event of events) {
    await emitWebhookEvent(tx, tenantId, event, buildDealPayload(event, deal, to, from, owner, now), {
      leadId: deal.leadId,
      now,
    });
  }
}
