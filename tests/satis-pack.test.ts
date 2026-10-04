import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  crmStages,
  crmTemplates,
  numberingSequences,
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
} from "@/db/schema";
import { getTenantAccess } from "@/lib/licensing";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { listRolesWithCounts, getRolePermissions } from "@/lib/rbac";
import { applySectorPack, getPack, SECTOR_PACKS } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";
import { nextNumber } from "@/lib/numbering";
import { withTenant } from "@/db/tenant";
import { roles } from "@/db/schema";
import { buildNavigation, getModule, visibleChildren } from "@/lib/modules/registry";
import { resetDatabase } from "./setup";

async function seedSatisTenant(slug = "satis") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "satis_crm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin
    .insert(subscriptions)
    .values({ tenantId: t!.id, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
  await applySectorPack(t!.id, "satis_crm");
  return t!;
}

describe("satis_crm sektör paketi", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("paket tanımlı, doğru modülleri ve yetenekleri taşır; mevcut paketlere satis eklenmez", () => {
    const pack = getPack("satis_crm");
    expect([...pack.modules].sort()).toEqual(["admin", "crm", "dashboard", "raporlar", "satis"]);
    expect([...pack.capabilities].sort()).toEqual(["satis.entegrasyon", "satis.teklif"]);
    for (const key of ["turizm", "lojistik", "pilates", "oto_servis"]) {
      expect(SECTOR_PACKS[key]!.modules).not.toContain("satis");
    }
  });

  it("kurulum modülü, yetenekleri, teklif numarasını ve terimleri yazar", async () => {
    const t = await seedSatisTenant();
    const mods = await dbAdmin.select().from(tenantModules).where(eq(tenantModules.tenantId, t.id));
    expect(mods.map((m) => m.moduleKey)).toContain("satis");
    const caps = await dbAdmin
      .select()
      .from(tenantCapabilities)
      .where(eq(tenantCapabilities.tenantId, t.id));
    expect(caps.map((c) => c.capabilityKey).sort()).toEqual(["satis.entegrasyon", "satis.teklif"]);
    const seqs = await dbAdmin
      .select()
      .from(numberingSequences)
      .where(eq(numberingSequences.tenantId, t.id));
    expect(seqs.find((s) => s.sequenceKey === "teklif")).toMatchObject({ prefix: "TKL", padding: 5 });

    const terms = await getTerms(t.id, getPack("satis_crm").terminology);
    expect(terms.t("lead")).toBe("Aday");
    expect(terms.t("deal")).toBe("Fırsat");
  });

  it("varsayılan beş aşamayı ve iki şablonu kurar, tekrar uygulamada çoğaltmaz", async () => {
    const t = await seedSatisTenant();
    await applySectorPack(t.id, "satis_crm");
    const stages = await dbAdmin.select().from(crmStages).where(eq(crmStages.tenantId, t.id));
    expect(stages.sort((a, b) => a.position - b.position).map((s) => s.label)).toEqual([
      "Yeni",
      "Görüşüldü",
      "Teklif",
      "Kazanıldı",
      "Kaybedildi",
    ]);
    expect(stages.some((s) => s.kind === "won")).toBe(true);
    expect(stages.some((s) => s.kind === "lost")).toBe(true);
    const templates = await dbAdmin
      .select()
      .from(crmTemplates)
      .where(eq(crmTemplates.tenantId, t.id));
    expect(templates.map((x) => x.channel).sort()).toEqual(["email", "whatsapp"]);
  });

  it("üç satış rolü ve ortak roller kurulur", async () => {
    const t = await seedSatisTenant();
    const keys = (await listRolesWithCounts(t.id)).map((r) => r.key);
    for (const key of ["owner", "admin", "viewer", "satis_yonetici", "satisci", "satis_izleyici"]) {
      expect(keys).toContain(key);
    }
  });

  it("izinler: yönetici hepsini görür, satışçı görmez ve silemez, izleyici yalnız okur", async () => {
    const t = await seedSatisTenant();
    const all = await withTenant(t.id, (tx) => tx.select().from(roles));
    const permsOf = async (key: string) =>
      getRolePermissions(t.id, all.find((r) => r.key === key)!.id);

    const manager = await permsOf("satis_yonetici");
    for (const p of ALL_PERMISSIONS.filter((x) => x.startsWith("satis_"))) {
      expect(manager.has(p), p).toBe(true);
    }

    const rep = await permsOf("satisci");
    expect(rep.has("satis_aday:update")).toBe(true);
    expect(rep.has("satis_firsat:create")).toBe(true);
    expect(rep.has("satis_hepsi:read")).toBe(false);
    expect([...rep].filter((p) => p.startsWith("satis_") && p.endsWith(":delete"))).toEqual([]);
    expect(rep.has("satis_entegrasyon:update")).toBe(false);

    const viewer = await permsOf("satis_izleyici");
    const satisPerms = [...viewer].filter((p) => p.startsWith("satis_"));
    expect(satisPerms.length).toBeGreaterThan(0);
    expect(satisPerms.every((p) => p.endsWith(":read"))).toBe(true);
  });

  it("lisans: satis modülü yalnız paketi alan kiracıda açık", async () => {
    const t = await seedSatisTenant();
    const access = await getTenantAccess(t.id);
    expect(access.modules.get("satis")).toMatchObject({ allowed: true });
    expect(access.modules.get("filo")).toMatchObject({ allowed: false });

    const [other] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "turizm-t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin
      .insert(subscriptions)
      .values({ tenantId: other!.id, status: "active", currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    await applySectorPack(other!.id, "turizm");
    expect((await getTenantAccess(other!.id)).modules.get("satis")).toMatchObject({
      allowed: false,
      reason: "not_licensed",
    });
  });

  it("teklif numarası boşluksuz ve eşzamanlı çağrıda çakışmaz", async () => {
    const t = await seedSatisTenant();
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => withTenant(t.id, (tx) => nextNumber(tx, t.id, "teklif"))),
    );
    expect(new Set(numbers).size).toBe(8);
    const serials = numbers.map((n) => Number(n.slice(-5))).sort((a, b) => a - b);
    expect(serials).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(numbers[0]).toMatch(/^TKL\d{4}-\d{5}$/);
  });

  it("menü: satis modülü izne bağlı, Teklifler ve Entegrasyonlar yeteneğe bağlı", async () => {
    const t = await seedSatisTenant();
    const access = await getTenantAccess(t.id);
    const nav = buildNavigation({ ...access, permissions: new Set(["dashboard:read", "satis_aday:read"]) });
    expect(nav.map((m) => m.key)).toContain("satis");
    const noPerm = buildNavigation({ ...access, permissions: new Set(["dashboard:read"]) });
    expect(noPerm.map((m) => m.key)).not.toContain("satis");

    const satis = getModule("satis")!;
    expect(visibleChildren(satis, access).map((c) => c.label)).toEqual([
      "Adaylar", "Pipeline", "Görevler", "Teklifler", "Şablonlar", "Entegrasyonlar",
    ]);
    const stripped = { ...access, capabilities: new Set<string>() };
    expect(visibleChildren(satis, stripped).map((c) => c.label)).toEqual([
      "Adaylar", "Pipeline", "Görevler", "Şablonlar",
    ]);
    expect(satis.dependsOn).toContain("crm");
  });

  it("menü: izni olmayan kullanıcı o alt menüyü görmez (Satışçı'da Entegrasyonlar yok)", async () => {
    const t = await seedSatisTenant();
    const access = await getTenantAccess(t.id);
    const satis = getModule("satis")!;
    const rep = new Set(["satis_aday:read", "satis_firsat:read", "satis_aktivite:read", "satis_teklif:read", "satis_sablon:read"]);
    expect(visibleChildren(satis, access, rep).map((c) => c.label)).toEqual(["Adaylar", "Pipeline", "Görevler", "Teklifler", "Şablonlar"]);
    expect(visibleChildren(satis, access, new Set(["satis_aday:read"])).map((c) => c.label)).toEqual(["Adaylar"]);
    // izin kümesi verilmezse yalnız yetenek süzgeci çalışır (geriye uyumlu)
    expect(visibleChildren(satis, access).map((c) => c.label)).toHaveLength(6);
    // yetenek ve izin birlikte: izin var ama yetenek yok
    const stripped = { ...access, capabilities: new Set<string>() };
    expect(visibleChildren(satis, stripped, new Set([...rep, "satis_entegrasyon:read"])).map((c) => c.label)).toEqual(["Adaylar", "Pipeline", "Görevler", "Şablonlar"]);
  });
});
