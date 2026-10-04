import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { companies, companyShifts, tenants, vehicleArrivals, vehicles } from "@/db/schema";
import {
  arrivalBoard,
  boardSummary,
  listShifts,
  matchByPlate,
  pickShift,
  type BoardRow,
} from "@/modules/operasyon/arrivals/board";
import { resetDatabase } from "./setup";

const DATE = "2026-09-08";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const [firma] = await dbAdmin.insert(companies).values({ tenantId, name: "Alfa" }).returning();
  const vs = await dbAdmin
    .insert(vehicles)
    .values([
      { tenantId, companyId: firma!.id, plate: "34ABC01", capacity: 27, sortOrder: 0 },
      { tenantId, companyId: firma!.id, plate: "34XYZ02", capacity: 16, sortOrder: 1 },
      { tenantId, companyId: firma!.id, plate: "06DEF01", capacity: 20, sortOrder: 2 },
      { tenantId, companyId: firma!.id, plate: "34PAS99", capacity: 10, status: "pasif" },
    ])
    .returning();
  await dbAdmin.insert(companyShifts).values({
    tenantId,
    companyId: firma!.id,
    name: "sabah",
    expectedAt: "08:00",
    toleranceLate: 10,
  });
  return { tenantId, firma: firma!, v1: vs[0]!, v2: vs[1]!, v3: vs[2]! };
}

describe("giriş kontrol tahtası", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("firmanın tüm aktif araçları listelenir, gelmeyenler de", async () => {
    const { tenantId, firma } = await seed();
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    expect(rows.map((r) => r.plate)).toEqual(["34ABC01", "34XYZ02", "06DEF01"]);
    expect(rows.every((r) => r.status === "bekliyor")).toBe(true);
  });

  it("pasif araç tahtaya girmez", async () => {
    const { tenantId, firma } = await seed();
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    expect(rows.some((r) => r.plate === "34PAS99")).toBe(false);
  });

  it("sıra numarasına göre sıralanır", async () => {
    const { tenantId, firma, v3 } = await seed();
    await dbAdmin.update(vehicles).set({ sortOrder: -1 }).where(
      // en öne al
      (await import("drizzle-orm")).eq(vehicles.id, v3.id),
    );
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    expect(rows[0]!.plate).toBe("06DEF01");
  });

  it("planlanan saat vardiyadan gelir, tolerans içinde zamanında sayılır", async () => {
    const { tenantId, firma, v1 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId,
      companyId: firma.id,
      vehicleId: v1.id,
      arrivalDate: DATE,
      shift: "sabah",
      arrivedAt: "08:08",
    });
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    const row = rows.find((r) => r.plate === "34ABC01")!;
    expect(row.plannedAt).toBe("08:00");
    expect(row.status).toBe("zamaninda");
    expect(row.delayMinutes).toBe(8);
  });

  it("toleransı aşan geliş gecikmeli sayılır", async () => {
    const { tenantId, firma, v1 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId,
      companyId: firma.id,
      vehicleId: v1.id,
      arrivalDate: DATE,
      shift: "sabah",
      arrivedAt: "08:25",
    });
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    const row = rows.find((r) => r.plate === "34ABC01")!;
    expect(row.status).toBe("gecikmeli");
    expect(row.delayMinutes).toBe(25);
  });

  it("erken gelen zamanında sayılır", async () => {
    const { tenantId, firma, v1 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId,
      companyId: firma.id,
      vehicleId: v1.id,
      arrivalDate: DATE,
      shift: "sabah",
      arrivedAt: "07:45",
    });
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    expect(rows.find((r) => r.plate === "34ABC01")!.status).toBe("zamaninda");
    expect(rows.find((r) => r.plate === "34ABC01")!.delayMinutes).toBe(-15);
  });

  it("başka vardiyanın kaydı bu vardiyaya sızmaz", async () => {
    const { tenantId, firma, v1 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId,
      companyId: firma.id,
      vehicleId: v1.id,
      arrivalDate: DATE,
      shift: "aksam",
      arrivedAt: "17:30",
    });
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    expect(rows.find((r) => r.plate === "34ABC01")!.arrivalId).toBeNull();
  });

  it("özet gelen/bekleyen/geciken sayar", async () => {
    const { tenantId, firma, v1, v2 } = await seed();
    await dbAdmin.insert(vehicleArrivals).values([
      { tenantId, companyId: firma.id, vehicleId: v1.id, arrivalDate: DATE, shift: "sabah", arrivedAt: "07:55" },
      { tenantId, companyId: firma.id, vehicleId: v2.id, arrivalDate: DATE, shift: "sabah", arrivedAt: "08:40" },
    ]);
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    const summary = boardSummary(rows);
    expect(summary).toEqual({ toplam: 3, gelen: 2, bekleyen: 1, geciken: 1 });
  });

  it("vardiya tanımsızsa gecikme hesaplanmaz", async () => {
    const { tenantId, firma, v1 } = await seed();
    await dbAdmin.delete(companyShifts);
    await dbAdmin.insert(vehicleArrivals).values({
      tenantId,
      companyId: firma.id,
      vehicleId: v1.id,
      arrivalDate: DATE,
      shift: "sabah",
      arrivedAt: "09:30",
    });
    const rows = await arrivalBoard(tenantId, { companyId: firma.id, date: DATE, shift: "sabah" });
    const row = rows.find((r) => r.plate === "34ABC01")!;
    expect(row.status).toBe("zamaninda");
    expect(row.delayMinutes).toBeNull();
  });

  it("vardiyalar saate göre listelenir", async () => {
    const { tenantId, firma } = await seed();
    await dbAdmin.insert(companyShifts).values({
      tenantId,
      companyId: firma.id,
      name: "aksam",
      expectedAt: "17:00",
    });
    const shifts = await listShifts(tenantId, firma.id);
    expect(shifts.map((s) => s.name)).toEqual(["sabah", "aksam"]);
  });
});

const SHIFTS = [
  { id: "1", name: "sabah", expectedAt: "08:00", toleranceEarly: 15, toleranceLate: 10 },
  { id: "2", name: "aksam", expectedAt: "17:00", toleranceEarly: 15, toleranceLate: 10 },
];

describe("vardiya otomatik seçimi", () => {
  it("saate en yakın vardiyayı seçer", () => {
    expect(pickShift(SHIFTS, 7 * 60 + 40)).toBe("sabah");
    expect(pickShift(SHIFTS, 16 * 60 + 30)).toBe("aksam");
  });

  it("üç saatten uzaksa ilk vardiyaya düşer", () => {
    // 12:30 — ikisine de 3 saatten uzak
    expect(pickShift(SHIFTS, 12 * 60 + 30)).toBe("sabah");
  });

  it("vardiya yoksa null döner", () => {
    expect(pickShift([], 480)).toBeNull();
  });
});

describe("plaka eşleştirme", () => {
  const rows = [
    { plate: "34ABC01" },
    { plate: "34XYZ02" },
    { plate: "06DEF01" },
  ] as BoardRow[];

  it("son ekle eşleşir", () => {
    expect(matchByPlate(rows, "02").map((r) => r.plate)).toEqual(["34XYZ02"]);
  });

  it("birden çok araç aynı son eke sahipse hepsi döner", () => {
    expect(matchByPlate(rows, "01").map((r) => r.plate)).toEqual(["34ABC01", "06DEF01"]);
  });

  it("boşluk ve tire yok sayılır, küçük harf çalışır", () => {
    expect(matchByPlate(rows, "34 abc 01").map((r) => r.plate)).toEqual(["34ABC01"]);
  });

  it("boş sorgu hiçbir şey döndürmez", () => {
    expect(matchByPlate(rows, "")).toEqual([]);
    expect(matchByPlate(rows, "  ")).toEqual([]);
  });

  it("eşleşme yoksa boş döner", () => {
    expect(matchByPlate(rows, "99")).toEqual([]);
  });
});
