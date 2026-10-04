import { randomUUID } from "node:crypto";
import { and, asc, eq, lt, lte, sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmInboundEvents, crmIntegrations, crmWebhookDeliveries, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { getTenantAccess } from "@/lib/licensing";
import { decryptSecret, SecretBoxError } from "@/lib/secret-box";
import { safePost, SafeRequestError, validateWebhookUrl, type SafeResponse } from "@/lib/safe-url";
import { secondsNow, signPayload } from "@/lib/webhook-signing";
import {
  AUTO_DISABLE_AFTER_FAILURES,
  buildTestPayload,
  deliveryHeaders,
  HEADER_PREFIX,
  LEASE_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
  RETENTION_DAYS,
  truncateError,
} from "./webhooks";

/**
 * Giden teslim motoru (worker tarafı). Kiracılar-üstü olduğu için kuyruk talebi (`claim`) dbAdmin ile
 * yapılır (lisans süre kontrolü ve günlük özetle aynı operatör istisnası); talep edilen teslimin geri
 * kalan her okuma/yazması `withTenant` içindedir.
 *
 * Çift işleme: `claimDelivery` tek atomik UPDATE'tir (`status=pending AND next_attempt_at <= now`) ve
 * teslimi `LEASE_MS` kadar "kiralar". Süpürücü ile BullMQ gecikmeli işi aynı anda tetiklese de yalnız biri
 * kazanır. İşçi çökerse kira dolunca teslim yeniden alınır.
 */

export type SendFn = (url: string, body: string, headers: Record<string, string>) => Promise<SafeResponse>;

export type DeliveryDeps = {
  now?: Date;
  send?: SendFn;
  /** Uç otomatik kapanınca kiracı yöneticilerine haber verir. Varsayılan: e-posta kuyruğu. */
  notifyAdmins?: (tenantId: string, subject: string, body: string) => Promise<void>;
  retryScale?: number;
};

export type AttemptResult =
  | { outcome: "skipped" }
  | { outcome: "blocked"; reason: "plan_not_allowed" | "ssrf" }
  | { outcome: "succeeded"; status: number }
  | { outcome: "retry"; retryInMs: number; status: number | null }
  | { outcome: "failed"; status: number | null; disabled: boolean };

export async function findDueDeliveryIds(limit = 100, now: Date = new Date()): Promise<string[]> {
  const rows = await dbAdmin
    .select({ id: crmWebhookDeliveries.id })
    .from(crmWebhookDeliveries)
    .innerJoin(crmIntegrations, eq(crmIntegrations.id, crmWebhookDeliveries.integrationId))
    .where(
      and(
        eq(crmWebhookDeliveries.status, "pending"),
        lte(crmWebhookDeliveries.nextAttemptAt, now),
        eq(crmIntegrations.enabled, true),
      ),
    )
    .orderBy(asc(crmWebhookDeliveries.nextAttemptAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Atomik kira: kazanan `tenantId`'yi alır, kaybeden `null` (başkası işliyor ya da vakti gelmedi). */
export async function claimDelivery(id: string, now: Date, leaseMs: number = LEASE_MS): Promise<{ tenantId: string } | null> {
  const rows = await dbAdmin
    .update(crmWebhookDeliveries)
    .set({ nextAttemptAt: new Date(now.getTime() + leaseMs), updatedAt: now })
    .where(
      and(
        eq(crmWebhookDeliveries.id, id),
        eq(crmWebhookDeliveries.status, "pending"),
        lte(crmWebhookDeliveries.nextAttemptAt, now),
      ),
    )
    .returning({ tenantId: crmWebhookDeliveries.tenantId });
  return rows[0] ?? null;
}

async function defaultNotify(tenantId: string, subject: string, body: string): Promise<void> {
  const { enqueueEmail } = await import("@/lib/queue"); // tembel: kuyruk bağlantısı yalnız gerektiğinde açılır
  const admins = await dbAdmin
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true), sql`${users.role} IN ('owner', 'admin')`));
  for (const admin of admins) await enqueueEmail({ to: admin.email, subject, body });
}

const errorText = (error: unknown): string => {
  if (error instanceof SafeRequestError) {
    return {
      blocked_ip: "Alıcının alan adı iç ağa çözülüyor, bağlantı engellendi.",
      blocked_url: "Alıcı adresi güvenlik kurallarına uymuyor.",
      dns: "Alıcının alan adı çözülemedi.",
      timeout: "Alıcı 8 saniye içinde yanıt vermedi.",
      network: error.message,
      too_large: "Yanıt çok büyük.",
    }[error.code];
  }
  return error instanceof Error ? error.message : "Bilinmeyen hata";
};

async function disableIntegration(
  tenantId: string,
  integrationId: string,
  reason: "plan_not_allowed" | "ssrf" | "failures",
  now: Date,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(crmIntegrations)
      .set({ enabled: false, disabledReason: reason, updatedAt: now })
      .where(and(eq(crmIntegrations.tenantId, tenantId), eq(crmIntegrations.id, integrationId))),
  );
  await writeAuditLog({
    tenantId,
    userId: null,
    event: "integration.disabled",
    entityType: "crm_integration",
    entityId: integrationId,
    metadata: { reason },
  });
}

/**
 * Tek deneme. Başlıklar ve imza HER denemede yeniden üretilir (zaman damgası güncel), teslim kimliği
 * (`X-AtriCRM-Delivery`) aynı kalır. Yalnız 2xx başarıdır; 3xx dahil diğer her yanıt ve ağ hatası başarısızlıktır.
 */
export async function attemptDelivery(id: string, deps: DeliveryDeps = {}): Promise<AttemptResult> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? ((url, body, headers) => safePost(url, body, headers));
  const claim = await claimDelivery(id, now);
  if (!claim) return { outcome: "skipped" };
  const tenantId = claim.tenantId;

  const loaded = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({
        delivery: crmWebhookDeliveries,
        integration: crmIntegrations,
      })
      .from(crmWebhookDeliveries)
      .innerJoin(crmIntegrations, eq(crmIntegrations.id, crmWebhookDeliveries.integrationId))
      .where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, id)));
    return row ?? null;
  });
  const url = loaded?.integration.url;
  if (!loaded || loaded.delivery.status !== "pending" || !loaded.integration.enabled || !url) {
    return { outcome: "skipped" };
  }
  const { delivery, integration } = loaded;

  // Plan düştüyse ya da yetenek kapandıysa uç kapanır, teslim bekler (yeniden açılınca devam eder)
  const access = await getTenantAccess(tenantId);
  if (access.modules.get("satis")?.allowed !== true || !access.capabilities.has("satis.entegrasyon")) {
    await disableIntegration(tenantId, integration.id, "plan_not_allowed", now);
    return { outcome: "blocked", reason: "plan_not_allowed" };
  }
  // Kayıttan sonra bozulmuş/değiştirilmiş adres
  const urlCheck = validateWebhookUrl(url);
  if (!urlCheck.ok) {
    await disableIntegration(tenantId, integration.id, "ssrf", now);
    return { outcome: "blocked", reason: "ssrf" };
  }

  let status: number | null = null;
  let failure: string | null = null;
  try {
    const secret = decryptSecret(integration.secretEnc, integration.id);
    const body = JSON.stringify(delivery.payload);
    const timestamp = secondsNow(now);
    const headers = {
      ...deliveryHeaders(delivery.event, delivery.id),
      [`${HEADER_PREFIX}-Timestamp`]: timestamp,
      [`${HEADER_PREFIX}-Signature`]: signPayload(secret, timestamp, body),
    };
    const response = await send(url, body, headers);
    status = response.status;
    if (response.status < 200 || response.status >= 300) {
      failure = truncateError(`HTTP ${response.status}${response.body ? `: ${response.body}` : ""}`);
    }
  } catch (error: unknown) {
    failure = truncateError(error instanceof SecretBoxError ? error.message : errorText(error));
  }

  const attempts = delivery.attempts + 1;

  if (failure === null) {
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(crmWebhookDeliveries)
        .set({ status: "succeeded", attempts, responseStatus: status, lastError: null, nextAttemptAt: null, deliveredAt: now, updatedAt: now })
        .where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, id)));
      await tx
        .update(crmIntegrations)
        .set({ consecutiveFailures: 0, lastUsedAt: now, updatedAt: now })
        .where(and(eq(crmIntegrations.tenantId, tenantId), eq(crmIntegrations.id, integration.id)));
    });
    return { outcome: "succeeded", status: status ?? 200 };
  }

  const delay = retryDelayMs(attempts, deps.retryScale);
  if (delay !== null) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(crmWebhookDeliveries)
        .set({ attempts, responseStatus: status, lastError: failure, nextAttemptAt: new Date(now.getTime() + delay), updatedAt: now })
        .where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, id))),
    );
    return { outcome: "retry", retryInMs: delay, status };
  }

  // Deneme hakkı bitti: teslim failed, art arda başarısızlık sayacı artar
  const consecutive = await withTenant(tenantId, async (tx) => {
    await tx
      .update(crmWebhookDeliveries)
      .set({ status: "failed", attempts, responseStatus: status, lastError: failure, nextAttemptAt: null, updatedAt: now })
      .where(and(eq(crmWebhookDeliveries.tenantId, tenantId), eq(crmWebhookDeliveries.id, id)));
    const [updated] = await tx
      .update(crmIntegrations)
      .set({ consecutiveFailures: sql`${crmIntegrations.consecutiveFailures} + 1`, updatedAt: now })
      .where(and(eq(crmIntegrations.tenantId, tenantId), eq(crmIntegrations.id, integration.id)))
      .returning({ n: crmIntegrations.consecutiveFailures });
    return updated?.n ?? 0;
  });

  let disabled = false;
  if (consecutive >= AUTO_DISABLE_AFTER_FAILURES) {
    await disableIntegration(tenantId, integration.id, "failures", now);
    disabled = true;
    await (deps.notifyAdmins ?? defaultNotify)(
      tenantId,
      `Webhook bağlantınız kapatıldı: ${integration.name}`,
      `"${integration.name}" bağlantısına art arda ${AUTO_DISABLE_AFTER_FAILURES} teslim ulaştırılamadı, bu yüzden bağlantı kapatıldı. ` +
        `Alıcı adresini ve sunucunuzu kontrol edip Satış CRM > Entegrasyonlar sayfasından yeniden açın.`,
    );
  }
  return { outcome: "failed", status, disabled };
}

/** "Test gönder": örnek yük, normal teslim hattından geçer (imza, günlük, durum dahil). */
export async function enqueueTestDelivery(tenantId: string, integrationId: string, now: Date = new Date()): Promise<string> {
  const id = randomUUID();
  await withTenant(tenantId, (tx) =>
    tx.insert(crmWebhookDeliveries).values({
      id,
      tenantId,
      integrationId,
      event: "lead.created",
      payload: buildTestPayload(now, randomUUID()),
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      leadId: null,
    }),
  );
  return id;
}

/** Başarısız teslimi elle yeniden gönderir: deneme sayacı sıfırlanır, aynı teslim kimliği korunur. */
export async function requeueDelivery(tenantId: string, deliveryId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .update(crmWebhookDeliveries)
      .set({ status: "pending", attempts: 0, lastError: null, nextAttemptAt: now, updatedAt: now })
      .where(
        and(
          eq(crmWebhookDeliveries.tenantId, tenantId),
          eq(crmWebhookDeliveries.id, deliveryId),
          eq(crmWebhookDeliveries.status, "failed"),
        ),
      )
      .returning({ id: crmWebhookDeliveries.id }),
  );
  return rows.length > 0;
}

/** 30 günden eski giden teslimleri (yükte kişisel veri) ve gelen olay günlüğünü siler. */
export async function purgeOldWebhookData(now: Date = new Date()): Promise<{ deliveries: number; inbound: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const deliveries = await dbAdmin
    .delete(crmWebhookDeliveries)
    .where(lt(crmWebhookDeliveries.createdAt, cutoff))
    .returning({ id: crmWebhookDeliveries.id });
  const inbound = await dbAdmin
    .delete(crmInboundEvents)
    .where(lt(crmInboundEvents.createdAt, cutoff))
    .returning({ id: crmInboundEvents.id });
  return { deliveries: deliveries.length, inbound: inbound.length };
}

export { MAX_ATTEMPTS };
