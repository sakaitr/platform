import { Queue } from "bullmq";
import IORedis from "ioredis";

export type EmailJob = { to: string; subject: string; body: string };

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue<EmailJob>("email", { connection });

export async function enqueueEmail(job: EmailJob): Promise<void> {
  await emailQueue.add("send", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

export type WebhookJob = { deliveryId: string };

/** Giden webhook teslimleri. Gerçek durum veritabanındadır; kuyruk yalnız tetikler ve gecikmeyi zamanlar. */
export const webhookQueue = new Queue<WebhookJob>("webhooks", { connection });

/**
 * Teslim için iş ekler. `jobId` aynı teslim için çift işi engeller (BullMQ aynı kimliği yok sayar).
 * Tekrar deneme bekleme süresi `delayMs` ile ELLE zamanlanır; yerleşik exponential backoff kullanılmaz,
 * takvim sabit ve test edilebilir olsun (`retryDelayMs`).
 */
export async function enqueueWebhookDelivery(deliveryId: string, options: { delayMs?: number; jobId?: string } = {}): Promise<void> {
  await webhookQueue.add(
    "deliver",
    { deliveryId },
    {
      delay: options.delayMs ?? 0,
      jobId: options.jobId ?? `deliver-${deliveryId}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  );
}
