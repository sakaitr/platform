import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, terminologyOverrides } from "@/db/schema";
import { getTerms, SYSTEM_TERMS } from "@/lib/sector/terminology";
import { resetDatabase } from "./setup";

async function seedTenant() {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "pilates", sectorPackVersion: "1.0.0" })
    .returning();
  return t!;
}

describe("terminoloji", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("sistem varsayılanını döner", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, {});
    expect(terms.t("customer")).toBe(SYSTEM_TERMS["customer"]);
  });

  it("paket varsayılanı sistemi ezer", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, { customer: "Üye" });
    expect(terms.t("customer")).toBe("Üye");
  });

  it("kiracı ezmesi paketi ezer", async () => {
    const tenant = await seedTenant();
    await dbAdmin
      .insert(terminologyOverrides)
      .values({ tenantId: tenant.id, termKey: "customer", value: "Sporcu" });
    const terms = await getTerms(tenant.id, { customer: "Üye" });
    expect(terms.t("customer")).toBe("Sporcu");
  });

  it("tanımsız anahtar için anahtarın kendisini döner", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, {});
    expect(terms.t("bilinmeyen_anahtar")).toBe("bilinmeyen_anahtar");
  });
});
