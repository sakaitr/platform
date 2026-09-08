import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { companies, drivers, tenants, vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { resetDatabase } from "./setup";

async function seed() {
  const [a] = await dbAdmin
    .insert(tenants)
    .values({ name: "A", slug: "a", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [b] = await dbAdmin
    .insert(tenants)
    .values({ name: "B", slug: "b", sectorPack: "lojistik", sectorPackVersion: "1.0.0" })
    .returning();
  return { a: a!, b: b! };
}

describe("ortak ana veri", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("firma/araç/sürücü kiracılar arasında sızmaz", async () => {
    const { a, b } = await seed();
    const [ca] = await dbAdmin.insert(companies).values({ tenantId: a.id, name: "A Lojistik" }).returning();
    await dbAdmin.insert(companies).values({ tenantId: b.id, name: "B Turizm" });
    await dbAdmin.insert(vehicles).values({ tenantId: a.id, companyId: ca!.id, plate: "34ABC01" });
    await dbAdmin.insert(vehicles).values({ tenantId: b.id, plate: "06XYZ99" });
    await dbAdmin.insert(drivers).values({ tenantId: a.id, fullName: "Ali Veli" });

    const seenCompanies = await withTenant(a.id, (tx) => tx.select().from(companies));
    const seenVehicles = await withTenant(a.id, (tx) => tx.select().from(vehicles));
    const seenDrivers = await withTenant(b.id, (tx) => tx.select().from(drivers));

    expect(seenCompanies.map((c) => c.name)).toEqual(["A Lojistik"]);
    expect(seenVehicles.map((v) => v.plate)).toEqual(["34ABC01"]);
    expect(seenDrivers).toHaveLength(0);
  });

  it("aynı plaka aynı kiracıda ikinci kez eklenemez", async () => {
    const { a } = await seed();
    await dbAdmin.insert(vehicles).values({ tenantId: a.id, plate: "34ABC01" });
    await expect(
      dbAdmin.insert(vehicles).values({ tenantId: a.id, plate: "34ABC01" }),
    ).rejects.toThrow();
  });

  it("aynı plaka farklı kiracıda serbesttir", async () => {
    const { a, b } = await seed();
    await dbAdmin.insert(vehicles).values({ tenantId: a.id, plate: "34ABC01" });
    await dbAdmin.insert(vehicles).values({ tenantId: b.id, plate: "34ABC01" });
    const rows = await dbAdmin.select().from(vehicles).where(eq(vehicles.plate, "34ABC01"));
    expect(rows).toHaveLength(2);
  });

  it("firma silinince aracın firma bağı boşalır, araç kalır", async () => {
    const { a } = await seed();
    const [c] = await dbAdmin.insert(companies).values({ tenantId: a.id, name: "X" }).returning();
    await dbAdmin.insert(vehicles).values({ tenantId: a.id, companyId: c!.id, plate: "34ABC01" });
    await dbAdmin.delete(companies).where(eq(companies.id, c!.id));
    const rows = await dbAdmin.select().from(vehicles).where(eq(vehicles.tenantId, a.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyId).toBeNull();
  });
});
