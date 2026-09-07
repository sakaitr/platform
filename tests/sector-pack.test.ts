import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  entityFields,
  numberingSequences,
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
} from "@/db/schema";
import { applySectorPack, getPack, SECTOR_PACKS } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";
import { resetDatabase } from "./setup";

async function seedTenant(pack: string) {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: `t-${pack}`, sectorPack: pack, sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
  return t!;
}

describe("sektör paketi", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("tanımlı tüm paketler benzersiz anahtara ve içeriğe sahip", () => {
    const keys = Object.keys(SECTOR_PACKS);
    expect(keys).toContain("turizm");
    expect(keys).toContain("lojistik");
    expect(keys).toContain("pilates");
    expect(keys).toContain("oto_servis");
    for (const key of keys) {
      const pack = getPack(key);
      expect(pack.key).toBe(key);
      expect(pack.modules.length).toBeGreaterThan(0);
    }
  });

  it("lojistik paketi irsaliye yeteneğini açar, turizm açmaz", async () => {
    const loj = await seedTenant("lojistik");
    await applySectorPack(loj.id, "lojistik");
    const lojCaps = await dbAdmin
      .select()
      .from(tenantCapabilities)
      .where(eq(tenantCapabilities.tenantId, loj.id));
    expect(lojCaps.map((c) => c.capabilityKey)).toContain("muhasebe.irsaliye");

    const tur = await seedTenant("turizm");
    await applySectorPack(tur.id, "turizm");
    const turCaps = await dbAdmin
      .select()
      .from(tenantCapabilities)
      .where(eq(tenantCapabilities.tenantId, tur.id));
    expect(turCaps.map((c) => c.capabilityKey)).not.toContain("muhasebe.irsaliye");
    expect(turCaps.map((c) => c.capabilityKey)).toContain("muhasebe.hakedis");
  });

  it("lojistik paketi irsaliye özel alanlarını kurar", async () => {
    const tenant = await seedTenant("lojistik");
    await applySectorPack(tenant.id, "lojistik");
    const fields = await dbAdmin
      .select()
      .from(entityFields)
      .where(eq(entityFields.tenantId, tenant.id));
    expect(fields.map((f) => f.fieldKey)).toContain("irsaliye_no");
  });

  it("pilates paketi terminolojiyi değiştirir", async () => {
    const tenant = await seedTenant("pilates");
    await applySectorPack(tenant.id, "pilates");
    const terms = await getTerms(tenant.id, getPack("pilates").terminology);
    expect(terms.t("customer")).toBe("Üye");
    expect(terms.t("appointment")).toBe("Ders");
    expect(terms.t("staff")).toBe("Eğitmen");
  });

  it("oto servis paketi aynı çekirdeği farklı terimlerle kurar", async () => {
    const tenant = await seedTenant("oto_servis");
    await applySectorPack(tenant.id, "oto_servis");
    const terms = await getTerms(tenant.id, getPack("oto_servis").terminology);
    expect(terms.t("customer")).toBe("Araç Sahibi");
    expect(terms.t("appointment")).toBe("Servis Randevusu");
    expect(terms.t("staff")).toBe("Usta");
  });

  it("modülleri ve numaralandırma dizilerini kurar", async () => {
    const tenant = await seedTenant("turizm");
    await applySectorPack(tenant.id, "turizm");
    const mods = await dbAdmin
      .select()
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, tenant.id));
    expect(mods.map((m) => m.moduleKey)).toContain("muhasebe");
    const seqs = await dbAdmin
      .select()
      .from(numberingSequences)
      .where(eq(numberingSequences.tenantId, tenant.id));
    expect(seqs.map((s) => s.sequenceKey)).toContain("fatura");
  });

  it("iki kez uygulanınca kayıt çoğaltmaz (idempotent)", async () => {
    const tenant = await seedTenant("lojistik");
    await applySectorPack(tenant.id, "lojistik");
    await applySectorPack(tenant.id, "lojistik");
    const fields = await dbAdmin
      .select()
      .from(entityFields)
      .where(eq(entityFields.tenantId, tenant.id));
    const keys = fields.map((f) => `${f.entityKey}.${f.fieldKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
