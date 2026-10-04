import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  crmDeals,
  crmDeletedExternal,
  crmInboundEvents,
  crmIntegrations,
  crmLeads,
  crmStages,
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { encryptSecret } from "@/lib/secret-box";
import { applySectorPack } from "@/lib/sector/install";
import { secondsNow, signPayload } from "@/lib/webhook-signing";
import { handleAtricardWebhook, MAX_BODY_BYTES } from "@/modules/satis/inbound";
import { createDeal } from "@/modules/satis/deals";
import { resetDatabase } from "./setup";

const SECRET = "whsec_" + "cd".repeat(32);
const NOW = new Date("2026-10-04T10:15:00Z");

type World = { tenantId: string; integrationId: string };

async function seedWorld(slug = "t1", over: Partial<typeof crmIntegrations.$inferInsert> = {}): Promise<World> {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = t!.id;
  await dbAdmin.insert(subscriptions).values({ tenantId, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(tenantId, "satis_crm");
  const integrationId = randomUUID();
  await dbAdmin.insert(crmIntegrations).values({
    id: integrationId,
    tenantId,
    kind: "atricard_inbound",
    name: "Atricard",
    secretEnc: encryptSecret(SECRET, integrationId),
    enabled: true,
    ...over,
  });
  return { tenantId, integrationId };
}

const created = (over: Record<string, unknown> = {}, lead: Record<string, unknown> = {}) => ({
  event: "lead.created",
  version: 1,
  id: randomUUID(),
  occurred_at: "2026-10-04T10:15:00Z",
  lead: {
    name: "Deniz Yılmaz", company: "Mavi Tur", email: "deniz@example.com", phone: "+905320000000",
    message: "Teklif almak istiyoruz", service: "Web sitesi", origin: "FORM", status: "NEW", temperature: null, event_name: "Fuar 2026",
    ...lead,
  },
  owner: { name: "Fatma Kaya", email: "fatma@example.com", card: "https://atricard.com/fatma-kaya" },
  company: { name: "Arkın Studio" },
  consent: { photo: false },
  ...over,
});

type PostOptions = {
  deliveryId?: string | null;
  event?: string | null;
  timestamp?: string | null;
  signature?: string | null;
  signWith?: string;
  signBody?: string;
  integrationId?: string;
};

function post(world: World, body: unknown, opts: PostOptions = {}) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = opts.timestamp === undefined ? secondsNow(NOW) : opts.timestamp;
  const signature =
    opts.signature === undefined
      ? timestamp
        ? signPayload(opts.signWith ?? SECRET, timestamp, opts.signBody ?? rawBody)
        : null
      : opts.signature;
  const event = opts.event === undefined ? (typeof body === "object" && body && "event" in body ? String((body as { event: unknown }).event) : null) : opts.event;
  return handleAtricardWebhook({
    integrationId: opts.integrationId ?? world.integrationId,
    rawBody,
    event,
    deliveryId: opts.deliveryId === undefined ? randomUUID() : opts.deliveryId,
    timestamp,
    signature,
    now: NOW,
  });
}

const leads = (tenantId: string) => dbAdmin.select().from(crmLeads).where(eq(crmLeads.tenantId, tenantId));
const events = (tenantId: string) => dbAdmin.select().from(crmInboundEvents).where(eq(crmInboundEvents.tenantId, tenantId));

describe("gelen Atricard webhook'u: erişim", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("bilinmeyen, geçersiz biçimli ya da kapalı uç 404", async () => {
    expect((await post(w, created(), { integrationId: randomUUID() })).httpStatus).toBe(404);
    expect((await post(w, created(), { integrationId: "../etc/passwd" })).httpStatus).toBe(404);
    expect((await post(w, created(), { integrationId: "' OR 1=1 --" })).httpStatus).toBe(404);
    await dbAdmin.update(crmIntegrations).set({ enabled: false }).where(eq(crmIntegrations.id, w.integrationId));
    expect((await post(w, created())).httpStatus).toBe(404);
    expect(await leads(w.tenantId)).toHaveLength(0);
  });

  it("giden (webhook_outbound) uç kimliği gelen yolda kullanılamaz", async () => {
    await dbAdmin.update(crmIntegrations).set({ kind: "webhook_outbound", url: "https://x.example.test/" }).where(eq(crmIntegrations.id, w.integrationId));
    expect((await post(w, created())).httpStatus).toBe(404);
  });

  it("entegrasyon yeteneği, satış modülü ya da abonelik kapalıysa 404", async () => {
    await dbAdmin.delete(tenantCapabilities).where(and(eq(tenantCapabilities.tenantId, w.tenantId), eq(tenantCapabilities.capabilityKey, "satis.entegrasyon")));
    expect((await post(w, created())).httpStatus).toBe(404);
    await resetDatabase();
    w = await seedWorld();
    await dbAdmin.update(tenantModules).set({ status: "suspended" }).where(and(eq(tenantModules.tenantId, w.tenantId), eq(tenantModules.moduleKey, "satis")));
    expect((await post(w, created())).httpStatus).toBe(404);
    await resetDatabase();
    w = await seedWorld();
    await dbAdmin.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.tenantId, w.tenantId));
    expect((await post(w, created())).httpStatus).toBe(404);
    expect(await leads(w.tenantId)).toHaveLength(0);
  });

  it("anahtar çözülemezse (ana anahtar değişmiş) 401 değil 503", async () => {
    await dbAdmin
      .update(crmIntegrations)
      .set({ secretEnc: encryptSecret(SECRET, w.integrationId, "baska-ana-anahtar-0123456789-abcdefghijklmnop") })
      .where(eq(crmIntegrations.id, w.integrationId));
    const res = await post(w, created());
    expect(res).toEqual({ httpStatus: 503, body: { error: "secret_unreadable" } });
  });
});

describe("gelen Atricard webhook'u: imza ve gövde doğrulama", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("imza eksik ya da yanlışsa 401 ve hiçbir aday açılmaz", async () => {
    const body = created();
    const cases: [string, PostOptions][] = [
      ["imza yok", { signature: null }],
      ["zaman damgası yok", { timestamp: null }],
      ["yanlış anahtar", { signWith: "whsec_baska" }],
      ["değiştirilmiş gövde", { signBody: JSON.stringify({ ...body, id: "x" }) }],
      ["bozuk imza biçimi", { signature: "sha256=abc" }],
      ["önek yok", { signature: signPayload(SECRET, secondsNow(NOW), JSON.stringify(body)).slice(7) }],
    ];
    for (const [name, opts] of cases) {
      const res = await post(w, body, opts);
      expect(res.httpStatus, name).toBe(401);
    }
    expect(await leads(w.tenantId)).toHaveLength(0);
    const rejected = (await events(w.tenantId)).filter((e) => e.status === "rejected");
    expect(rejected).toHaveLength(cases.length);
  });

  it("5 dakikadan eski ya da gelecekteki zaman damgası 401 (tekrar saldırısı)", async () => {
    const body = created();
    for (const offset of [-301, -3600, 301, 86_400]) {
      const ts = String(Math.floor(NOW.getTime() / 1000) + offset);
      expect((await post(w, body, { timestamp: ts })).httpStatus, String(offset)).toBe(401);
    }
    const edge = String(Math.floor(NOW.getTime() / 1000) - 300);
    expect((await post(w, body, { timestamp: edge })).httpStatus).toBe(201);
  });

  it("imza JSON ayrıştırmadan ÖNCE denetlenir: geçersiz imzalı bozuk gövde 401, geçerli imzalı 400", async () => {
    expect((await post(w, "{bozuk", { signature: "sha256=00" })).httpStatus).toBe(401);
    expect((await post(w, "{bozuk", { event: "lead.created" })).body).toEqual({ error: "invalid_json" });
    expect((await post(w, "{bozuk", { event: "lead.created" })).httpStatus).toBe(400);
  });

  it("imza ham gövde üzerinden: boşluk/sıra farkı olan eşdeğer JSON başka imza ister", async () => {
    const body = created();
    const compact = JSON.stringify(body);
    const pretty = JSON.stringify(body, null, 2);
    expect((await post(w, pretty, { signBody: compact, event: "lead.created" })).httpStatus).toBe(401);
    expect((await post(w, pretty, { event: "lead.created" })).httpStatus).toBe(201);
  });

  it("geçersiz gövde 400: dizi, olay yok, başlık-gövde olay uyuşmazlığı, şema hataları", async () => {
    const bad: [string, unknown, PostOptions?][] = [
      ["dizi", [1, 2], { event: "lead.created" }],
      ["sayı", "5", { event: "lead.created" }],
      ["olay yok", { version: 1, id: "x" }, { event: "lead.created" }],
      ["olay sayı", { event: 5 }, { event: "lead.created" }],
      ["uyuşmazlık", created(), { event: "lead.deleted" }],
      ["lead yok", { event: "lead.created", version: 1, id: "x" }],
      ["ad yok", created({}, { name: undefined })],
      ["ad boş", created({}, { name: "  " })],
      ["sıcaklık geçersiz", created({}, { temperature: "BOILING" })],
      ["sürüm metin", created({ version: "1" })],
      ["kimlik yok", created({ id: undefined })],
      ["kimlik boş", created({ id: "" })],
      ["e-posta tip", created({}, { email: 5 })],
    ];
    for (const [name, body, opts] of bad) {
      const res = await post(w, body, opts ?? {});
      expect(res.httpStatus, name).toBe(400);
      expect(String(res.body.error), name).toMatch(/^(invalid_payload|invalid_json|event_mismatch)/);
    }
    expect(await leads(w.tenantId)).toHaveLength(0);
  });

  it("çok büyük gövde 413", async () => {
    const res = await post(w, JSON.stringify(created({}, { message: "x".repeat(MAX_BODY_BYTES) })), { event: "lead.created" });
    expect(res.httpStatus).toBe(413);
  });
});

describe("lead.created", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  it("201: alan eşlemesi, kaynak atricard, idempotency anahtarı, sahip e-posta eşleşmesi", async () => {
    const [owner] = await dbAdmin.insert(users).values({ tenantId: w.tenantId, email: "Fatma@Example.com", name: "Fatma Kaya", passwordHash: "x" }).returning();
    const deliveryId = randomUUID();
    const body = created({}, { temperature: "HOT" });
    const res = await post(w, body, { deliveryId });
    expect(res.httpStatus).toBe(201);
    expect(res.body).toMatchObject({ status: "created" });

    const [lead] = await leads(w.tenantId);
    expect(lead).toMatchObject({
      id: res.body.leadId, name: "Mavi Tur", contactName: "Deniz Yılmaz", phone: "+905320000000", email: "deniz@example.com",
      message: "Teklif almak istiyoruz", service: "Web sitesi", eventName: "Fuar 2026", source: "atricard", externalId: body.id,
      temperature: "hot", score: 80, status: "new", ownerUserId: owner!.id,
    });
    const [event] = await events(w.tenantId);
    expect(event).toMatchObject({ deliveryId, event: "lead.created", externalId: body.id, status: "processed", error: null });
  });

  it("sıcaklık puanı: WARM 50, COLD 20, yoksa alan doluluğundan", async () => {
    await post(w, created({}, { temperature: "WARM" }));
    await post(w, created({}, { temperature: "COLD", phone: "+905320000001", email: "b@x.co" }));
    await post(w, created({}, { temperature: null, phone: "+905320000002", email: "c@x.co", company: null }));
    const byPhone = Object.fromEntries((await leads(w.tenantId)).map((l) => [l.phone, l]));
    expect(byPhone["+905320000000"]).toMatchObject({ temperature: "warm", score: 50 });
    expect(byPhone["+905320000001"]).toMatchObject({ temperature: "cold", score: 20 });
    expect(byPhone["+905320000002"]).toMatchObject({ temperature: null, score: 45 });
  });

  it("şirket yoksa ad, aday adı olur; kişi adı yine yetkili", async () => {
    await post(w, created({}, { company: null }));
    expect((await leads(w.tenantId))[0]).toMatchObject({ name: "Deniz Yılmaz", contactName: "Deniz Yılmaz" });
  });

  it("sahip eşleşmezse (yok, pasif, başka kiracıda) sahipsiz kalır", async () => {
    await post(w, created({ owner: { name: "X", email: "yok@example.com", card: null } }, { phone: "+905320000010", email: "a@x.co" }));
    await dbAdmin.insert(users).values({ tenantId: w.tenantId, email: "pasif@example.com", name: "Pasif", passwordHash: "x", isActive: false });
    await post(w, created({ owner: { email: "pasif@example.com" } }, { phone: "+905320000011", email: "b@x.co" }));
    const other = await seedWorld("t2");
    await dbAdmin.insert(users).values({ tenantId: other.tenantId, email: "baska@example.com", name: "Başka", passwordHash: "x" });
    await post(w, created({ owner: { email: "baska@example.com" } }, { phone: "+905320000012", email: "c@x.co" }));
    await post(w, created({ owner: null }, { phone: "+905320000013", email: "d@x.co" }));
    const all = await leads(w.tenantId);
    expect(all).toHaveLength(4);
    expect(all.every((l) => l.ownerUserId === null)).toBe(true);
  });

  it("aynı lead id iki kez: ikincisi 200 duplicate, ikinci kayıt açılmaz", async () => {
    const body = created();
    const first = await post(w, body);
    const second = await post(w, body);
    expect(first.httpStatus).toBe(201);
    expect(second).toEqual({ httpStatus: 200, body: { status: "duplicate", leadId: first.body.leadId } });
    expect(await leads(w.tenantId)).toHaveLength(1);
  });

  it("aynı TESLİM kimliğinin tekrarı yeniden işlenmez (aday arada düzenlenmiş olsa bile)", async () => {
    const body = created();
    const deliveryId = randomUUID();
    const first = await post(w, body, { deliveryId });
    await dbAdmin.update(crmLeads).set({ name: "Elle düzenlendi" }).where(eq(crmLeads.id, first.body.leadId as string));
    const retry = await post(w, body, { deliveryId });
    expect(retry).toEqual({ httpStatus: 200, body: { status: "duplicate", leadId: first.body.leadId } });
    expect((await leads(w.tenantId))[0]!.name).toBe("Elle düzenlendi");
  });

  it("telefon ya da e-posta eşleşirse yeni kayıt açılmaz ve mevcut adaya external_id BAĞLANMAZ", async () => {
    await dbAdmin.insert(crmLeads).values({ tenantId: w.tenantId, name: "Elle Girilen", phone: "0532 000 00 00", phoneKey: "5320000000", email: "Deniz@Example.com", emailKey: "deniz@example.com", source: "manual" });
    const res = await post(w, created());
    expect(res.httpStatus).toBe(200);
    expect(res.body.status).toBe("duplicate");
    const [only] = await leads(w.tenantId);
    expect(only).toMatchObject({ source: "manual", externalId: null, name: "Elle Girilen" });

    // e-posta ile
    const res2 = await post(w, created({}, { phone: null, email: "deniz@example.com" }));
    expect(res2.httpStatus).toBe(200);
    expect(await leads(w.tenantId)).toHaveLength(1);
  });

  it("mezar taşındaki kimlik 200 ignored döner, aday doğmaz", async () => {
    const body = created();
    await dbAdmin.insert(crmDeletedExternal).values({ tenantId: w.tenantId, source: "atricard", externalId: body.id });
    const res = await post(w, body);
    expect(res).toEqual({ httpStatus: 200, body: { status: "ignored" } });
    expect(await leads(w.tenantId)).toHaveLength(0);
    expect((await events(w.tenantId))[0]).toMatchObject({ status: "ignored", error: "tombstone" });
  });

  it("bilinmeyen alanlar ve selfie/cihaz verisi yok sayılır, saklanmaz", async () => {
    const body = created({ device: { ip_hash: "abc", user_agent: "x" }, extra: 1 }, { selfie: "data:image/png;base64,AAAA", yeni_alan: true });
    const res = await post(w, body);
    expect(res.httpStatus).toBe(201);
    const [lead] = await leads(w.tenantId);
    expect(JSON.stringify(lead)).not.toMatch(/selfie|data:image|ip_hash|user_agent/);
  });

  it("desteklenmeyen sürüm 200 ignored", async () => {
    const res = await post(w, created({ version: 2 }));
    expect(res).toEqual({ httpStatus: 200, body: { status: "ignored", reason: "unsupported_version" } });
    expect(await leads(w.tenantId)).toHaveLength(0);
  });

  it("aday sınırı doluysa yeni aday açılmaz, 200 ignored lead_limit (gönderici tekrar denemesin)", async () => {
    await dbAdmin.update(tenantModules).set({ limits: { max_leads: 1 } }).where(and(eq(tenantModules.tenantId, w.tenantId), eq(tenantModules.moduleKey, "satis")));
    expect((await post(w, created())).httpStatus).toBe(201);
    const res = await post(w, created({}, { phone: "+905320000099", email: "z@x.co" }));
    expect(res).toEqual({ httpStatus: 200, body: { status: "ignored", reason: "lead_limit" } });
    expect(await leads(w.tenantId)).toHaveLength(1);
    expect((await events(w.tenantId)).some((e) => e.error === "lead_limit")).toBe(true);
  });

  it("kiracı kimliği uçtan gelir, istemciden değil: başka kiracıya aday yazılamaz", async () => {
    const other = await seedWorld("t2");
    const res = await post(w, created({ tenant_id: other.tenantId, tenantId: other.tenantId }));
    expect(res.httpStatus).toBe(201);
    expect(await leads(w.tenantId)).toHaveLength(1);
    expect(await leads(other.tenantId)).toHaveLength(0);
  });

  it("başka kiracının uç anahtarıyla imzalanan istek reddedilir", async () => {
    const other = await seedWorld("t2");
    await dbAdmin.update(crmIntegrations).set({ secretEnc: encryptSecret("whsec_" + "ee".repeat(32), other.integrationId) }).where(eq(crmIntegrations.id, other.integrationId));
    expect((await post(other, created())).httpStatus).toBe(401); // SECRET ile imzalı, B'nin anahtarı farklı
    expect(await leads(other.tenantId)).toHaveLength(0);
  });

  it("son kullanım zamanı güncellenir", async () => {
    await post(w, created());
    const [row] = await dbAdmin.select().from(crmIntegrations).where(eq(crmIntegrations.id, w.integrationId));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});

describe("lead.deleted ve sıra güvenliği", () => {
  let w: World;
  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  const deleted = (id: string, reason: string | undefined = "erasure_request") => ({
    event: "lead.deleted", version: 1, id, occurred_at: "2026-10-04T11:00:00Z", ...(reason ? { reason } : {}),
  });

  it("fırsatı olmayan aday silinir, mezar taşı yazılır, 200", async () => {
    const body = created();
    await post(w, body);
    const res = await post(w, deleted(body.id));
    expect(res).toEqual({ httpStatus: 200, body: { status: "processed", result: "deleted" } });
    expect(await leads(w.tenantId)).toHaveLength(0);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("fırsatlı aday anonimleşir (silinmez), mezar taşı yazılır", async () => {
    const body = created();
    const first = await post(w, body);
    await withTenant(w.tenantId, (tx) => createDeal(tx, w.tenantId, { title: "Mavi Tur: Web", leadId: first.body.leadId as string }));
    const res = await post(w, deleted(body.id, "owner_deleted"));
    expect(res.body).toEqual({ status: "processed", result: "anonymized" });
    const [lead] = await leads(w.tenantId);
    expect(lead).toMatchObject({ name: "Silinen kayıt", phone: null, email: null, contactName: null, message: null, eventName: null });
    const [deal] = await dbAdmin.select().from(crmDeals);
    expect(deal!.title).toBe("Silinen kayıt");
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("kayıt bulunmasa da 200 ve yalnız mezar taşı; sonradan gelen created doğurmaz", async () => {
    const id = randomUUID();
    const res = await post(w, deleted(id));
    expect(res).toEqual({ httpStatus: 200, body: { status: "processed", result: "not_found" } });
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
    const late = await post(w, created({ id }));
    expect(late).toEqual({ httpStatus: 200, body: { status: "ignored" } });
    expect(await leads(w.tenantId)).toHaveLength(0);
  });

  it("silme tekrar gelince (aynı ya da farklı teslim kimliği) zararsız 200", async () => {
    const body = created();
    await post(w, body);
    const d = deleted(body.id);
    const deliveryId = randomUUID();
    expect((await post(w, d, { deliveryId })).httpStatus).toBe(200);
    expect((await post(w, d, { deliveryId })).body).toEqual({ status: "duplicate" });
    expect((await post(w, d)).httpStatus).toBe(200);
    expect(await dbAdmin.select().from(crmDeletedExternal)).toHaveLength(1);
  });

  it("neden alanı yok ya da bilinmeyen değerde davranış: yok → 200, bilinmeyen → 400", async () => {
    const body = created();
    await post(w, body);
    expect((await post(w, deleted(body.id, undefined))).httpStatus).toBe(200);
    const res = await post(w, deleted(randomUUID(), "uydurma"));
    expect(res.httpStatus).toBe(400);
  });

  it("başka kaynaktan gelen (manuel) aday aynı kimlikle silinemez", async () => {
    const id = randomUUID();
    await dbAdmin.insert(crmLeads).values({ tenantId: w.tenantId, name: "Elle", source: "manual", externalId: id });
    await post(w, deleted(id));
    expect(await leads(w.tenantId)).toHaveLength(1);
  });

  it("başka kiracının adayı silinemez", async () => {
    const other = await seedWorld("t2");
    const body = created();
    await post(other, body);
    await post(w, deleted(body.id));
    expect(await leads(other.tenantId)).toHaveLength(1);
  });

  it("bilinmeyen olay tipi (geçerli imzayla) 200 ignored; imzasızsa 401", async () => {
    const future = { event: "message.created", version: 1, id: "m1", text: "selam" };
    expect(await post(w, future)).toEqual({ httpStatus: 200, body: { status: "ignored" } });
    expect((await post(w, future, { signature: null })).httpStatus).toBe(401);
    expect((await events(w.tenantId)).some((e) => e.error === "unknown_event" && e.status === "ignored")).toBe(true);
  });
});
