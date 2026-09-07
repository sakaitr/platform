import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenantCapabilities, tenantModules, tenants } from "@/db/schema";
import { getTenantAccess } from "@/lib/licensing";
import { MODULE_KEYS } from "@/lib/modules/keys";
import { buildNavigation, MODULE_REGISTRY } from "@/lib/modules/registry";
import { resetDatabase } from "./setup";

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

let slugCounter = 0;

async function seed(opts: { subEnd: Date; moduleEnds?: Date | null; graceDays?: string }) {
  slugCounter += 1;
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: `t${slugCounter}`, sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin.insert(subscriptions).values({
    tenantId: t!.id,
    status: "active",
    currentPeriodEnd: opts.subEnd,
    graceDays: opts.graceDays ?? "7",
  });
  await dbAdmin.insert(tenantModules).values({
    tenantId: t!.id,
    moduleKey: "muhasebe",
    status: "active",
    endsAt: opts.moduleEnds ?? null,
  });
  await dbAdmin
    .insert(tenantCapabilities)
    .values({ tenantId: t!.id, capabilityKey: "muhasebe.irsaliye", enabled: true });
  return t!;
}

describe("lisans durum makinesi", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("dönem içindeyse erişim açık", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("active");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: true });
  });

  it("dönem bitti ama grace içinde — erişim açık, uyarı var", async () => {
    const tenant = await seed({ subEnd: daysFromNow(-3), graceDays: "7" });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("grace");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: true, warning: "grace" });
  });

  it("grace bitti — erişim kapalı", async () => {
    const tenant = await seed({ subEnd: daysFromNow(-30), graceDays: "7" });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("locked");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("modüle özel süre dolduysa sadece o modül kapanır", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20), moduleEnds: daysFromNow(-1) });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("active");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("lisanssız modül not_licensed döner", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.modules.get("filo")).toMatchObject({ allowed: false, reason: "not_licensed" });
  });

  it("alt-yetenekleri okur", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.capabilities.has("muhasebe.irsaliye")).toBe(true);
  });

  it("navigasyon lisans ve izne göre süzülür", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    const keys = buildNavigation("owner", access).map((m) => m.key);
    expect(keys).toContain("muhasebe");
    expect(keys).not.toContain("filo");
  });
});

describe("kayıt defteri senkronu", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("licensing.ts tüm registry modüllerini kapsar", async () => {
    const tenant = await seed({ subEnd: daysFromNow(10) });
    const access = await getTenantAccess(tenant.id);
    for (const module of MODULE_REGISTRY) {
      expect(access.modules.has(module.key)).toBe(true);
    }
  });

  it("MODULE_KEYS ile MODULE_REGISTRY birebir aynı", () => {
    expect([...MODULE_KEYS].sort()).toEqual(MODULE_REGISTRY.map((m) => m.key).sort());
  });
});
