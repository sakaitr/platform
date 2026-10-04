import { and, eq, inArray, sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmInboundEvents, crmIntegrations, crmLeads, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getTenantAccess } from "@/lib/licensing";
import { checkLimit } from "@/lib/limits";
import { decryptSecret, SecretBoxError } from "@/lib/secret-box";
import { verifySignature } from "@/lib/webhook-signing";
import { AtricardLeadCreated, AtricardLeadDeleted, TEMPERATURE_MAP } from "./inbound-schema";
import { createLeadIfNew, eraseExternalLead } from "./leads";

/**
 * Gelen Atricard webhook'u (Atricard → AtriCRM). Sözleşme: Atricard ile aynı, tek doğruluk kaynağı bölüm 10.
 *
 * Bu yol oturumsuzdur: kiracıyı bulmak için `crm_integrations` satırı okunmak ZORUNDA. Bu, belgelenmiş
 * TEK dar `dbAdmin` istisnasıdır (oturum tablosundaki desen gibi): yalnız id'ye göre tek satır, yalnız
 * kiracı kimliğini ve şifreli anahtarı almak için. Satır bulunduktan sonra her şey `withTenant(row.tenantId)`
 * içinde yürür; kiracı kimliği asla istemciden alınmaz.
 */

export const MAX_BODY_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboundInput = {
  integrationId: string;
  rawBody: string;
  event: string | null;
  deliveryId: string | null;
  timestamp: string | null;
  signature: string | null;
  now?: Date;
};

export type InboundResult = { httpStatus: number; body: Record<string, unknown> };

const respond = (httpStatus: number, body: Record<string, unknown>): InboundResult => ({ httpStatus, body });

function cleanDeliveryId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 100 ? trimmed : null;
}

type LogEntry = {
  tenantId: string;
  integrationId: string;
  deliveryId: string | null;
  event: string;
  externalId?: string | null;
  status: "processed" | "duplicate" | "ignored" | "rejected";
  error?: string | null;
};

/** Reddedilen (imzasız/bozuk) istekler de günlüğe düşer ki yönetici bağlantı sorununu görebilsin. */
async function logEvent(entry: LogEntry): Promise<void> {
  await withTenant(entry.tenantId, (tx) =>
    tx.insert(crmInboundEvents).values({
      tenantId: entry.tenantId,
      integrationId: entry.integrationId,
      deliveryId: entry.deliveryId,
      event: entry.event.slice(0, 60) || "unknown",
      externalId: entry.externalId?.slice(0, 100) ?? null,
      status: entry.status,
      error: entry.error?.slice(0, 500) ?? null,
    }),
  );
}

export async function handleAtricardWebhook(input: InboundInput): Promise<InboundResult> {
  if (!UUID_RE.test(input.integrationId)) return respond(404, { error: "not_found" });

  const [integration] = await dbAdmin
    .select({
      id: crmIntegrations.id,
      tenantId: crmIntegrations.tenantId,
      secretEnc: crmIntegrations.secretEnc,
      enabled: crmIntegrations.enabled,
    })
    .from(crmIntegrations)
    .where(and(eq(crmIntegrations.id, input.integrationId), eq(crmIntegrations.kind, "atricard_inbound")));
  if (!integration || !integration.enabled) return respond(404, { error: "not_found" });
  const { tenantId } = integration;

  // Lisans ve alt yetenek: kapalıysa uç yokmuş gibi davranır
  const access = await getTenantAccess(tenantId);
  if (access.modules.get("satis")?.allowed !== true || !access.capabilities.has("satis.entegrasyon")) {
    return respond(404, { error: "not_found" });
  }

  const deliveryId = cleanDeliveryId(input.deliveryId);
  const eventName = input.event?.trim() ?? "";
  const reject = async (httpStatus: number, error: string): Promise<InboundResult> => {
    await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: eventName || "unknown", status: "rejected", error });
    return respond(httpStatus, { error });
  };

  if (Buffer.byteLength(input.rawBody, "utf8") > MAX_BODY_BYTES) return reject(413, "payload_too_large");

  let secret: string;
  try {
    secret = decryptSecret(integration.secretEnc, integration.id);
  } catch (error: unknown) {
    // Sunucu yapılandırma sorunu (ana anahtar değişmiş): 401 değil 503, gönderici yanlış anahtar sanmasın
    await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: eventName || "unknown", status: "rejected", error: error instanceof SecretBoxError ? "secret_unreadable" : "secret_error" });
    return respond(503, { error: "secret_unreadable" });
  }

  const check = verifySignature({
    secret,
    timestamp: input.timestamp,
    signature: input.signature,
    rawBody: input.rawBody,
    now: input.now,
  });
  if (!check.ok) return reject(401, check.reason === "signature" ? "invalid_signature" : check.reason === "timestamp" ? "invalid_timestamp" : "missing_signature");

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return reject(400, "invalid_json");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return reject(400, "invalid_payload");
  const bodyEvent = (json as { event?: unknown }).event;
  if (typeof bodyEvent !== "string") return reject(400, "invalid_payload");
  if (eventName && eventName !== bodyEvent) return reject(400, "event_mismatch");

  // Aynı teslimin tekrarı (Atricard her denemede aynı teslim kimliğini taşır): yeniden işleme
  if (deliveryId) {
    const seen = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: crmInboundEvents.id, externalId: crmInboundEvents.externalId })
        .from(crmInboundEvents)
        .where(
          and(
            eq(crmInboundEvents.integrationId, integration.id),
            eq(crmInboundEvents.deliveryId, deliveryId),
            inArray(crmInboundEvents.status, ["processed", "duplicate", "ignored"]),
          ),
        )
        .limit(1),
    );
    if (seen.length > 0) {
      await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: bodyEvent, externalId: seen[0]!.externalId, status: "duplicate" });
      // Gönderici aynı yanıtı beklesin: aday hâlâ varsa kimliğini de ver
      let leadId: string | undefined;
      if (bodyEvent === "lead.created" && seen[0]!.externalId) {
        const externalId = seen[0]!.externalId;
        const [lead] = await withTenant(tenantId, (tx) =>
          tx
            .select({ id: crmLeads.id })
            .from(crmLeads)
            .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.source, "atricard"), eq(crmLeads.externalId, externalId)))
            .limit(1),
        );
        leadId = lead?.id;
      }
      return respond(200, leadId ? { status: "duplicate", leadId } : { status: "duplicate" });
    }
  }

  const touch = (): Promise<unknown> =>
    withTenant(tenantId, (tx) =>
      tx.update(crmIntegrations).set({ lastUsedAt: new Date() }).where(and(eq(crmIntegrations.tenantId, tenantId), eq(crmIntegrations.id, integration.id))),
    );

  if (bodyEvent === "lead.created") {
    const parsed = AtricardLeadCreated.safeParse(json);
    if (!parsed.success) return reject(400, `invalid_payload: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
    const payload = parsed.data;
    if (payload.version !== 1) {
      await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: bodyEvent, externalId: payload.id, status: "ignored", error: "unsupported_version" });
      return respond(200, { status: "ignored", reason: "unsupported_version" });
    }

    // Sınır doluysa yeni aday açılmaz; yönetici günlükte "lead_limit" görür. Gönderici tekrar denemesin diye 200.
    const limit = await checkLimit(tenantId, "satis", "max_leads");
    if (!limit.ok) {
      await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: bodyEvent, externalId: payload.id, status: "ignored", error: "lead_limit" });
      return respond(200, { status: "ignored", reason: "lead_limit" });
    }

    const outcome = await withTenant(tenantId, async (tx) => {
      // Kart sahibi, kiracının kullanıcılarından biriyle e-postayla eşleşirse sahip olur; yoksa sahipsiz
      let ownerUserId: string | null = null;
      const ownerEmail = payload.owner?.email?.toLowerCase();
      if (ownerEmail) {
        const [match] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), sql`lower(${users.email}) = ${ownerEmail}`))
          .limit(1);
        ownerUserId = match?.id ?? null;
      }
      const lead = payload.lead;
      const result = await createLeadIfNew(tx, tenantId, {
        name: lead.company ?? lead.name,
        contactName: lead.name,
        phone: lead.phone,
        email: lead.email,
        message: lead.message,
        service: lead.service,
        eventName: lead.event_name,
        temperature: lead.temperature ? TEMPERATURE_MAP[lead.temperature] : null,
        source: "atricard",
        externalId: payload.id,
        ownerUserId,
      });
      const status = result.status === "created" ? "processed" : result.status === "duplicate" ? "duplicate" : "ignored";
      await tx.insert(crmInboundEvents).values({
        tenantId,
        integrationId: integration.id,
        deliveryId,
        event: bodyEvent,
        externalId: payload.id,
        status,
        error: result.status === "ignored" ? "tombstone" : null,
      });
      return result;
    });
    await touch();
    if (outcome.status === "created") return respond(201, { status: "created", leadId: outcome.id });
    if (outcome.status === "duplicate") return respond(200, { status: "duplicate", leadId: outcome.id });
    return respond(200, { status: "ignored" });
  }

  if (bodyEvent === "lead.deleted") {
    const parsed = AtricardLeadDeleted.safeParse(json);
    if (!parsed.success) return reject(400, `invalid_payload: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim());
    const payload = parsed.data;
    const result = await withTenant(tenantId, async (tx) => {
      const erased = await eraseExternalLead(tx, tenantId, "atricard", payload.id, payload.reason ?? "erasure_request");
      await tx.insert(crmInboundEvents).values({
        tenantId,
        integrationId: integration.id,
        deliveryId,
        event: bodyEvent,
        externalId: payload.id,
        status: "processed",
        error: null,
      });
      return erased;
    });
    await touch();
    // Kayıt bulunmasa da 200: gönderici gereksiz tekrar denemesin
    return respond(200, { status: "processed", result });
  }

  // Bilinmeyen olay: ileride Atricard yeni olay ekleyince eski alıcı kırılmasın
  await logEvent({ tenantId, integrationId: integration.id, deliveryId, event: bodyEvent, status: "ignored", error: "unknown_event" });
  return respond(200, { status: "ignored" });
}
