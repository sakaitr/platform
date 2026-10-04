import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { companies, passengers, paymentPlans, routes, tenants } from "@/db/schema";
import { listPassengers, listPaymentPlans } from "@/modules/operasyon/yolcular/queries";
import { resetDatabase } from "./setup";

async function seed() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const tenantId = tenant!.id;
  const firms = await dbAdmin
    .insert(companies)
    .values([
      { tenantId, name: "Beta" },
      { tenantId, name: "Alfa" },
    ])
    .returning();
  const [route] = await dbAdmin
    .insert(routes)
    .values({ tenantId, companyId: firms[0]!.id, name: "Hat 1" })
    .returning();
  return { tenantId, beta: firms[0]!, alfa: firms[1]!, route: route! };
}

describe("yolcu listesi", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("firmaya göre sıralar", async () => {
    const { tenantId, alfa, beta } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, companyId: beta.id, fullName: "Zeynep" },
      { tenantId, companyId: alfa.id, fullName: "Ahmet" },
    ]);
    const { rows } = await listPassengers(tenantId, { scope: null, sirala: "firma" });
    expect(rows.map((r) => r.companyName)).toEqual(["Alfa", "Beta"]);
  });

  it("türe göre sıralar", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, fullName: "A", type: "yolcu" },
      { tenantId, fullName: "B", type: "musteri" },
      { tenantId, fullName: "C", type: "personel" },
    ]);
    const { rows } = await listPassengers(tenantId, { scope: null, sirala: "tur" });
    // enum sırası: yolcu, personel, musteri
    expect(rows.map((r) => r.type)).toEqual(["yolcu", "personel", "musteri"]);
  });

  it("varsayılan sıralama ada göredir", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, fullName: "Zeynep" },
      { tenantId, fullName: "Ahmet" },
    ]);
    const { rows } = await listPassengers(tenantId, { scope: null });
    expect(rows.map((r) => r.fullName)).toEqual(["Ahmet", "Zeynep"]);
  });

  it("güzergaha göre süzer", async () => {
    const { tenantId, route } = await seed();
    await dbAdmin.insert(passengers).values([
      { tenantId, fullName: "Hatlı", routeId: route.id },
      { tenantId, fullName: "Hatsız" },
    ]);
    const { rows } = await listPassengers(tenantId, { scope: null, routeId: route.id });
    expect(rows.map((r) => r.fullName)).toEqual(["Hatlı"]);
  });

  it("güzergah ve ödeme planı adını getirir", async () => {
    const { tenantId, route } = await seed();
    const [plan] = await dbAdmin
      .insert(paymentPlans)
      .values({ tenantId, name: "10 Taksit", totalAmount: "12000", installments: 10 })
      .returning();
    await dbAdmin.insert(passengers).values({
      tenantId,
      fullName: "Planlı",
      routeId: route.id,
      paymentPlanId: plan!.id,
    });
    const { rows } = await listPassengers(tenantId, { scope: null });
    expect(rows[0]!.routeName).toBe("Hat 1");
    expect(rows[0]!.planName).toBe("10 Taksit");
  });

  it("sözleşme ve yön varsayılanları doğru", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(passengers).values({ tenantId, fullName: "Yeni" });
    const { rows } = await listPassengers(tenantId, { scope: null });
    expect(rows[0]!.contractStatus).toBe("yok");
    expect(rows[0]!.direction).toBe("her_iki");
  });

  it("aynı plan adı kiracı içinde ikinci kez eklenemez", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(paymentPlans).values({ tenantId, name: "10 Taksit" });
    await expect(
      dbAdmin.insert(paymentPlans).values({ tenantId, name: "10 Taksit" }),
    ).rejects.toThrow();
  });

  it("plan listesi ada göre gelir", async () => {
    const { tenantId } = await seed();
    await dbAdmin.insert(paymentPlans).values([
      { tenantId, name: "Peşin" },
      { tenantId, name: "10 Taksit" },
    ]);
    const rows = await listPaymentPlans(tenantId);
    expect(rows.map((p) => p.name)).toEqual(["10 Taksit", "Peşin"]);
  });
});
