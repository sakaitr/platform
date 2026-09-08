import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { companies, routeAssignments, routes, tenants, tripLogs, vehicles } from "@/db/schema";
import { canTransition, nextStatuses } from "@/modules/operasyon/transfer/state";
import { listAssignments } from "@/modules/operasyon/guzergah/queries";
import { tripLogSummary } from "@/modules/operasyon/cetele/queries";
import { resetDatabase } from "./setup";

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
      { tenantId, plate: "34ABC01", capacity: 27 },
      { tenantId, plate: "34XYZ02", capacity: 16 },
    ])
    .returning();
  const [route] = await dbAdmin
    .insert(routes)
    .values({ tenantId, companyId: firma!.id, name: "Gebze Hattı", capacity: 27 })
    .returning();
  return { tenantId, firma: firma!, v1: vs[0]!, v2: vs[1]!, route: route! };
}

describe("güzergah atama geçmişi", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı anda tek açık atama olur", async () => {
    const { tenantId, route, v1, v2 } = await seed();
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: route.id,
      vehicleId: v1.id,
      startsOn: "2026-09-01",
    });
    // İkinci atama açılırken ilki kapatılır (aksiyonun yaptığı işin şema karşılığı)
    await dbAdmin
      .update(routeAssignments)
      .set({ endsOn: "2026-09-07" })
      .where(and(eq(routeAssignments.routeId, route.id), isNull(routeAssignments.endsOn)));
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: route.id,
      vehicleId: v2.id,
      startsOn: "2026-09-08",
    });

    const open = await dbAdmin
      .select()
      .from(routeAssignments)
      .where(and(eq(routeAssignments.routeId, route.id), isNull(routeAssignments.endsOn)));
    expect(open).toHaveLength(1);
    expect(open[0]!.vehicleId).toBe(v2.id);
  });

  it("geçmiş en yeni tarih üstte listelenir", async () => {
    const { tenantId, route, v1, v2 } = await seed();
    await dbAdmin.insert(routeAssignments).values([
      { tenantId, routeId: route.id, vehicleId: v1.id, startsOn: "2026-09-01", endsOn: "2026-09-07" },
      { tenantId, routeId: route.id, vehicleId: v2.id, startsOn: "2026-09-08" },
    ]);
    const rows = await listAssignments(tenantId, route.id);
    expect(rows.map((r) => r.plate)).toEqual(["34XYZ02", "34ABC01"]);
    expect(rows[0]!.endsOn).toBeNull();
  });

  it("araç silinince atama da gider, güzergah kalır", async () => {
    const { tenantId, route, v1 } = await seed();
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: route.id,
      vehicleId: v1.id,
      startsOn: "2026-09-01",
    });
    await dbAdmin.delete(vehicles).where(eq(vehicles.id, v1.id));
    expect(await listAssignments(tenantId, route.id)).toHaveLength(0);
    const left = await dbAdmin.select().from(routes).where(eq(routes.tenantId, tenantId));
    expect(left).toHaveLength(1);
  });
});

describe("çetele", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı araç, gün ve hareket tipinde ikinci kayıt olamaz", async () => {
    const { tenantId, v1 } = await seed();
    const row = { tenantId, vehicleId: v1.id, logDate: "2026-09-08", tripType: "sabah" };
    await dbAdmin.insert(tripLogs).values(row);
    await expect(dbAdmin.insert(tripLogs).values(row)).rejects.toThrow();
  });

  it("özet durumlara göre sayar ve yolcuyu toplar", async () => {
    const { tenantId, v1, v2 } = await seed();
    await dbAdmin.insert(tripLogs).values([
      { tenantId, vehicleId: v1.id, logDate: "2026-09-08", tripType: "sabah", passengerCount: 20, status: "onaylandi" },
      { tenantId, vehicleId: v1.id, logDate: "2026-09-08", tripType: "aksam", passengerCount: 18 },
      { tenantId, vehicleId: v2.id, logDate: "2026-09-08", tripType: "sabah", passengerCount: 12, status: "iptal" },
    ]);
    const summary = await tripLogSummary(tenantId, {
      from: "2026-09-01",
      to: "2026-09-30",
      scope: null,
    });
    expect(summary.onaylandi).toBe(1);
    expect(summary.bekliyor).toBe(1);
    expect(summary.iptal).toBe(1);
    expect(summary.toplamYolcu).toBe(50);
  });

  it("tarih aralığı dışındaki kayıt sayılmaz", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(tripLogs).values([
      { tenantId, vehicleId: v1.id, logDate: "2026-08-31", tripType: "sabah", passengerCount: 10 },
      { tenantId, vehicleId: v1.id, logDate: "2026-09-08", tripType: "sabah", passengerCount: 20 },
    ]);
    const summary = await tripLogSummary(tenantId, { from: "2026-09-01", to: "2026-09-30", scope: null });
    expect(summary.toplamYolcu).toBe(20);
  });
});

describe("transfer durum makinesi", () => {
  it("geçerli geçişlere izin verir", () => {
    expect(canTransition("istek", "planlandi")).toBe(true);
    expect(canTransition("planlandi", "yolda")).toBe(true);
    expect(canTransition("yolda", "tamamlandi")).toBe(true);
  });

  it("sıçramayı ve geri dönüşü engeller", () => {
    expect(canTransition("istek", "tamamlandi")).toBe(false);
    expect(canTransition("tamamlandi", "yolda")).toBe(false);
    expect(canTransition("iptal", "planlandi")).toBe(false);
  });

  it("her durumdan iptal edilebilir, bitmişler hariç", () => {
    expect(nextStatuses("istek")).toContain("iptal");
    expect(nextStatuses("yolda")).toContain("iptal");
    expect(nextStatuses("tamamlandi")).toHaveLength(0);
  });
});
