import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenantModules, tenants } from "@/db/schema";
import { resetDatabase } from "./setup";

describe("çekirdek şema", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kiracı oluşturur, slug benzersizdir", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "Aycan", slug: "aycan", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    expect(tenant!.sectorPack).toBe("turizm");

    await expect(
      dbAdmin
        .insert(tenants)
        .values({ name: "X", slug: "aycan", sectorPack: "lojistik", sectorPackVersion: "1.0.0" }),
    ).rejects.toThrow();
  });

  it("aynı kiracıya aynı modül iki kez eklenemez", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(tenantModules).values({ tenantId: tenant!.id, moduleKey: "muhasebe" });
    await expect(
      dbAdmin.insert(tenantModules).values({ tenantId: tenant!.id, moduleKey: "muhasebe" }),
    ).rejects.toThrow();
  });
});
