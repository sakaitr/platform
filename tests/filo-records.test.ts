import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  fuelPurchases,
  tenants,
  vehicleInsurances,
  vehicleMaintenance,
  vehiclePenalties,
  vehicles,
} from "@/db/schema";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { listFiloRecords } from "@/modules/filo/records/queries";
import { FILO_RECORDS, listFiloRecords as listDefs } from "@/modules/filo/records/registry";
import { resetDatabase } from "./setup";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const inserted = await dbAdmin
    .insert(companies)
    .values([
      { tenantId, name: "Alfa" },
      { tenantId, name: "Beta" },
    ])
    .returning();
  const vs = await dbAdmin
    .insert(vehicles)
    .values([
      { tenantId, companyId: inserted[0]!.id, plate: "34ABC01" },
      { tenantId, companyId: inserted[1]!.id, plate: "34XYZ02" },
    ])
    .returning();
  return { tenantId, alfa: inserted[0]!, beta: inserted[1]!, v1: vs[0]!, v2: vs[1]! };
}

describe("filo kayıt defteri", () => {
  it("her kaydın izni katalogda tanımlı", () => {
    const all = new Set(ALL_PERMISSIONS);
    for (const def of Object.values(FILO_RECORDS)) {
      for (const action of ["read", "create", "update", "delete"]) {
        expect(all.has(`${def.permission}:${action}`), `${def.permission}:${action}`).toBe(true);
      }
    }
  });

  it("kayıt tipleri izne göre süzülür", () => {
    expect(listDefs(new Set(ALL_PERMISSIONS)).length).toBe(Object.keys(FILO_RECORDS).length);
    expect(listDefs(new Set(["bakim:read"])).map((d) => d.key)).toEqual(["bakim"]);
    expect(listDefs(new Set())).toHaveLength(0);
  });

  it("her kaydın alan tanımı araç seçimi içerir", () => {
    for (const def of Object.values(FILO_RECORDS)) {
      const fields = def.fields({ vehicles: [], drivers: [], companies: [], terms: (k) => k });
      expect(fields.some((f) => f.name === "vehicleId"), def.key).toBe(true);
    }
  });
});

describe("jenerik filo listeleme", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("bakım kaydını plakayla birlikte döner", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(vehicleMaintenance).values({
      tenantId,
      vehicleId: v1.id,
      type: "periyodik",
      maintenanceDate: "2026-09-01",
      kmAtService: 120000,
    });
    const { rows, total } = await listFiloRecords(tenantId, "bakim", { scope: null });
    expect(total).toBe(1);
    expect(rows[0]!.plate).toBe("34ABC01");
    expect(rows[0]!.kmAtService).toBe(120000);
  });

  it("kapsamlı kullanıcı başka firmanın aracının kaydını görmez", async () => {
    const { tenantId, alfa, v1, v2 } = await seed();
    await dbAdmin.insert(vehiclePenalties).values([
      { tenantId, vehicleId: v1.id, penaltyDate: "2026-09-01", amount: "500" },
      { tenantId, vehicleId: v2.id, penaltyDate: "2026-09-02", amount: "700" },
    ]);
    const { rows } = await listFiloRecords(tenantId, "cezalar", { scope: [alfa.id] });
    expect(rows.map((r) => r.plate)).toEqual(["34ABC01"]);
  });

  it("tarih aralığı süzgeci çalışır", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(vehicleInsurances).values([
      { tenantId, vehicleId: v1.id, policyNo: "P1", kind: "trafik", startsOn: "2026-01-01", endsOn: "2026-06-30" },
      { tenantId, vehicleId: v1.id, policyNo: "P2", kind: "kasko", startsOn: "2026-01-01", endsOn: "2027-01-01" },
    ]);
    const { rows } = await listFiloRecords(tenantId, "sigortalar", {
      scope: null,
      from: "2026-09-01",
      to: "2027-12-31",
    });
    expect(rows.map((r) => r.policyNo)).toEqual(["P2"]);
  });

  it("yakıt tüketimi km farkından hesaplanır", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(fuelPurchases).values({
      tenantId,
      vehicleId: v1.id,
      purchaseDate: "2026-09-01",
      liters: "60",
      previousKm: 100000,
      currentKm: 100500,
    });
    const { rows } = await listFiloRecords(tenantId, "yakit", { scope: null });
    // 60 L / 500 km → 12 L/100km
    expect(Number(rows[0]!.tuketim)).toBe(12);
  });

  it("km bilgisi eksikse tüketim boş döner", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(fuelPurchases).values({
      tenantId,
      vehicleId: v1.id,
      purchaseDate: "2026-09-01",
      liters: "60",
      currentKm: 100500,
    });
    const { rows } = await listFiloRecords(tenantId, "yakit", { scope: null });
    expect(rows[0]!.tuketim).toBeNull();
  });

  it("araç silinince alt kayıtları da silinir", async () => {
    const { tenantId, v1 } = await seed();
    await dbAdmin.insert(vehicleMaintenance).values({
      tenantId,
      vehicleId: v1.id,
      type: "periyodik",
      maintenanceDate: "2026-09-01",
    });
    await dbAdmin.delete(vehicles);
    const { total } = await listFiloRecords(tenantId, "bakim", { scope: null });
    expect(total).toBe(0);
  });
});
