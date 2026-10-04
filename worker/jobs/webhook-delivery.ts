import { enqueueWebhookDelivery, type WebhookJob } from "@/lib/queue";
import { attemptDelivery, findDueDeliveryIds, purgeOldWebhookData } from "@/modules/satis/webhook-delivery";

/**
 * BullMQ işleyicisi: tek teslimi dener. Başarısızsa bekleme süresi (1 dk, 5 dk, 30 dk, 2 sa, 12 sa)
 * kadar GECİKMELİ yeni iş ekler. Veritabanı satırı (`next_attempt_at`) gerçeğin kaynağıdır; süpürücü
 * gecikmeli iş kaybolsa bile teslimi vakti gelince yeniden bulur. Çift tetiklenmeye karşı koruma
 * `attemptDelivery` içindeki atomik kiradadır.
 */
export async function processWebhookJob(data: WebhookJob): Promise<string> {
  const result = await attemptDelivery(data.deliveryId);
  if (result.outcome === "retry") {
    await enqueueWebhookDelivery(data.deliveryId, {
      delayMs: result.retryInMs,
      jobId: `deliver-${data.deliveryId}-${Date.now()}`,
    });
  }
  return result.outcome;
}

/** Vakti gelmiş bekleyen teslimleri kuyruğa alır. Kuyruk kapalıyken kira sayesinde sonra yeniden bulunur. */
export async function sweepDueDeliveries(limit = 200): Promise<number> {
  const ids = await findDueDeliveryIds(limit);
  for (const id of ids) await enqueueWebhookDelivery(id);
  return ids.length;
}

export { purgeOldWebhookData };
