import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  companies,
  earningTripLogs,
  earnings,
  financeCategories,
  financeTransactions,
  ledgerEntries,
  tenants,
  tripLogs,
  vehicleOperators,
  vehicles,
} from "@/db/schema";
import { applyRate, netFromGross } from "@/lib/money";
import { eligibleTripLogs, listBalances, profitAndLoss } from "@/modules/muhasebe/queries";
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
      { tenantId, name: "Alfa İşleten", type: "isleten" },
      { tenantId, name: "Beta Müşteri" },
    ])
    .returning();
  const [v1] = await dbAdmin
    .insert(vehicles)
    .values({ tenantId, plate: "34ABC01" })
    .returning();
  return { tenantId, isleten: inserted[0]!, musteri: inserted[1]!, v1: v1! };
}

describe("KDV'yi brütten ayırma", () => {
  it("brüt 1200, %20 KDV → net 1000", () => {
    expect(netFromGross("1200.00", "20")).toBe("1000.00");
  });

  it("brüt 100, %10 KDV → net 90.91", () => {
    expect(netFromGross("100.00", "10")).toBe("90.91");
  });

  it("KDV yoksa net brüte eşittir", () => {
    expect(netFromGross("1234.56", "0")).toBe("1234.56");
  });

  it("negatif tutarda işaret korunur", () => {
    expect(netFromGross("-1200.00", "20")).toBe("-1000.00");
  });
});

describe("kur uygulama", () => {
  it("TRY için kur 1, tutar değişmez", () => {
    expect(applyRate("1500.00", "1")).toBe("1500.00");
  });

  it("EUR 100 × 35.5 = 3550", () => {
    expect(applyRate("100.00", "35.5")).toBe("3550.00");
  });

  it("altı ondalıklı kur çalışır", () => {
    expect(applyRate("100.00", "35.123456")).toBe("3512.35");
  });
});

describe("hakedişe uygun çeteleler", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedWithTrips() {
    const base = await seed();
    await dbAdmin.insert(vehicleOperators).values({
      tenantId: base.tenantId,
      vehicleId: base.v1.id,
      operatorId: base.isleten.id,
      startsOn: "2026-09-01",
    });
    await dbAdmin.insert(tripLogs).values([
      { tenantId: base.tenantId, vehicleId: base.v1.id, logDate: "2026-09-05", tripType: "sabah", status: "onaylandi" },
      { tenantId: base.tenantId, vehicleId: base.v1.id, logDate: "2026-09-05", tripType: "aksam", status: "onaylandi" },
      { tenantId: base.tenantId, vehicleId: base.v1.id, logDate: "2026-09-06", tripType: "sabah", status: "bekliyor" },
    ]);
    return base;
  }

  it("yalnız onaylı çeteleler gelir", async () => {
    const { tenantId, isleten } = await seedWithTrips();
    const trips = await eligibleTripLogs(tenantId, {
      operatorId: isleten.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(trips).toHaveLength(2);
    expect(trips.every((t) => t.tripType !== "sabah" || t.logDate === "2026-09-05")).toBe(true);
  });

  it("başka hakedişe bağlanmış çetele ikinci kez gelmez", async () => {
    const { tenantId, isleten } = await seedWithTrips();
    const [earning] = await dbAdmin
      .insert(earnings)
      .values({
        tenantId,
        operatorId: isleten.id,
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      })
      .returning();

    const first = await eligibleTripLogs(tenantId, {
      operatorId: isleten.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    await dbAdmin.insert(earningTripLogs).values({
      tenantId,
      earningId: earning!.id,
      tripLogId: first[0]!.id,
    });

    const second = await eligibleTripLogs(tenantId, {
      operatorId: isleten.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(first[0]!.id);
  });

  it("bir çetele iki hakedişe bağlanamaz", async () => {
    const { tenantId, isleten } = await seedWithTrips();
    const created = await dbAdmin
      .insert(earnings)
      .values([
        { tenantId, operatorId: isleten.id, periodStart: "2026-09-01", periodEnd: "2026-09-30" },
        { tenantId, operatorId: isleten.id, periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      ])
      .returning();
    const trips = await eligibleTripLogs(tenantId, {
      operatorId: isleten.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });

    await dbAdmin.insert(earningTripLogs).values({
      tenantId,
      earningId: created[0]!.id,
      tripLogId: trips[0]!.id,
    });
    await expect(
      dbAdmin.insert(earningTripLogs).values({
        tenantId,
        earningId: created[1]!.id,
        tripLogId: trips[0]!.id,
      }),
    ).rejects.toThrow();
  });

  it("atama dönemi dışındaki çetele işletene sayılmaz", async () => {
    const base = await seed();
    await dbAdmin.insert(vehicleOperators).values({
      tenantId: base.tenantId,
      vehicleId: base.v1.id,
      operatorId: base.isleten.id,
      startsOn: "2026-09-10",
    });
    await dbAdmin.insert(tripLogs).values({
      tenantId: base.tenantId,
      vehicleId: base.v1.id,
      logDate: "2026-09-05",
      tripType: "sabah",
      status: "onaylandi",
    });
    const trips = await eligibleTripLogs(base.tenantId, {
      operatorId: base.isleten.id,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(trips).toHaveLength(0);
  });
});

describe("cari bakiye", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("bakiye borç eksi alacaktır", async () => {
    const { tenantId, musteri } = await seed();
    await dbAdmin.insert(ledgerEntries).values([
      { tenantId, companyId: musteri.id, entryDate: "2026-09-01", debit: "10000.00" },
      { tenantId, companyId: musteri.id, entryDate: "2026-09-15", credit: "4000.00" },
    ]);
    const rows = await listBalances(tenantId, null);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.balance)).toBe(6000);
  });

  it("kapsam dışı firma bakiyede görünmez", async () => {
    const { tenantId, isleten, musteri } = await seed();
    await dbAdmin.insert(ledgerEntries).values([
      { tenantId, companyId: musteri.id, entryDate: "2026-09-01", debit: "100.00" },
      { tenantId, companyId: isleten.id, entryDate: "2026-09-01", debit: "200.00" },
    ]);
    const rows = await listBalances(tenantId, [musteri.id]);
    expect(rows.map((r) => r.companyName)).toEqual(["Beta Müşteri"]);
  });
});

describe("kâr-zarar", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("taslak hareketler kâr-zarara girmez", async () => {
    const { tenantId } = await seed();
    const [kat] = await dbAdmin
      .insert(financeCategories)
      .values({ tenantId, name: "Yakıt", kind: "gider" })
      .returning();
    await dbAdmin.insert(financeTransactions).values([
      { tenantId, kind: "gider", entryDate: "2026-09-05", categoryId: kat!.id, amountTry: "5000.00", status: "tamamlandi" },
      { tenantId, kind: "gider", entryDate: "2026-09-06", categoryId: kat!.id, amountTry: "9999.00", status: "taslak" },
      { tenantId, kind: "gelir", entryDate: "2026-09-07", amountTry: "20000.00", status: "tamamlandi" },
    ]);

    const { monthly } = await profitAndLoss(tenantId, "2026-09-01", "2026-09-30");
    const gider = monthly.find((m) => m.kind === "gider");
    const gelir = monthly.find((m) => m.kind === "gelir");
    expect(Number(gider?.toplam)).toBe(5000);
    expect(Number(gelir?.toplam)).toBe(20000);
  });

  it("hareket silinince kategorisi kalır", async () => {
    const { tenantId } = await seed();
    const [kat] = await dbAdmin
      .insert(financeCategories)
      .values({ tenantId, name: "Bakım", kind: "gider" })
      .returning();
    await dbAdmin.insert(financeTransactions).values({
      tenantId,
      kind: "gider",
      entryDate: "2026-09-05",
      categoryId: kat!.id,
      amountTry: "100.00",
    });
    await dbAdmin.delete(financeTransactions);
    const kats = await dbAdmin.select().from(financeCategories).where(eq(financeCategories.tenantId, tenantId));
    expect(kats).toHaveLength(1);
  });
});
