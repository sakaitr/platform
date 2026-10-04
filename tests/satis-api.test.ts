import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmApiKeys, crmLeads, subscriptions, tenantCapabilities, tenants, users } from "@/db/schema";
import { generateApiKey } from "@/lib/api-keys";
import { applySectorPack } from "@/lib/sector/install";
import { authenticateApiRequest, getApiLead, listApiLeads, parseListParams } from "@/modules/satis/api";
import { resetDatabase } from "./setup";

async function seedTenant(slug = "t1") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(t!.id, "satis_crm");
  return t!.id;
}

async function addKey(tenantId: string, over: Partial<typeof crmApiKeys.$inferInsert> = {}) {
  const key = generateApiKey();
  await dbAdmin.insert(crmApiKeys).values({ tenantId, name: "Anahtar", prefix: key.prefix, keyHash: key.hash, scopes: ["leads:read"], ...over });
  return key;
}

describe("API kimlik doğrulama", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });

  const auth = (token: string | null, scope: "leads:read" = "leads:read") => authenticateApiRequest(token === null ? null : `Bearer ${token}`, scope);

  it("geçerli anahtar kabul edilir, son kullanım yazılır (dakikada en çok bir kez)", async () => {
    const key = await addKey(tenantId);
    const result = await auth(key.token);
    expect(result).toMatchObject({ ok: true, tenantId, scopes: ["leads:read"] });
    const [row] = await dbAdmin.select().from(crmApiKeys).where(eq(crmApiKeys.prefix, key.prefix));
    expect(row!.lastUsedAt).not.toBeNull();
    const first = row!.lastUsedAt!;
    await auth(key.token);
    const [again] = await dbAdmin.select().from(crmApiKeys).where(eq(crmApiKeys.prefix, key.prefix));
    expect(again!.lastUsedAt).toEqual(first);
  });

  it("anahtar yok, biçim bozuk, bilinmeyen önek, yanlış gizli ve iptal: hepsi aynı 401", async () => {
    const key = await addKey(tenantId);
    const revoked = await addKey(tenantId, { revokedAt: new Date() });
    const wrongSecret = `atc_${key.prefix}_${"0".repeat(64)}`;
    const unknownPrefix = `atc_${"f".repeat(8)}_${"1".repeat(64)}`;
    const cases = [
      await authenticateApiRequest(null, "leads:read"),
      await authenticateApiRequest("", "leads:read"),
      await authenticateApiRequest("Basic abc", "leads:read"),
      await auth("bozuk"),
      await auth(wrongSecret),
      await auth(unknownPrefix),
      await auth(revoked.token),
    ];
    for (const result of cases) expect(result).toEqual({ ok: false, status: 401, error: "invalid_api_key" });
  });

  it("anahtar başka kiracının verisine kapı açmaz: kiracı kimliği anahtardan gelir", async () => {
    const other = await seedTenant("t2");
    const key = await addKey(other);
    const result = await auth(key.token);
    expect(result).toMatchObject({ ok: true, tenantId: other });
  });

  it("entegrasyon yeteneği, satış modülü ya da abonelik kapalıysa 403", async () => {
    const key = await addKey(tenantId);
    await dbAdmin.delete(tenantCapabilities).where(and(eq(tenantCapabilities.tenantId, tenantId), eq(tenantCapabilities.capabilityKey, "satis.entegrasyon")));
    expect(await auth(key.token)).toEqual({ ok: false, status: 403, error: "forbidden" });

    await resetDatabase();
    tenantId = await seedTenant();
    const key2 = await addKey(tenantId);
    await dbAdmin.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.tenantId, tenantId));
    expect(await auth(key2.token)).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("kapsamı olmayan anahtar 403", async () => {
    const key = await addKey(tenantId, { scopes: [] });
    expect(await auth(key.token)).toEqual({ ok: false, status: 403, error: "insufficient_scope" });
  });
});

describe("API sayfalama ve süzgeç", () => {
  it("limit 1-100 (varsayılan 50), sayfa ≥ 1; sayı olmayan varsayılana düşer; geçersiz süzgeç hata", () => {
    expect(parseListParams({})).toMatchObject({ ok: true, limit: 50, page: 1 });
    expect(parseListParams({ limit: "10", page: "3" })).toMatchObject({ limit: 10, page: 3 });
    expect(parseListParams({ limit: "0" })).toMatchObject({ limit: 1 });
    expect(parseListParams({ limit: "5000" })).toMatchObject({ limit: 100 });
    expect(parseListParams({ limit: "-5", page: "-2" })).toMatchObject({ limit: 1, page: 1 });
    expect(parseListParams({ limit: "abc", page: "1.5" })).toMatchObject({ limit: 50, page: 1 });
    expect(parseListParams({ status: "new", source: "atricard" })).toMatchObject({ ok: true, status: "new", source: "atricard" });
    expect(parseListParams({ status: "uydurma" })).toEqual({ ok: false, error: "invalid_status" });
    expect(parseListParams({ source: "x" })).toEqual({ ok: false, error: "invalid_source" });
    expect(parseListParams({ status: "'; DROP TABLE crm_leads;--" })).toEqual({ ok: false, error: "invalid_status" });
  });
});

describe("API veri", () => {
  let tenantId: string;
  beforeEach(async () => {
    await resetDatabase();
    tenantId = await seedTenant();
  });
  const params = (over = {}) => ({ ok: true as const, limit: 50, page: 1, ...over });

  it("yalnız kendi kiracısının adayları; iç not ve dedup anahtarları dışarı çıkmaz", async () => {
    const other = await seedTenant("t2");
    const [owner] = await dbAdmin.insert(users).values({ tenantId, email: "o@x.co", name: "Sahip", passwordHash: "x" }).returning();
    await dbAdmin.insert(crmLeads).values([
      { tenantId, name: "Benim", note: "GİZLİ İÇ NOT", phone: "05320000000", phoneKey: "5320000000", nameKey: "benim|x", ownerUserId: owner!.id, source: "atricard", externalId: "e1", temperature: "hot", score: 80, estimatedValue: "1500.00" },
      { tenantId: other, name: "Başkasının" },
    ]);
    const result = await listApiLeads(tenantId, params());
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      name: "Benim", phone: "05320000000", origin: "atricard", temperature: "hot", score: 80, estimated_value: "1500.00",
      owner: { name: "Sahip", email: "o@x.co" },
    });
    const json = JSON.stringify(result);
    for (const leaked of ["GİZLİ İÇ NOT", "phoneKey", "phone_key", "nameKey", "name_key", "external_id", "externalId", "Başkasının", "note"]) {
      expect(json, leaked).not.toContain(leaked);
    }
  });

  it("sayfalama, sıralama (yeni önce), toplam ve süzgeçler", async () => {
    const now = Date.now();
    await dbAdmin.insert(crmLeads).values(
      Array.from({ length: 7 }, (_, i) => ({
        tenantId, name: `Aday ${i}`, status: i % 2 === 0 ? ("new" as const) : ("contacted" as const),
        source: i < 3 ? ("atricard" as const) : ("manual" as const), createdAt: new Date(now - i * 1000),
      })),
    );
    const p1 = await listApiLeads(tenantId, params({ limit: 3, page: 1 }));
    const p2 = await listApiLeads(tenantId, params({ limit: 3, page: 2 }));
    const p3 = await listApiLeads(tenantId, params({ limit: 3, page: 3 }));
    expect(p1.total).toBe(7);
    expect(p1.data.map((d) => d.name)).toEqual(["Aday 0", "Aday 1", "Aday 2"]);
    expect(p2.data.map((d) => d.name)).toEqual(["Aday 3", "Aday 4", "Aday 5"]);
    expect(p3.data.map((d) => d.name)).toEqual(["Aday 6"]);
    expect((await listApiLeads(tenantId, params({ status: "contacted" }))).total).toBe(3);
    expect((await listApiLeads(tenantId, params({ source: "atricard" }))).total).toBe(3);
    expect((await listApiLeads(tenantId, params({ source: "atricard", status: "contacted" }))).data.map((d) => d.name)).toEqual(["Aday 1"]);
    expect((await listApiLeads(tenantId, params({ page: 99 }))).data).toEqual([]);
  });

  it("tek aday: bulunur, başka kiracınınki ve geçersiz kimlik 404 (null)", async () => {
    const other = await seedTenant("t2");
    const [mine] = await dbAdmin.insert(crmLeads).values({ tenantId, name: "Benim" }).returning();
    const [theirs] = await dbAdmin.insert(crmLeads).values({ tenantId: other, name: "Onun" }).returning();
    expect((await getApiLead(tenantId, mine!.id))?.name).toBe("Benim");
    expect(await getApiLead(tenantId, theirs!.id)).toBeNull();
    expect(await getApiLead(tenantId, "../etc")).toBeNull();
    expect(await getApiLead(tenantId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
