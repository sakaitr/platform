import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  crmDeals,
  crmDeletedExternal,
  crmInboundEvents,
  crmIntegrations,
  crmLeads,
  crmStages,
  crmWebhookDeliveries,
  subscriptions,
  tenantCapabilities,
  tenants,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { encryptSecret } from "@/lib/secret-box";
import { applySectorPack } from "@/lib/sector/install";
import { secondsNow, verifySignature } from "@/lib/webhook-signing";
import { createDeal, moveDeal } from "@/modules/satis/deals";
import { convertLead, createLeadIfNew, eraseExternalLead, removeLeads, updateLead } from "@/modules/satis/leads";
import {
  attemptDelivery,
  claimDelivery,
  enqueueTestDelivery,
  findDueDeliveryIds,
  purgeOldWebhookData,
  requeueDelivery,
  type SendFn,
} from "@/modules/satis/webhook-delivery";
import { AUTO_DISABLE_AFTER_FAILURES, MAX_ATTEMPTS, RETRY_DELAYS_MS } from "@/modules/satis/webhooks";
import { resetDatabase } from "./setup";

const SECRET = "whsec_" + "ab".repeat(32);
const URL_OK = "https://hooks.example.test/in";
const T0 = new Date("2026-10-04T10:00:00Z");
const ALL = ["lead.created", "lead.updated", "lead.deleted", "deal.stage_changed", "deal.won", "deal.lost"];

async function seedTenant(slug = "t1") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({
    tenantId: t!.id,
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  });
  await applySectorPack(t!.id, "satis_crm");
  return t!.id;
}

async function addEndpoint(
  tenantId: string,
  over: Partial<typeof crmIntegrations.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await dbAdmin.insert(crmIntegrations).values({
    id,
    tenantId,
    kind: "webhook_outbound",
    name: "Hedef",
    url: URL_OK,
    secretEnc: encryptSecret(SECRET, id),
    events: ALL,
    enabled: true,
    consentAt: new Date(),
    ...over,
  });
  return id;
}

const deliveries = (tenantId: string) =>
  dbAdmin.select().from(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.tenantId, tenantId));

const createLead = (tenantId: string, over: Partial<Parameters<typeof createLeadIfNew>[2]> = {}) =>
  withTenant(tenantId, async (tx) => {
    const r = await createLeadIfNew(tx, tenantId, { name: "Mavi Tur", phone: "05320000000", source: "manual", ...over });
    if (r.status !== "created") throw new Error("seed");
    return r.id;
  });

describe("giden olay kutusu", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });

  it("aday oluşunca abone uca bekleyen teslim yazılır; yük olay anındaki veriyi taşır", async () => {
    const endpoint = await addEndpoint(tenantId);
    const leadId = await createLead(tenantId, { email: "d@x.co", service: "Web", eventName: "Fuar", temperature: "hot" });
    const rows = await deliveries(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ integrationId: endpoint, event: "lead.created", status: "pending", attempts: 0, leadId });
    expect(rows[0]!.nextAttemptAt).not.toBeNull();
    expect(rows[0]!.payload).toMatchObject({
      event: "lead.created", version: 1, id: leadId,
      lead: { name: "Mavi Tur", email: "d@x.co", service: "Web", event_name: "Fuar", temperature: "hot", score: 80, origin: "manual" },
    });
  });

  it("abone olmayan olay, kapalı uç ve uçsuz kiracı için hiçbir şey yazılmaz", async () => {
    await addEndpoint(tenantId, { events: ["deal.won"] });
    await addEndpoint(tenantId, { enabled: false, name: "Kapalı" });
    await createLead(tenantId);
    expect(await deliveries(tenantId)).toHaveLength(0);

    await resetDatabase();
    const bare = await seedTenant("bare");
    await createLead(bare);
    expect(await deliveries(bare)).toHaveLength(0);
  });

  it("gelen (atricard_inbound) uç giden olay almaz", async () => {
    await addEndpoint(tenantId, { kind: "atricard_inbound", url: null });
    await createLead(tenantId);
    expect(await deliveries(tenantId)).toHaveLength(0);
  });

  it("transaction geri alınırsa olay da yazılmaz", async () => {
    await addEndpoint(tenantId);
    await expect(
      withTenant(tenantId, async (tx) => {
        await createLeadIfNew(tx, tenantId, { name: "Geri alınan", source: "manual" });
        throw new Error("iptal");
      }),
    ).rejects.toThrow("iptal");
    expect(await dbAdmin.select().from(crmLeads)).toHaveLength(0);
    expect(await deliveries(tenantId)).toHaveLength(0);
  });

  it("başka kiracının ucuna olay gitmez", async () => {
    const other = await seedTenant("t2");
    await addEndpoint(other);
    await createLead(tenantId);
    expect(await deliveries(other)).toHaveLength(0);
  });

  it("birden çok abone uç: her birine ayrı teslim (ayrı teslim kimliği)", async () => {
    await addEndpoint(tenantId, { name: "A" });
    await addEndpoint(tenantId, { name: "B" });
    await createLead(tenantId);
    const rows = await deliveries(tenantId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("güncelleme ve dönüştürme lead.updated yazar", async () => {
    await addEndpoint(tenantId);
    const leadId = await createLead(tenantId);
    await withTenant(tenantId, (tx) => updateLead(tx, tenantId, leadId, { name: "Mavi Tur Ltd", phone: "05320000000", temperature: "cold" }));
    await withTenant(tenantId, (tx) => convertLead(tx, tenantId, leadId, null));
    const events = (await deliveries(tenantId)).map((d) => d.event).sort();
    expect(events).toEqual(["lead.created", "lead.updated", "lead.updated"]);
    const updates = (await deliveries(tenantId)).filter((d) => d.event === "lead.updated");
    expect(updates.map((u) => (u.payload as { lead: { status: string } }).lead.status).sort()).toEqual(["converted", "new"]);
  });

  it("fırsat taşıma: stage_changed her zaman, kazanılan/kaybedilende ayrıca won/lost; aday dönüşümü lead.updated", async () => {
    await addEndpoint(tenantId);
    const leadId = await createLead(tenantId);
    const dealId = await withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "Web", value: 1000, leadId }));
    const stage = async (key: string) =>
      (await dbAdmin.select().from(crmStages).where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.key, key))))[0]!.id;
    await dbAdmin.delete(crmWebhookDeliveries);

    await withTenant(tenantId, async (tx) => moveDeal(tx, tenantId, dealId, await stage("teklif")));
    expect((await deliveries(tenantId)).map((d) => d.event)).toEqual(["deal.stage_changed"]);

    await dbAdmin.delete(crmWebhookDeliveries);
    await withTenant(tenantId, async (tx) => moveDeal(tx, tenantId, dealId, await stage("kazanildi")));
    expect((await deliveries(tenantId)).map((d) => d.event).sort()).toEqual(["deal.stage_changed", "deal.won", "lead.updated"]);
    const won = (await deliveries(tenantId)).find((d) => d.event === "deal.won")!;
    expect(won.payload).toMatchObject({ event: "deal.won", deal: { title: "Web", stage: { label: "Kazanıldı", kind: "won" }, previous_stage: { label: "Teklif" } }, lead_id: leadId });

    await dbAdmin.delete(crmWebhookDeliveries);
    await withTenant(tenantId, async (tx) => moveDeal(tx, tenantId, dealId, await stage("kaybedildi"), { lostReason: "Bütçe" }));
    const lost = (await deliveries(tenantId)).find((d) => d.event === "deal.lost")!;
    expect(lost.payload).toMatchObject({ deal: { lost_reason: "Bütçe" } });
    // aynı aşamaya taşıma olay üretmez
    await dbAdmin.delete(crmWebhookDeliveries);
    await withTenant(tenantId, async (tx) => moveDeal(tx, tenantId, dealId, await stage("kaybedildi")));
    expect(await deliveries(tenantId)).toHaveLength(0);
  });
});

describe("KVKK: silinen adayın teslimleri", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });

  it("bekleyen created/updated teslimleri İPTAL edilir, lead.deleted yine gönderilir, yük yalnız kimlik+neden taşır", async () => {
    const endpoint = await addEndpoint(tenantId);
    const leadId = await createLead(tenantId, { email: "kisisel@x.co", message: "özel mesaj" });
    await withTenant(tenantId, (tx) => updateLead(tx, tenantId, leadId, { name: "Mavi Tur", phone: "05320000000", email: "kisisel@x.co" }));
    expect((await deliveries(tenantId)).filter((d) => d.status === "pending")).toHaveLength(2);

    await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [leadId], "erasure_request"));
    const rows = await deliveries(tenantId);
    const created = rows.find((r) => r.event === "lead.created")!;
    const updated = rows.find((r) => r.event === "lead.updated")!;
    const deleted = rows.find((r) => r.event === "lead.deleted")!;
    expect(created.status).toBe("cancelled");
    expect(updated.status).toBe("cancelled");
    expect(created.nextAttemptAt).toBeNull();
    expect(deleted).toMatchObject({ status: "pending", integrationId: endpoint });
    expect(deleted.payload).toMatchObject({ event: "lead.deleted", version: 1, id: leadId, reason: "erasure_request" });
    expect(JSON.stringify(deleted.payload)).not.toMatch(/Mavi|kisisel|özel/);
    // iptal edilmiş teslimler hiçbir zaman gönderilmez
    const due = await findDueDeliveryIds(10, new Date(Date.now() + 1000));
    expect(due).toEqual([deleted.id]);
  });

  it("zaten teslim edilmiş eski teslimlerin yükündeki kişisel veri silinir", async () => {
    await addEndpoint(tenantId);
    const leadId = await createLead(tenantId, { email: "kisisel@x.co", message: "özel mesaj" });
    await dbAdmin.update(crmWebhookDeliveries).set({ status: "succeeded", deliveredAt: new Date() });
    await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [leadId]));
    const created = (await deliveries(tenantId)).find((d) => d.event === "lead.created")!;
    expect(created.status).toBe("succeeded"); // tarih değişmez
    expect(created.payload).toEqual({ event: "lead.created", version: 1, id: leadId, redacted: true });
    expect(JSON.stringify(created.payload)).not.toContain("kisisel");
  });

  it("başka adayın teslimlerine dokunmaz", async () => {
    await addEndpoint(tenantId);
    const a = await createLead(tenantId, { name: "A Kişi", phone: "05320000001" });
    const b = await createLead(tenantId, { name: "B Kişi", phone: "05320000002" });
    await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [a]));
    const bRow = (await deliveries(tenantId)).find((d) => d.leadId === b && d.event === "lead.created")!;
    expect(bRow.status).toBe("pending");
    expect(JSON.stringify(bRow.payload)).toContain("B Kişi");
  });

  it("uç sonradan açılmış olsa bile bekleyen teslimler iptal edilir; uç yoksa lead.deleted yazılmaz", async () => {
    const leadId = await createLead(tenantId);
    expect(await deliveries(tenantId)).toHaveLength(0);
    await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, [leadId]));
    expect(await deliveries(tenantId)).toHaveLength(0);
  });

  it("Atricard silme yolu (eraseExternalLead): anonimleşme de lead.deleted üretir ve eski yükleri temizler", async () => {
    await addEndpoint(tenantId);
    const leadId = await createLead(tenantId, { source: "atricard", externalId: "ext-9", email: "k@x.co" });
    await withTenant(tenantId, (tx) => createDeal(tx, tenantId, { title: "Fırsat", leadId }));
    await dbAdmin.delete(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.event, "deal.stage_changed"));
    const result = await withTenant(tenantId, (tx) => eraseExternalLead(tx, tenantId, "atricard", "ext-9", "erasure_request"));
    expect(result).toBe("anonymized");
    const rows = await deliveries(tenantId);
    expect(rows.find((r) => r.event === "lead.created")!.status).toBe("cancelled");
    expect(rows.find((r) => r.event === "lead.deleted")!.payload).toMatchObject({ id: leadId, reason: "erasure_request" });
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("toplu silmede her aday için ayrı lead.deleted", async () => {
    await addEndpoint(tenantId);
    const ids = [await createLead(tenantId, { name: "A Kişi", phone: "05320000001" }), await createLead(tenantId, { name: "B Kişi", phone: "05320000002" })];
    await withTenant(tenantId, (tx) => removeLeads(tx, tenantId, ids));
    const deleted = (await deliveries(tenantId)).filter((d) => d.event === "lead.deleted");
    expect(deleted.map((d) => d.leadId).sort()).toEqual([...ids].sort());
  });
});

type Call = { url: string; body: string; headers: Record<string, string> };

function fakeSend(responder: (call: Call, n: number) => { status: number; body?: string } | Error = () => ({ status: 200 })) {
  const calls: Call[] = [];
  const send: SendFn = async (url, body, headers) => {
    const call = { url, body, headers };
    calls.push(call);
    const out = responder(call, calls.length);
    if (out instanceof Error) throw out;
    return { status: out.status, body: out.body ?? "" };
  };
  return { send, calls };
}

describe("teslim motoru", () => {
  let tenantId: string;
  let endpoint: string;
  let deliveryId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
    endpoint = await addEndpoint(tenantId);
    await createLead(tenantId);
    deliveryId = (await deliveries(tenantId))[0]!.id;
    await dbAdmin.update(crmWebhookDeliveries).set({ nextAttemptAt: T0 });
  });

  const delivery = async () => (await dbAdmin.select().from(crmWebhookDeliveries).where(eq(crmWebhookDeliveries.id, deliveryId)))[0]!;
  const integration = async () => (await dbAdmin.select().from(crmIntegrations).where(eq(crmIntegrations.id, endpoint)))[0]!;

  it("başarı: doğru başlıklar, geçerli imza, gövde yükle aynı; sayaç sıfırlanır", async () => {
    await dbAdmin.update(crmIntegrations).set({ consecutiveFailures: 3 }).where(eq(crmIntegrations.id, endpoint));
    const { send, calls } = fakeSend();
    const result = await attemptDelivery(deliveryId, { now: T0, send });
    expect(result).toEqual({ outcome: "succeeded", status: 200 });

    const call = calls[0]!;
    const row = await delivery();
    expect(call.url).toBe(URL_OK);
    expect(call.body).toBe(JSON.stringify(row.payload));
    expect(call.headers).toMatchObject({
      "X-AtriCRM-Event": "lead.created",
      "X-AtriCRM-Delivery": deliveryId,
      "X-AtriCRM-Timestamp": secondsNow(T0),
      "User-Agent": "AtriCRM-Webhooks/1",
      "Content-Type": "application/json; charset=utf-8",
    });
    expect(verifySignature({ secret: SECRET, timestamp: call.headers["X-AtriCRM-Timestamp"], signature: call.headers["X-AtriCRM-Signature"], rawBody: call.body, now: T0 })).toEqual({ ok: true });
    expect(row).toMatchObject({ status: "succeeded", attempts: 1, responseStatus: 200, lastError: null, nextAttemptAt: null });
    expect(row.deliveredAt).toEqual(T0);
    expect(await integration()).toMatchObject({ consecutiveFailures: 0 });
    expect((await integration()).lastUsedAt).toEqual(T0);
  });

  it("başarısızlık: 1 dk sonra tekrar; her denemede imza ve zaman damgası yeni, teslim kimliği aynı", async () => {
    const { send, calls } = fakeSend(() => ({ status: 500, body: "sunucu hatası" }));
    const first = await attemptDelivery(deliveryId, { now: T0, send });
    expect(first).toEqual({ outcome: "retry", retryInMs: 60_000, status: 500 });
    expect(await delivery()).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500, lastError: "HTTP 500: sunucu hatası" });
    expect((await delivery()).nextAttemptAt).toEqual(new Date(T0.getTime() + 60_000));

    // vakti gelmeden tekrar denenmez
    expect((await attemptDelivery(deliveryId, { now: new Date(T0.getTime() + 30_000), send })).outcome).toBe("skipped");
    expect(calls).toHaveLength(1);

    const later = new Date(T0.getTime() + 60_000);
    await attemptDelivery(deliveryId, { now: later, send });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers["X-AtriCRM-Delivery"]).toBe(calls[0]!.headers["X-AtriCRM-Delivery"]);
    expect(calls[1]!.headers["X-AtriCRM-Timestamp"]).not.toBe(calls[0]!.headers["X-AtriCRM-Timestamp"]);
    expect(calls[1]!.headers["X-AtriCRM-Signature"]).not.toBe(calls[0]!.headers["X-AtriCRM-Signature"]);
    expect(verifySignature({ secret: SECRET, timestamp: calls[1]!.headers["X-AtriCRM-Timestamp"], signature: calls[1]!.headers["X-AtriCRM-Signature"], rawBody: calls[1]!.body, now: later })).toEqual({ ok: true });
  });

  it("tam takvim: 1 dk, 5 dk, 30 dk, 2 sa, 12 sa, sonra failed; altı deneme", async () => {
    const { send, calls } = fakeSend(() => ({ status: 503 }));
    let now = T0;
    const delays: (number | null)[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const result = await attemptDelivery(deliveryId, { now, send });
      if (result.outcome === "retry") {
        delays.push(result.retryInMs);
        now = new Date(now.getTime() + result.retryInMs);
      } else {
        delays.push(null);
        expect(result).toEqual({ outcome: "failed", status: 503, disabled: false });
      }
    }
    expect(delays).toEqual([...RETRY_DELAYS_MS, null]);
    expect(calls).toHaveLength(6);
    expect(await delivery()).toMatchObject({ status: "failed", attempts: 6, nextAttemptAt: null, lastError: "HTTP 503" });
    expect(await integration()).toMatchObject({ consecutiveFailures: 1, enabled: true });
    // failed teslim bir daha denenmez
    expect((await attemptDelivery(deliveryId, { now: new Date(now.getTime() + 1e9), send })).outcome).toBe("skipped");
    expect(calls).toHaveLength(6);
  });

  it("2xx dışındaki her şey başarısızlıktır: 3xx (yönlendirme), 4xx dahil", async () => {
    for (const status of [301, 302, 400, 401, 404, 410, 429, 500, 199, 100]) {
      await dbAdmin.update(crmWebhookDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: T0 });
      const { send } = fakeSend(() => ({ status }));
      const result = await attemptDelivery(deliveryId, { now: T0, send });
      expect(result.outcome, String(status)).toBe("retry");
    }
    for (const status of [200, 201, 202, 204, 299]) {
      await dbAdmin.update(crmWebhookDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: T0 });
      const { send } = fakeSend(() => ({ status }));
      expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome, String(status)).toBe("succeeded");
    }
  });

  it("ağ hatası tekrar deneme olarak kaydedilir; yanıt gövdesi sınırlanır", async () => {
    const { send } = fakeSend(() => new Error("ECONNRESET"));
    expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome).toBe("retry");
    expect((await delivery()).lastError).toBe("ECONNRESET");

    await dbAdmin.update(crmWebhookDeliveries).set({ attempts: 0, nextAttemptAt: T0 });
    const big = fakeSend(() => ({ status: 500, body: "x".repeat(5000) }));
    await attemptDelivery(deliveryId, { now: T0, send: big.send });
    expect((await delivery()).lastError!.length).toBeLessThanOrEqual(500);
  });

  it("art arda 20 başarısız TESLİMDE uç kapanır ve yöneticiye haber gider; 19'da kapanmaz", async () => {
    const notify = vi.fn(async () => {});
    const { send } = fakeSend(() => ({ status: 500 }));
    await dbAdmin.update(crmIntegrations).set({ consecutiveFailures: AUTO_DISABLE_AFTER_FAILURES - 2 }).where(eq(crmIntegrations.id, endpoint));
    await dbAdmin.update(crmWebhookDeliveries).set({ attempts: MAX_ATTEMPTS - 1 });
    expect(await attemptDelivery(deliveryId, { now: T0, send, notifyAdmins: notify })).toMatchObject({ outcome: "failed", disabled: false });
    expect(await integration()).toMatchObject({ consecutiveFailures: 19, enabled: true });
    expect(notify).not.toHaveBeenCalled();

    // yirminci başarısız teslim
    await createLead(tenantId, { name: "İkinci", phone: "05320000009" });
    const second = (await deliveries(tenantId)).find((d) => d.id !== deliveryId)!;
    await dbAdmin.update(crmWebhookDeliveries).set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: T0 }).where(eq(crmWebhookDeliveries.id, second.id));
    expect(await attemptDelivery(second.id, { now: T0, send, notifyAdmins: notify })).toMatchObject({ outcome: "failed", disabled: true });
    expect(await integration()).toMatchObject({ consecutiveFailures: 20, enabled: false, disabledReason: "failures" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(tenantId, expect.stringContaining("kapatıldı"), expect.stringContaining("20"));

    // kapalı uca yeni teslim yazılmaz ve bekleyenler süpürülmez
    await createLead(tenantId, { name: "Üçüncü", phone: "05320000008" });
    expect((await deliveries(tenantId)).filter((d) => d.status === "pending").every((d) => d.integrationId === endpoint)).toBe(true);
    expect(await findDueDeliveryIds(50, new Date(Date.now() + 1e9))).toEqual([]);
  });

  it("tekrar deneme sırasında başarılı olan teslim başarısızlık sayacını artırmaz", async () => {
    let n = 0;
    const { send } = fakeSend(() => ({ status: ++n < 3 ? 500 : 200 }));
    let now = T0;
    for (let i = 0; i < 3; i += 1) {
      const r = await attemptDelivery(deliveryId, { now, send });
      if (r.outcome === "retry") now = new Date(now.getTime() + r.retryInMs);
    }
    expect(await delivery()).toMatchObject({ status: "succeeded", attempts: 3 });
    expect(await integration()).toMatchObject({ consecutiveFailures: 0 });
  });

  it("eşzamanlı iki işçi: yalnız biri gönderir (atomik kira)", async () => {
    const { send, calls } = fakeSend();
    const results = await Promise.all([attemptDelivery(deliveryId, { now: T0, send }), attemptDelivery(deliveryId, { now: T0, send }), attemptDelivery(deliveryId, { now: T0, send })]);
    expect(calls).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "succeeded")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "skipped")).toHaveLength(2);
  });

  it("kira: işçi çökerse kira dolana kadar başkası almaz, dolunca yeniden alınır", async () => {
    expect(await claimDelivery(deliveryId, T0)).toEqual({ tenantId });
    const { send, calls } = fakeSend();
    // çöken işçi hiçbir şey yazmadı; kira süresi (2 dk) dolmadan
    expect((await attemptDelivery(deliveryId, { now: new Date(T0.getTime() + 60_000), send })).outcome).toBe("skipped");
    expect(await findDueDeliveryIds(10, new Date(T0.getTime() + 60_000))).toEqual([]);
    // kira dolunca
    expect(await findDueDeliveryIds(10, new Date(T0.getTime() + 121_000))).toEqual([deliveryId]);
    expect((await attemptDelivery(deliveryId, { now: new Date(T0.getTime() + 121_000), send })).outcome).toBe("succeeded");
    expect(calls).toHaveLength(1);
  });

  it("kapalı uç, iptal edilmiş ve tamamlanmış teslim gönderilmez", async () => {
    const { send, calls } = fakeSend();
    await dbAdmin.update(crmIntegrations).set({ enabled: false }).where(eq(crmIntegrations.id, endpoint));
    expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome).toBe("skipped");
    await dbAdmin.update(crmIntegrations).set({ enabled: true }).where(eq(crmIntegrations.id, endpoint));

    for (const status of ["cancelled", "succeeded", "failed"] as const) {
      await dbAdmin.update(crmWebhookDeliveries).set({ status, nextAttemptAt: T0 });
      expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome, status).toBe("skipped");
    }
    expect(calls).toHaveLength(0);
  });

  it("plan düştü (yetenek yok): uç plan_not_allowed ile kapanır, gönderilmez, teslim bekler", async () => {
    await dbAdmin
      .delete(tenantCapabilities)
      .where(and(eq(tenantCapabilities.tenantId, tenantId), eq(tenantCapabilities.capabilityKey, "satis.entegrasyon")));
    const { send, calls } = fakeSend();
    expect(await attemptDelivery(deliveryId, { now: T0, send })).toEqual({ outcome: "blocked", reason: "plan_not_allowed" });
    expect(calls).toHaveLength(0);
    expect(await integration()).toMatchObject({ enabled: false, disabledReason: "plan_not_allowed" });
    expect((await delivery()).status).toBe("pending");
  });

  it("süresi dolmuş abonelikte gönderilmez", async () => {
    await dbAdmin.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.tenantId, tenantId));
    const { send, calls } = fakeSend();
    expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome).toBe("blocked");
    expect(calls).toHaveLength(0);
  });

  it("kayıttan sonra iç ağ adresine çevrilmiş uç ssrf ile kapanır, gönderilmez", async () => {
    for (const bad of ["https://127.0.0.1/x", "http://hooks.example.test/x", "https://localhost/x", "https://169.254.169.254/"]) {
      await dbAdmin.update(crmIntegrations).set({ url: bad, enabled: true, disabledReason: null }).where(eq(crmIntegrations.id, endpoint));
      await dbAdmin.update(crmWebhookDeliveries).set({ status: "pending", nextAttemptAt: T0 });
      const { send, calls } = fakeSend();
      expect(await attemptDelivery(deliveryId, { now: T0, send }), bad).toEqual({ outcome: "blocked", reason: "ssrf" });
      expect(calls).toHaveLength(0);
      expect(await integration()).toMatchObject({ enabled: false, disabledReason: "ssrf" });
    }
  });

  it("anahtar çözülemezse (ana anahtar değişmiş) başarısızlık olarak kaydedilir, gönderilmez", async () => {
    await dbAdmin.update(crmIntegrations).set({ secretEnc: encryptSecret(SECRET, endpoint, "baska-ana-anahtar-0123456789-abcdefghijklmnop") }).where(eq(crmIntegrations.id, endpoint));
    const { send, calls } = fakeSend();
    expect((await attemptDelivery(deliveryId, { now: T0, send })).outcome).toBe("retry");
    expect(calls).toHaveLength(0);
    expect((await delivery()).lastError).toMatch(/yeniden oluşturun/);
  });

  it("başka satırın şifreli anahtarı kopyalanırsa çözülmez (AAD)", async () => {
    const other = await addEndpoint(tenantId, { name: "Diğer" });
    const [otherRow] = await dbAdmin.select().from(crmIntegrations).where(eq(crmIntegrations.id, other));
    await dbAdmin.update(crmIntegrations).set({ secretEnc: otherRow!.secretEnc }).where(eq(crmIntegrations.id, endpoint));
    const { send, calls } = fakeSend();
    await attemptDelivery(deliveryId, { now: T0, send });
    expect(calls).toHaveLength(0);
  });

  it("süpürücü yalnız vakti gelmiş bekleyen, açık uçlu teslimleri bulur", async () => {
    expect(await findDueDeliveryIds(10, T0)).toEqual([deliveryId]);
    expect(await findDueDeliveryIds(10, new Date(T0.getTime() - 1000))).toEqual([]);
  });

  it("elle yeniden gönderme yalnız failed teslimde, sayaç sıfırlanır, kimlik aynı; başka kiracı yapamaz", async () => {
    expect(await requeueDelivery(tenantId, deliveryId, T0)).toBe(false); // pending
    await dbAdmin.update(crmWebhookDeliveries).set({ status: "failed", attempts: 6, lastError: "x", nextAttemptAt: null });
    const other = await seedTenant("t2");
    expect(await requeueDelivery(other, deliveryId, T0)).toBe(false);
    expect(await requeueDelivery(tenantId, deliveryId, T0)).toBe(true);
    expect(await delivery()).toMatchObject({ id: deliveryId, status: "pending", attempts: 0, lastError: null });
    expect((await delivery()).nextAttemptAt).toEqual(T0);
  });

  it("test gönder: test:true yüklü lead.created, normal hattan imzalı gider", async () => {
    const id = await enqueueTestDelivery(tenantId, endpoint, T0);
    const { send, calls } = fakeSend();
    expect((await attemptDelivery(id, { now: T0, send })).outcome).toBe("succeeded");
    const body = JSON.parse(calls[0]!.body) as { test: boolean; event: string };
    expect(body).toMatchObject({ test: true, event: "lead.created" });
    expect(calls[0]!.headers["X-AtriCRM-Event"]).toBe("lead.created");
    expect(calls[0]!.headers["X-AtriCRM-Delivery"]).toBe(id);
  });

  it("temizlik: 30 günden eski giden teslim ve gelen günlük silinir, yenisi kalır", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    await dbAdmin.update(crmWebhookDeliveries).set({ createdAt: old });
    await createLead(tenantId, { name: "Yeni", phone: "05320000007" });
    const inbound = await addEndpoint(tenantId, { kind: "atricard_inbound", url: null, name: "Gelen" });
    await dbAdmin.insert(crmInboundEvents).values([
      { tenantId, integrationId: inbound, event: "lead.created", status: "processed", createdAt: old },
      { tenantId, integrationId: inbound, event: "lead.created", status: "processed" },
    ]);
    const result = await purgeOldWebhookData();
    expect(result).toEqual({ deliveries: 1, inbound: 1 });
    expect(await deliveries(tenantId)).toHaveLength(1);
    expect(await dbAdmin.select().from(crmInboundEvents)).toHaveLength(1);
  });
});
