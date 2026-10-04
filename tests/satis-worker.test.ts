import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmIntegrations, crmWebhookDeliveries, subscriptions, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { webhookQueue } from "@/lib/queue";
import { encryptSecret } from "@/lib/secret-box";
import { applySectorPack } from "@/lib/sector/install";
import { createLeadIfNew } from "@/modules/satis/leads";
import { processWebhookJob, sweepDueDeliveries } from "../worker/jobs/webhook-delivery";
import { resetDatabase } from "./setup";

/** Gerçek Redis/BullMQ ile: süpürücü, tekil iş kimliği ve gecikmeli yeniden deneme. */
describe("webhook işçisi (BullMQ)", () => {
  let tenantId: string;
  let deliveryId: string;

  beforeEach(async () => {
    await webhookQueue.obliterate({ force: true });
    await resetDatabase();
    const [t] = await dbAdmin.insert(tenants).values({ name: "w", slug: "w", sectorPack: "satis_crm", sectorPackVersion: "1.0.0" }).returning();
    tenantId = t!.id;
    await dbAdmin.insert(subscriptions).values({ tenantId, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
    await applySectorPack(tenantId, "satis_crm");
    const id = randomUUID();
    await dbAdmin.insert(crmIntegrations).values({
      id, tenantId, kind: "webhook_outbound", name: "H", url: "https://hooks.example.test/in",
      secretEnc: encryptSecret("whsec_x", id), events: ["lead.created"], enabled: true, consentAt: new Date(),
    });
    await withTenant(tenantId, (tx) => createLeadIfNew(tx, tenantId, { name: "Mavi Tur", source: "manual" }));
    deliveryId = (await dbAdmin.select().from(crmWebhookDeliveries))[0]!.id;
  });

  afterAll(async () => {
    await webhookQueue.obliterate({ force: true });
  });

  it("süpürücü vakti gelen teslimi kuyruğa alır; tekrar süpürme çift iş eklemez", async () => {
    expect(await sweepDueDeliveries()).toBe(1);
    expect(await sweepDueDeliveries()).toBe(1); // aynı teslim yine bulunur ama jobId aynı: tek iş
    const waiting = await webhookQueue.getWaiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.data).toEqual({ deliveryId });
  });

  it("vakti gelmemiş, kapalı uçlu ve tamamlanmış teslimler süpürülmez", async () => {
    await dbAdmin.update(crmWebhookDeliveries).set({ nextAttemptAt: new Date(Date.now() + 60_000) });
    expect(await sweepDueDeliveries()).toBe(0);
    await dbAdmin.update(crmWebhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) });
    await dbAdmin.update(crmIntegrations).set({ enabled: false });
    expect(await sweepDueDeliveries()).toBe(0);
    await dbAdmin.update(crmIntegrations).set({ enabled: true });
    await dbAdmin.update(crmWebhookDeliveries).set({ status: "succeeded" });
    expect(await sweepDueDeliveries()).toBe(0);
    expect(await webhookQueue.getWaiting()).toHaveLength(0);
  });

  it("başarısız teslimde bekleme süresi kadar GECİKMELİ iş eklenir (1 dk)", async () => {
    const outcome = await processWebhookJob({ deliveryId }, { send: async () => ({ status: 500, body: "hata" }) });
    expect(outcome).toBe("retry");
    const delayed = await webhookQueue.getDelayed();
    expect(delayed).toHaveLength(1);
    expect(delayed[0]!.opts.delay).toBe(60_000);
    expect(delayed[0]!.data).toEqual({ deliveryId });
    const [row] = await dbAdmin.select().from(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.id, deliveryId));
    expect(row).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500 });
  });

  it("başarılı teslimde yeni iş eklenmez", async () => {
    expect(await processWebhookJob({ deliveryId }, { send: async () => ({ status: 200, body: "" }) })).toBe("succeeded");
    expect(await webhookQueue.getDelayed()).toHaveLength(0);
    expect(await webhookQueue.getWaiting()).toHaveLength(0);
  });

  it("aynı iş iki kez çalışsa da yalnız bir kez gönderilir (atomik kira)", async () => {
    let sent = 0;
    const send = async () => {
      sent += 1;
      return { status: 200, body: "" };
    };
    const results = await Promise.all([processWebhookJob({ deliveryId }, { send }), processWebhookJob({ deliveryId }, { send })]);
    expect(sent).toBe(1);
    expect(results.sort()).toEqual(["skipped", "succeeded"]);
  });
});
