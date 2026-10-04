import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  routeAssignments,
  routes,
  tenants,
  tripLogs,
  vehicles,
} from "@/db/schema";
import { boardSummary, processable, tripBoard } from "@/modules/operasyon/cetele/board";
import { resetDatabase } from "./setup";

const DATE = "2026-09-08";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const [firma] = await dbAdmin.insert(companies).values({ tenantId, name: "Alfa" }).returning();
  const [arac] = await dbAdmin
    .insert(vehicles)
    .values({ tenantId, companyId: firma!.id, plate: "34ABC01" })
    .returning();
  return { tenantId, firma: firma!, arac: arac! };
}

describe("çetele tahtası", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("iki yönlü güzergah iki satır üretir", async () => {
    const { tenantId, firma } = await seed();
    await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "ikisi" });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board).toHaveLength(2);
    expect(board.map((e) => e.direction)).toEqual(["giris", "cikis"]);
  });

  it("tek yönlü güzergah tek satır üretir", async () => {
    const { tenantId, firma } = await seed();
    await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "gidis" });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board).toHaveLength(1);
    expect(board[0]!.direction).toBe("giris");
  });

  it("pasif güzergah tahtaya girmez", async () => {
    const { tenantId, firma } = await seed();
    await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Kapalı Hat", isActive: false });
    expect(await tripBoard(tenantId, { date: DATE, scope: null })).toHaveLength(0);
  });

  it("o gün geçerli atamanın aracını getirir", async () => {
    const { tenantId, firma, arac } = await seed();
    const [route] = await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "gidis" })
      .returning();
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: route!.id,
      vehicleId: arac.id,
      startsOn: "2026-09-01",
    });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board[0]!.plate).toBe("34ABC01");
  });

  it("kapanmış atama o güne araç vermez", async () => {
    const { tenantId, firma, arac } = await seed();
    const [route] = await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "gidis" })
      .returning();
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: route!.id,
      vehicleId: arac.id,
      startsOn: "2026-08-01",
      endsOn: "2026-09-01",
    });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board[0]!.plate).toBeNull();
  });

  it("işlenmiş satır durumuyla gelir", async () => {
    const { tenantId, firma, arac } = await seed();
    const [route] = await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "gidis" })
      .returning();
    await dbAdmin.insert(tripLogs).values({
      tenantId,
      vehicleId: arac.id,
      routeId: route!.id,
      logDate: DATE,
      tripType: "sabah",
      direction: "giris",
      status: "onaylandi",
    });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board[0]!.status).toBe("onaylandi");
    expect(board[0]!.tripLogId).not.toBeNull();
  });

  it("başka günün kaydı bu güne sızmaz", async () => {
    const { tenantId, firma, arac } = await seed();
    const [route] = await dbAdmin
      .insert(routes)
      .values({ tenantId, companyId: firma.id, name: "Hat 1", direction: "gidis" })
      .returning();
    await dbAdmin.insert(tripLogs).values({
      tenantId,
      vehicleId: arac.id,
      routeId: route!.id,
      logDate: "2026-09-07",
      tripType: "sabah",
      direction: "giris",
    });
    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    expect(board[0]!.status).toBe("islenmedi");
  });

  it("özet araçsız satırları ayrı sayar", async () => {
    const { tenantId, firma, arac } = await seed();
    const created = await dbAdmin
      .insert(routes)
      .values([
        { tenantId, companyId: firma.id, name: "Atanan", direction: "gidis" },
        { tenantId, companyId: firma.id, name: "Atanmayan", direction: "gidis" },
      ])
      .returning();
    await dbAdmin.insert(routeAssignments).values({
      tenantId,
      routeId: created[0]!.id,
      vehicleId: arac.id,
      startsOn: "2026-09-01",
    });

    const board = await tripBoard(tenantId, { date: DATE, scope: null });
    const summary = boardSummary(board);
    expect(summary.toplam).toBe(2);
    expect(summary.aracsiz).toBe(1);
    expect(summary.islenmedi).toBe(2);
    // Araçsız satır toplu açmaya girmez
    expect(processable(board)).toHaveLength(1);
  });

  it("kapsam dışı firmanın hattı görünmez", async () => {
    const { tenantId, firma } = await seed();
    const [diger] = await dbAdmin.insert(companies).values({ tenantId, name: "Beta" }).returning();
    await dbAdmin.insert(routes).values([
      { tenantId, companyId: firma.id, name: "Alfa Hat", direction: "gidis" },
      { tenantId, companyId: diger!.id, name: "Beta Hat", direction: "gidis" },
    ]);
    const board = await tripBoard(tenantId, { date: DATE, scope: [firma.id] });
    expect(board.map((e) => e.routeName)).toEqual(["Alfa Hat"]);
  });
});
