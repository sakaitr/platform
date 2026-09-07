import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants } from "@/db/schema";
import { runLicenseExpiryCheck } from "../worker/jobs/license-expiry";
import { resetDatabase } from "./setup";

async function seedTenant(slug: string, periodEnd: Date, status: "active" | "trial" = "active") {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  await dbAdmin
    .insert(subscriptions)
    .values({ tenantId: t!.id, status, currentPeriodEnd: periodEnd, graceDays: "7" });
  return t!;
}

describe("lisans süre kontrolü", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("grace süresi biten aboneliği expired yapar", async () => {
    const tenant = await seedTenant("bitmis", new Date(Date.now() - 30 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.expired).toBe(1);

    const [sub] = await dbAdmin
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id));
    expect(sub!.status).toBe("expired");
  });

  it("dönemi devam eden aboneliğe dokunmaz", async () => {
    const tenant = await seedTenant("aktif", new Date(Date.now() + 20 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.expired).toBe(0);

    const [sub] = await dbAdmin
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id));
    expect(sub!.status).toBe("active");
  });

  it("yaklaşan bitişleri uyarı olarak sayar", async () => {
    await seedTenant("yaklasan", new Date(Date.now() + 5 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.warned).toBe(1);
  });
});
