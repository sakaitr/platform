"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { crmApiKeys, crmIntegrations } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { writeAuditLog } from "@/lib/audit";
import { generateApiKey } from "@/lib/api-keys";
import { requireModule } from "@/lib/auth";
import { encryptSecret, generateWebhookSecret, SecretBoxError } from "@/lib/secret-box";
import { validateWebhookUrl } from "@/lib/safe-url";
import { requireCapability } from "./guards";
import { enqueueTestDelivery, requeueDelivery } from "./webhook-delivery";
import { isOutboundEvent } from "./webhooks";

export type RevealState =
  | { error: string }
  | { ok: string; secret?: string; url?: string }
  | null;

const MAX_INBOUND = 3;
const MAX_OUTBOUND = 5;
const MAX_API_KEYS = 10;

async function guard() {
  const session = await requireModule("satis_entegrasyon:update", "satis");
  await requireCapability(session, "satis.entegrasyon");
  return session;
}

function refresh(): void {
  revalidatePath("/satis/entegrasyonlar");
}

const NameSchema = z.string().trim().min(2, "Ad en az 2 karakter olmalı.").max(150, "Ad en fazla 150 karakter olabilir.");

function appUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/$/, "");
}

async function encryptFor(id: string, secret: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  try {
    return { ok: true, value: encryptSecret(secret, id) };
  } catch (error: unknown) {
    if (error instanceof SecretBoxError) {
      return { ok: false, error: "Sunucuda gizli anahtar saklama ayarı eksik (INTEGRATION_SECRET_KEY). Sistem yöneticinize bildirin." };
    }
    throw error;
  }
}

// ---- Atricard (gelen) ------------------------------------------------------------------------

export async function createInboundAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const name = NameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0]!.message };

  const id = randomUUID();
  const secret = generateWebhookSecret();
  const encrypted = await encryptFor(id, secret);
  if (!encrypted.ok) return { error: encrypted.error };

  const result = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(crmIntegrations)
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.kind, "atricard_inbound")));
    if ((row?.n ?? 0) >= MAX_INBOUND) return { error: `En fazla ${MAX_INBOUND} Atricard bağlantısı eklenebilir.` };
    await tx.insert(crmIntegrations).values({
      id,
      tenantId: session.tenantId,
      kind: "atricard_inbound",
      name: name.data,
      secretEnc: encrypted.value,
      events: [],
      enabled: true,
    });
    return null;
  });
  if (result) return result;

  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.created", entityType: "crm_integration", entityId: id, metadata: { kind: "atricard_inbound", name: name.data } });
  refresh();
  return {
    ok: "Bağlantı oluşturuldu. Adresi ve anahtarı şimdi Atricard'a girin; anahtar bir daha gösterilmez.",
    secret,
    url: `${appUrl()}/api/webhooks/atricard/${id}`,
  };
}

// ---- Giden webhook ---------------------------------------------------------------------------

const OutboundSchema = z.object({
  name: NameSchema,
  url: z.string().trim().min(1, "Alıcı adresini yazın."),
  events: z.array(z.string()).min(1, "En az bir olay seçin.").refine((list) => list.every(isOutboundEvent), "Bilinmeyen olay seçildi."),
  consent: z.literal("on", { errorMap: () => ({ message: "Devam etmek için verinin seçtiğiniz alıcıya gideceğini onaylayın." }) }),
});

export async function createOutboundAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const parsed = OutboundSchema.safeParse({
    name: formData.get("name") ?? "",
    url: formData.get("url") ?? "",
    events: formData.getAll("events").map(String),
    consent: formData.get("consent") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const urlCheck = validateWebhookUrl(parsed.data.url);
  if (!urlCheck.ok) return { error: urlCheck.message };

  const id = randomUUID();
  const secret = generateWebhookSecret();
  const encrypted = await encryptFor(id, secret);
  if (!encrypted.ok) return { error: encrypted.error };

  const result = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(crmIntegrations)
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.kind, "webhook_outbound")));
    if ((row?.n ?? 0) >= MAX_OUTBOUND) return { error: `En fazla ${MAX_OUTBOUND} giden webhook eklenebilir.` };
    await tx.insert(crmIntegrations).values({
      id,
      tenantId: session.tenantId,
      kind: "webhook_outbound",
      name: parsed.data.name,
      url: urlCheck.url.toString(),
      secretEnc: encrypted.value,
      events: parsed.data.events,
      enabled: true,
      consentAt: new Date(),
    });
    return null;
  });
  if (result) return result;

  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.created", entityType: "crm_integration", entityId: id, metadata: { kind: "webhook_outbound", name: parsed.data.name, url: urlCheck.url.origin, events: parsed.data.events } });
  refresh();
  return { ok: "Webhook oluşturuldu. İmza anahtarını şimdi kaydedin; bir daha gösterilmez.", secret };
}

/** Alıcı adresini ya da olayları değiştirir. Adres değişirse onay geçersiz olur, bağlantı kapanır. */
export async function updateOutboundAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const name = NameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0]!.message };
  const events = formData.getAll("events").map(String);
  if (events.length === 0 || !events.every(isOutboundEvent)) return { error: "En az bir geçerli olay seçin." };
  const urlCheck = validateWebhookUrl(String(formData.get("url") ?? ""));
  if (!urlCheck.ok) return { error: urlCheck.message };

  const outcome = await withTenant(session.tenantId, async (tx): Promise<{ error: string } | { urlChanged: boolean }> => {
    const [current] = await tx
      .select({ url: crmIntegrations.url })
      .from(crmIntegrations)
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id), eq(crmIntegrations.kind, "webhook_outbound")));
    if (!current) return { error: "Bağlantı bulunamadı." };
    const newUrl = urlCheck.url.toString();
    const urlChanged = current.url !== newUrl;
    await tx
      .update(crmIntegrations)
      .set({
        name: name.data,
        url: newUrl,
        events,
        updatedAt: new Date(),
        // Yeni alıcı = yeni onay: eski onay yeni adrese geçmez
        ...(urlChanged ? { enabled: false, consentAt: null, disabledReason: "manual", consecutiveFailures: 0 } : {}),
      })
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id)));
    return { urlChanged };
  });
  if ("error" in outcome) return { error: outcome.error };
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.updated", entityType: "crm_integration", entityId: id, metadata: { url: urlCheck.url.origin, events, urlChanged: outcome.urlChanged } });
  refresh();
  return { ok: outcome.urlChanged ? "Kaydedildi. Alıcı değiştiği için bağlantı kapandı; verinin yeni alıcıya gideceğini onaylayarak yeniden açın." : "Kaydedildi." };
}

export async function toggleIntegrationAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const enable = formData.get("enable") === "1";
  const consent = formData.get("consent") === "on";

  const done = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ kind: crmIntegrations.kind, url: crmIntegrations.url, consentAt: crmIntegrations.consentAt })
      .from(crmIntegrations)
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id)));
    if (!row) return false;
    if (!enable) {
      await tx.update(crmIntegrations).set({ enabled: false, disabledReason: "manual", updatedAt: new Date() }).where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id)));
      return true;
    }
    if (row.kind === "webhook_outbound") {
      // Veri seçilen alıcıya gideceği için onay şart (ilk açılışta ya da adres değişince yeniden)
      if (!row.consentAt && !consent) return false;
      if (!row.url || !validateWebhookUrl(row.url).ok) return false;
    }
    await tx
      .update(crmIntegrations)
      .set({
        enabled: true,
        disabledReason: null,
        consecutiveFailures: 0,
        updatedAt: new Date(),
        ...(row.kind === "webhook_outbound" && !row.consentAt ? { consentAt: new Date() } : {}),
      })
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id)));
    return true;
  });
  if (!done) return;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: enable ? "integration.enabled" : "integration.disabled", entityType: "crm_integration", entityId: id, metadata: { by: "user" } });
  refresh();
}

export async function regenerateSecretAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const secret = generateWebhookSecret();
  const encrypted = await encryptFor(id, secret);
  if (!encrypted.ok) return { error: encrypted.error };

  const updated = await withTenant(session.tenantId, (tx) =>
    tx
      .update(crmIntegrations)
      .set({ secretEnc: encrypted.value, updatedAt: new Date() })
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id)))
      .returning({ id: crmIntegrations.id }),
  );
  if (updated.length === 0) return { error: "Bağlantı bulunamadı." };
  // Anahtarın kendisi denetim kaydına YAZILMAZ
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.secret_regenerated", entityType: "crm_integration", entityId: id });
  refresh();
  return { ok: "Yeni anahtar oluşturuldu. Eski anahtar artık geçerli değil; şimdi alıcıya girin.", secret };
}

export async function deleteIntegrationAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const removed = await withTenant(session.tenantId, (tx) =>
    tx.delete(crmIntegrations).where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id))).returning({ id: crmIntegrations.id }),
  );
  if (removed.length === 0) return;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.deleted", entityType: "crm_integration", entityId: id });
  refresh();
}

export async function testSendAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const [row] = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ enabled: crmIntegrations.enabled, kind: crmIntegrations.kind })
      .from(crmIntegrations)
      .where(and(eq(crmIntegrations.tenantId, session.tenantId), eq(crmIntegrations.id, id))),
  );
  if (!row || row.kind !== "webhook_outbound") return { error: "Bağlantı bulunamadı." };
  if (!row.enabled) return { error: "Önce bağlantıyı açın, sonra test gönderin." };
  await enqueueTestDelivery(session.tenantId, id);
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.test_sent", entityType: "crm_integration", entityId: id });
  refresh();
  return { ok: "Test iletisi sıraya alındı. Birkaç saniye içinde 'Son teslimler' listesinde sonucu görürsünüz." };
}

export async function resendDeliveryAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  if (await requeueDelivery(session.tenantId, id)) {
    await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "integration.delivery_resent", entityType: "crm_webhook_delivery", entityId: id });
    refresh();
  }
}

// ---- API anahtarları -------------------------------------------------------------------------

export async function createApiKeyAction(_prev: RevealState, formData: FormData): Promise<RevealState> {
  const session = await guard();
  const name = NameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { error: name.error.issues[0]!.message };
  const key = generateApiKey();

  const result = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: count() })
      .from(crmApiKeys)
      .where(eq(crmApiKeys.tenantId, session.tenantId));
    if ((row?.n ?? 0) >= MAX_API_KEYS) return { error: `En fazla ${MAX_API_KEYS} API anahtarı oluşturulabilir. Kullanılmayanları silin.` };
    await tx.insert(crmApiKeys).values({ tenantId: session.tenantId, name: name.data, prefix: key.prefix, keyHash: key.hash, scopes: ["leads:read"] });
    return null;
  });
  if (result) return result;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "api_key.created", entityType: "crm_api_key", metadata: { name: name.data, prefix: key.prefix } });
  refresh();
  return { ok: "API anahtarı oluşturuldu. Şimdi kaydedin; bir daha gösterilmez.", secret: key.token };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const session = await guard();
  const id = String(formData.get("id") ?? "");
  const revoked = await withTenant(session.tenantId, (tx) =>
    tx
      .update(crmApiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(crmApiKeys.tenantId, session.tenantId), eq(crmApiKeys.id, id)))
      .returning({ prefix: crmApiKeys.prefix }),
  );
  if (revoked.length === 0) return;
  await writeAuditLog({ tenantId: session.tenantId, userId: session.userId, event: "api_key.revoked", entityType: "crm_api_key", entityId: id, metadata: { prefix: revoked[0]!.prefix } });
  refresh();
}

