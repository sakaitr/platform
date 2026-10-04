import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import type { EmailJob, WebhookJob } from "@/lib/queue";
import { sendEmail } from "./jobs/email";
import { enqueueEmail } from "@/lib/queue";
import { istanbulDayKey } from "@/lib/time";
import { runLicenseExpiryCheck } from "./jobs/license-expiry";
import { runSatisDigest, shouldRunDigest } from "./jobs/satis-digest";
import { processWebhookJob, purgeOldWebhookData, sweepDueDeliveries } from "./jobs/webhook-delivery";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

new Worker<EmailJob>("email", async (job) => sendEmail(job.data), { connection, concurrency: 5 });

new Worker<WebhookJob>("webhooks", async (job) => processWebhookJob(job.data), { connection, concurrency: 10 });

const ONE_HOUR_MS = 60 * 60 * 1000;

async function licenseLoop(): Promise<void> {
  try {
    const result = await runLicenseExpiryCheck();
    console.log(`[license] warned=${result.warned} expired=${result.expired}`);
  } catch (error: unknown) {
    console.error("[license] check failed:", error);
  }
  setTimeout(() => void licenseLoop(), ONE_HOUR_MS);
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
let lastDigestDay: string | null = null;

/**
 * Satış günlük özeti: 08:00'dan sonra günde bir kez. Redis `SET NX` kilidi yeniden başlatma ya da
 * birden çok işçi durumunda aynı kullanıcıya ikinci e-posta gitmesini engeller.
 */
async function digestLoop(): Promise<void> {
  try {
    const now = new Date();
    if (shouldRunDigest(now, lastDigestDay)) {
      const result = await runSatisDigest({
        now,
        claim: async (key) => (await connection.set(key, "1", "EX", 36 * 60 * 60, "NX")) === "OK",
        send: enqueueEmail,
      });
      lastDigestDay = istanbulDayKey(now);
      console.log(`[satis-digest] emails=${result.emails}`);
    }
  } catch (error: unknown) {
    console.error("[satis-digest] failed:", error);
  }
  setTimeout(() => void digestLoop(), FIFTEEN_MINUTES_MS);
}

const FIVE_SECONDS_MS = 5_000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;

/** Süpürücü: vakti gelmiş teslimleri kuyruğa alır (yeni olaylar ve kaybolmuş gecikmeli işler için). */
async function webhookSweepLoop(): Promise<void> {
  try {
    await sweepDueDeliveries();
  } catch (error: unknown) {
    console.error("[webhooks] sweep failed:", error);
  }
  setTimeout(() => void webhookSweepLoop(), FIVE_SECONDS_MS);
}

/** 30 günden eski teslim ve gelen olay günlüğü (yükte kişisel veri var). */
async function webhookPurgeLoop(): Promise<void> {
  try {
    const result = await purgeOldWebhookData();
    if (result.deliveries + result.inbound > 0) console.log(`[webhooks] purged deliveries=${result.deliveries} inbound=${result.inbound}`);
  } catch (error: unknown) {
    console.error("[webhooks] purge failed:", error);
  }
  setTimeout(() => void webhookPurgeLoop(), SIX_HOURS_MS);
}

console.log("Agno Platform worker started");
void licenseLoop();
void digestLoop();
void webhookSweepLoop();
void webhookPurgeLoop();
