import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { companies, passengers, tenants, vehicles } from "@/db/schema";
import { applyImportJob, createImportJob, rollbackImportJob } from "@/lib/import/run";
import { ensureImportTargetsRegistered, listImportTargets } from "@/lib/import/targets";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { resetDatabase } from "./setup";

const ALL = new Set(ALL_PERMISSIONS);

async function seedTenant(): Promise<string> {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  return tenant!.id;
}

describe("operasyon import hedefleri", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureImportTargetsRegistered();
  });

  it("dört hedef kayıtlı ve izne göre süzülür", () => {
    const keys = listImportTargets(ALL).map((t) => t.key).sort();
    expect(keys).toEqual(["araclar", "firmalar", "suruculer", "yolcular"]);
    expect(listImportTargets(new Set(["yolcular:import"])).map((t) => t.key)).toEqual(["yolcular"]);
  });

  it("yolcu aktarımı firmayı adından çözer, yoksa oluşturur", async () => {
    const tenantId = await seedTenant();
    const jobId = await createImportJob(tenantId, crypto.randomUUID(), {
      targetKey: "yolcular",
      fileName: "yolcular.csv",
      headers: ["Ad Soyad", "Firma", "Telefon"],
      rows: [
        ["Ali Veli", "Alfa Sanayi", "5551112233"],
        ["Ayşe Can", "Alfa Sanayi", "5559998877"],
      ],
      mapping: { "Ad Soyad": "fullName", Firma: "company", Telefon: "phone" },
    });

    const { inserted } = await applyImportJob(tenantId, jobId);
    expect(inserted).toBe(2);

    const firmaRows = await dbAdmin.select().from(companies).where(eq(companies.tenantId, tenantId));
    expect(firmaRows).toHaveLength(1);
    expect(firmaRows[0]!.name).toBe("Alfa Sanayi");

    const yolcuRows = await dbAdmin.select().from(passengers).where(eq(passengers.tenantId, tenantId));
    expect(yolcuRows).toHaveLength(2);
    expect(yolcuRows.every((p) => p.companyId === firmaRows[0]!.id)).toBe(true);
  });

  it("araç aktarımı plakayı normalleştirir", async () => {
    const tenantId = await seedTenant();
    const jobId = await createImportJob(tenantId, crypto.randomUUID(), {
      targetKey: "araclar",
      fileName: "araclar.csv",
      headers: ["Plaka", "Kapasite"],
      rows: [["34 abc 123", "27"]],
      mapping: { Plaka: "plate", Kapasite: "capacity" },
    });
    await applyImportJob(tenantId, jobId);

    const rows = await dbAdmin.select().from(vehicles).where(eq(vehicles.tenantId, tenantId));
    expect(rows[0]!.plate).toBe("34ABC123");
    expect(rows[0]!.capacity).toBe(27);
  });

  it("zorunlu sütunu boş satır yazılmaz, hatasızlar yazılır", async () => {
    const tenantId = await seedTenant();
    const jobId = await createImportJob(tenantId, crypto.randomUUID(), {
      targetKey: "yolcular",
      fileName: "yolcular.csv",
      headers: ["Ad Soyad"],
      rows: [["Ali Veli"], [""], ["Ayşe Can"]],
      mapping: { "Ad Soyad": "fullName" },
    });
    const { inserted } = await applyImportJob(tenantId, jobId);
    expect(inserted).toBe(2);
  });

  it("geri alma yalnız bu işin eklediği kayıtları siler", async () => {
    const tenantId = await seedTenant();
    await dbAdmin.insert(passengers).values({ tenantId, fullName: "Elle Eklenen" });

    const jobId = await createImportJob(tenantId, crypto.randomUUID(), {
      targetKey: "yolcular",
      fileName: "yolcular.csv",
      headers: ["Ad Soyad"],
      rows: [["Ali Veli"], ["Ayşe Can"]],
      mapping: { "Ad Soyad": "fullName" },
    });
    await applyImportJob(tenantId, jobId);
    const { deleted } = await rollbackImportJob(tenantId, jobId);

    expect(deleted).toBe(2);
    const rows = await dbAdmin.select().from(passengers).where(eq(passengers.tenantId, tenantId));
    expect(rows.map((r) => r.fullName)).toEqual(["Elle Eklenen"]);
  });

  it("uygulanan iş ikinci kez uygulanamaz", async () => {
    const tenantId = await seedTenant();
    const jobId = await createImportJob(tenantId, crypto.randomUUID(), {
      targetKey: "firmalar",
      fileName: "f.csv",
      headers: ["Ünvan"],
      rows: [["Alfa"]],
      mapping: { "Ünvan": "name" },
    });
    await applyImportJob(tenantId, jobId);
    await expect(applyImportJob(tenantId, jobId)).rejects.toThrow("zaten uygulandı");
  });
});
