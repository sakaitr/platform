import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  dailyEntries,
  passengers,
  tenants,
  vehicleArrivals,
  vehicles,
  visitorLogs,
  users,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { delayMinutes, listArrivals, shiftsOnDate } from "@/modules/operasyon/arrivals/queries";
import { listPassengers } from "@/modules/operasyon/yolcular/queries";
import { listVisitors } from "@/modules/operasyon/ziyaretci/queries";
import { resetDatabase } from "./setup";

const TODAY = "2026-09-08";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;

  const inserted = await dbAdmin
    .insert(companies)
    .values([
      { tenantId, name: "Alfa Sanayi" },
      { tenantId, name: "Beta Tekstil" },
    ])
    .returning();
  const [alfa, beta] = inserted;

  const vs = await dbAdmin
    .insert(vehicles)
    .values([
      { tenantId, companyId: alfa!.id, plate: "34ABC01", capacity: 27 },
      { tenantId, companyId: beta!.id, plate: "34XYZ02", capacity: 16 },
    ])
    .returning();

  return { tenantId, alfa: alfa!, beta: beta!, v1: vs[0]!, v2: vs[1]! };
}

describe("giriş kontrol", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı araç, gün ve vardiyada ikinci kayıt açılamaz", async () => {
    const { tenantId, v1 } = await seed();
    const row = { tenantId, vehicleId: v1.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "07:55" };
    await dbAdmin.insert(vehicleArrivals).values(row);
    await expect(dbAdmin.insert(vehicleArrivals).values(row)).rejects.toThrow();
  });

  it("aynı araç farklı vardiyada tekrar kaydedilebilir", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values([
      { tenantId, vehicleId: v1.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "07:55" },
      { tenantId, vehicleId: v1.id, arrivalDate: TODAY, shift: "akşam", arrivedAt: "17:40" },
    ]);
    expect(await shiftsOnDate(tenantId, TODAY)).toEqual(["akşam", "sabah"]);
  });

  it("liste geliş saatine göre sıralanır ve firma adını getirir", async () => {
    const { tenantId, alfa, beta, v1, v2 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values([
      { tenantId, companyId: beta.id, vehicleId: v2.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "08:10" },
      { tenantId, companyId: alfa.id, vehicleId: v1.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "07:55" },
    ]);
    const rows = await listArrivals(tenantId, { date: TODAY, scope: null });
    expect(rows.map((r) => r.plate)).toEqual(["34ABC01", "34XYZ02"]);
    expect(rows[0]!.companyName).toBe("Alfa Sanayi");
  });

  it("kapsamlı kullanıcı yalnız kendi firmasının gelişini görür", async () => {
    const { tenantId, alfa, beta, v1, v2 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values([
      { tenantId, companyId: alfa.id, vehicleId: v1.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "07:55" },
      { tenantId, companyId: beta.id, vehicleId: v2.id, arrivalDate: TODAY, shift: "sabah", arrivedAt: "08:10" },
    ]);
    const rows = await listArrivals(tenantId, { date: TODAY, scope: [alfa.id] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyName).toBe("Alfa Sanayi");
  });

  it("gecikme planlanan saate göre hesaplanır", () => {
    expect(delayMinutes("08:00", "08:12")).toBe(12);
    expect(delayMinutes("08:00", "07:50")).toBe(-10);
    expect(delayMinutes(null, "08:12")).toBeNull();
  });
});

describe("yolcular", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("barkod kiracı içinde tekildir", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values({ tenantId, fullName: "Ali Veli", barcode: "B1" });
    await expect(
      dbAdmin.insert(passengers).values({ tenantId, fullName: "Ayşe Can", barcode: "B1" }),
    ).rejects.toThrow();
  });

  it("barkodsuz birden fazla yolcu eklenebilir", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, fullName: "Ali Veli" },
      { tenantId, fullName: "Ayşe Can" },
    ]);
    const { total } = await listPassengers(tenantId, { scope: null });
    expect(total).toBe(2);
  });

  it("arama ad ve telefonda çalışır", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, fullName: "Ali Veli", phone: "5551112233" },
      { tenantId, fullName: "Ayşe Can", phone: "5559998877" },
    ]);
    const byName = await listPassengers(tenantId, { scope: null, q: "Ayşe" });
    const byPhone = await listPassengers(tenantId, { scope: null, q: "1112233" });
    expect(byName.rows.map((r) => r.fullName)).toEqual(["Ayşe Can"]);
    expect(byPhone.rows.map((r) => r.fullName)).toEqual(["Ali Veli"]);
  });

  it("kapsamlı kullanıcı firmasız yolcuları da görür, başkasının firmasını görmez", async () => {
    const { tenantId, alfa, beta } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, companyId: alfa.id, fullName: "Alfa Yolcu" },
      { tenantId, companyId: beta.id, fullName: "Beta Yolcu" },
      { tenantId, fullName: "Firmasız Yolcu" },
    ]);
    const { rows } = await listPassengers(tenantId, { scope: [alfa.id] });
    expect(rows.map((r) => r.fullName).sort()).toEqual(["Alfa Yolcu", "Firmasız Yolcu"]);
  });
});

describe("ziyaretçi kayıt", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("içerideki ziyaretçi gün fark etmeksizin listede kalır", async () => {
    const { tenantId } = await seed();
    const dunEntry = new Date("2026-09-01T09:00:00+03:00");
    await dbAdmin.insert(visitorLogs).values({
      tenantId,
      visitorName: "Eski Ziyaretçi",
      reason: "Toplantı",
      hostName: "Kayra",
      enteredAt: dunEntry,
    });
    const rows = await listVisitors(tenantId, TODAY);
    expect(rows.map((r) => r.visitorName)).toEqual(["Eski Ziyaretçi"]);
  });

  it("çıkışı verilmiş eski ziyaretçi bugünün listesine düşmez", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(visitorLogs).values({
      tenantId,
      visitorName: "Eski Ziyaretçi",
      reason: "Toplantı",
      hostName: "Kayra",
      enteredAt: new Date("2026-09-01T09:00:00+03:00"),
      exitedAt: new Date("2026-09-01T10:00:00+03:00"),
    });
    expect(await listVisitors(tenantId, TODAY)).toHaveLength(0);
  });
});

describe("günlük check-in", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı kullanıcı aynı gün iki kayıt açamaz", async () => {
    const { tenantId } = await seed();
    const [user] = await dbAdmin
      .insert(users)
      .values({ tenantId, email: "a@x.com", name: "A", passwordHash: "x" })
      .returning();
    const row = { tenantId, userId: user!.id, entryDate: TODAY, answers: {} };
    await dbAdmin.insert(dailyEntries).values(row);
    await expect(dbAdmin.insert(dailyEntries).values(row)).rejects.toThrow();
  });

  it("cevaplar jsonb olarak korunur", async () => {
    const { tenantId } = await seed();
    const [user] = await dbAdmin
      .insert(users)
      .values({ tenantId, email: "a@x.com", name: "A", passwordHash: "x" })
      .returning();
    await dbAdmin.insert(dailyEntries).values({
      tenantId,
      userId: user!.id,
      entryDate: TODAY,
      answers: { q1: "evet", q2: ["a", "b"] },
    });
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(dailyEntries).where(eq(dailyEntries.tenantId, tenantId)),
    );
    expect(rows[0]!.answers).toEqual({ q1: "evet", q2: ["a", "b"] });
  });
});
