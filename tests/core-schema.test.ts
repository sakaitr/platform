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

describe("firma detayı", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("sorumlular, vardiyalar, araçlar ve girişler birlikte gelir", async () => {
    const { a } = await seed();
    const { companyDetail } = await import("@/modules/crm/queries");
    const { companyResponsibles, companyShifts, users, vehicleArrivals } = await import("@/db/schema");

    const [firma] = await dbAdmin.insert(companies).values({ tenantId: a.id, name: "Alfa" }).returning();
    const [user] = await dbAdmin
      .insert(users)
      .values({ tenantId: a.id, email: "s@x.com", name: "Sorumlu Kişi", passwordHash: "x" })
      .returning();
    await dbAdmin
      .insert(companyResponsibles)
      .values({ tenantId: a.id, companyId: firma!.id, userId: user!.id });
    await dbAdmin
      .insert(companyShifts)
      .values({ tenantId: a.id, companyId: firma!.id, name: "sabah", expectedAt: "08:00" });
    const [arac] = await dbAdmin
      .insert(vehicles)
      .values({ tenantId: a.id, companyId: firma!.id, plate: "34ABC01" })
      .returning();
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId: a.id,
      companyId: firma!.id,
      vehicleId: arac!.id,
      arrivalDate: "2026-09-08",
      shift: "sabah",
      arrivedAt: "07:55",
    });

    const detail = await companyDetail(a.id, firma!.id, "2026-08-09");
    expect(detail?.responsibles.map((r) => r.name)).toEqual(["Sorumlu Kişi"]);
    expect(detail?.shifts).toHaveLength(1);
    expect(detail?.fleet.map((v) => v.plate)).toEqual(["34ABC01"]);
    expect(detail?.recentArrivals).toHaveLength(1);
    expect(detail?.monthlyArrivals).toBe(1);
  });

  it("aynı kişi firmaya iki kez sorumlu atanamaz", async () => {
    const { a } = await seed();
    const { companyResponsibles, users } = await import("@/db/schema");
    const [firma] = await dbAdmin.insert(companies).values({ tenantId: a.id, name: "Alfa" }).returning();
    const [user] = await dbAdmin
      .insert(users)
      .values({ tenantId: a.id, email: "s@x.com", name: "Kişi", passwordHash: "x" })
      .returning();

    await dbAdmin
      .insert(companyResponsibles)
      .values({ tenantId: a.id, companyId: firma!.id, userId: user!.id });
    await expect(
      dbAdmin
        .insert(companyResponsibles)
        .values({ tenantId: a.id, companyId: firma!.id, userId: user!.id }),
    ).rejects.toThrow();
  });

  it("30 gün dışındaki giriş sayıma girmez", async () => {
    const { a } = await seed();
    const { companyDetail } = await import("@/modules/crm/queries");
    const { vehicleArrivals } = await import("@/db/schema");
    const [firma] = await dbAdmin.insert(companies).values({ tenantId: a.id, name: "Alfa" }).returning();
    const [arac] = await dbAdmin
      .insert(vehicles)
      .values({ tenantId: a.id, companyId: firma!.id, plate: "34ABC01" })
      .returning();

    await dbAdmin.insert(vehicleArrivals).values([
      { tenantId: a.id, companyId: firma!.id, vehicleId: arac!.id, arrivalDate: "2026-09-08", shift: "sabah", arrivedAt: "08:00" },
      { tenantId: a.id, companyId: firma!.id, vehicleId: arac!.id, arrivalDate: "2026-06-01", shift: "sabah", arrivedAt: "08:00" },
    ]);

    const detail = await companyDetail(a.id, firma!.id, "2026-08-09");
    expect(detail?.monthlyArrivals).toBe(1);
    expect(detail?.recentArrivals).toHaveLength(2);
  });

  it("olmayan firma için null döner", async () => {
    const { a } = await seed();
    const { companyDetail } = await import("@/modules/crm/queries");
    expect(
      await companyDetail(a.id, "00000000-0000-4000-8000-000000000000", "2026-01-01"),
    ).toBeNull();
  });
});
