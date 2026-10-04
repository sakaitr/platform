/**
 * Elle çalıştırılan uçtan uca doğrulama (CI testi değil, ağ gerektirir):
 *   DATABASE_URL=... DATABASE_ADMIN_URL=... INTEGRATION_SECRET_KEY=... npx tsx scripts/verify-webhook-e2e.ts
 * Gerçek DNS + TLS ile herkese açık bir echo hizmetine (httpbin.org) üretim kurallarıyla teslim eder:
 * olay kutusu → süpürücü → BullMQ → worker işleyicisi → safePost → imza doğrulama.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmIntegrations, crmWebhookDeliveries, subscriptions, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { webhookQueue } from "@/lib/queue";
import { encryptSecret, generateWebhookSecret } from "@/lib/secret-box";
import { applySectorPack } from "@/lib/sector/install";
import { verifySignature } from "@/lib/webhook-signing";
import { createLeadIfNew } from "@/modules/satis/leads";
import { processWebhookJob, sweepDueDeliveries } from "../worker/jobs/webhook-delivery";

async function main(): Promise<void> {
  const slug = `verify-${Date.now()}`;
  const [t] = await dbAdmin.insert(tenants).values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" }).returning();
  const tenantId = t!.id;
  await dbAdmin.insert(subscriptions).values({ tenantId, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(tenantId, "satis_crm");

  const secret = generateWebhookSecret();
  const integrationId = randomUUID();
  await dbAdmin.insert(crmIntegrations).values({
    id: integrationId, tenantId, kind: "webhook_outbound", name: "httpbin", url: "https://httpbin.org/anything/webhook",
    secretEnc: encryptSecret(secret, integrationId), events: ["lead.created"], enabled: true, consentAt: new Date(),
  });

  const leadId = await withTenant(tenantId, async (tx) => {
    const r = await createLeadIfNew(tx, tenantId, { name: "Doğrulama Ltd", contactName: "Zeynep", phone: "05330000000", email: "z@example.com", source: "manual" });
    if (r.status !== "created") throw new Error("lead");
    return r.id;
  });

  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  const worker = new Worker("webhooks", async (job) => processWebhookJob(job.data), { connection });
  console.log("süpürücü kuyruğa aldı:", await sweepDueDeliveries());

  const deadline = Date.now() + 30_000;
  let row = (await dbAdmin.select().from(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.integrationId, integrationId)))[0]!;
  while (row.status === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    row = (await dbAdmin.select().from(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.integrationId, integrationId)))[0]!;
  }
  console.log("teslim durumu:", row.status, "deneme:", row.attempts, "http:", row.responseStatus, "hata:", row.lastError);

  if (row.status === "succeeded") {
    // httpbin gönderdiğimizi yankılıyor; kendi çağrımızı ikinci kez yapıp yanıtı alalım
    const { safePost } = await import("@/lib/safe-url");
    const { signPayload, secondsNow } = await import("@/lib/webhook-signing");
    const body = JSON.stringify(row.payload);
    const timestamp = secondsNow();
    const res = await safePost("https://httpbin.org/anything/webhook", body, {
      "Content-Type": "application/json", "User-Agent": "AtriCRM-Webhooks/1",
      "X-AtriCRM-Event": "lead.created", "X-AtriCRM-Delivery": row.id, "X-AtriCRM-Timestamp": timestamp,
      "X-AtriCRM-Signature": signPayload(secret, timestamp, body),
    }, { maxBytes: 20_000 });
    const echo = JSON.parse(res.body) as { headers: Record<string, string>; data: string; method: string };
    const verified = verifySignature({ secret, timestamp: echo.headers["X-Atricrm-Timestamp"], signature: echo.headers["X-Atricrm-Signature"], rawBody: echo.data });
    console.log("yankı: method", echo.method, "event", echo.headers["X-Atricrm-Event"], "ua", echo.headers["User-Agent"]);
    console.log("alıcı tarafında imza doğrulama:", JSON.stringify(verified), "| gövde yükle aynı:", echo.data === body, "| aday kimliği:", (JSON.parse(echo.data) as { id: string }).id === leadId);
  }

  await worker.close();
  await webhookQueue.close();
  await connection.quit();
  await dbAdmin.delete(tenants).where(eq(tenants.id, tenantId));
  process.exit(row.status === "succeeded" ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
