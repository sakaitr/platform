import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { ensureReportsRegistered, listReports, REPORT_CATALOG, runReport } from "@/lib/reports/engine";
import { resetDatabase } from "./setup";

const ALL = new Set(ALL_PERMISSIONS);

describe("rapor kataloğu", () => {
  beforeEach(async () => {
    await resetDatabase();
    await ensureReportsRegistered();
  });

  it("her raporun izni katalogda tanımlı", () => {
    for (const def of Object.values(REPORT_CATALOG)) {
      expect(ALL.has(def.permission), `${def.key} → ${def.permission}`).toBe(true);
    }
  });

  it("rapor anahtarları tekil ve kategorili", () => {
    const defs = Object.values(REPORT_CATALOG);
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
    expect(defs.every((d) => d.category.length > 0)).toBe(true);
  });

  it("izin süzgeci çalışır", () => {
    expect(listReports(ALL).length).toBe(Object.keys(REPORT_CATALOG).length);
    expect(listReports(new Set())).toHaveLength(0);
    const yalnizArrivals = listReports(new Set(["arrivals:read"]));
    expect(yalnizArrivals.length).toBeGreaterThan(0);
    expect(yalnizArrivals.every((r) => r.permission === "arrivals:read")).toBe(true);
  });

  it("veri yokken her rapor hatasız çalışır ve sütun döner", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();

    for (const def of Object.values(REPORT_CATALOG)) {
      const result = await runReport(def.key, {
        tenantId: tenant!.id,
        from: "2026-01-01",
        to: "2026-12-31",
      });
      expect(result.columns.length, `${def.key} sütunsuz`).toBeGreaterThan(0);
      expect(Array.isArray(result.rows), `${def.key} satır dizisi değil`).toBe(true);
    }
  });

  it("tarih aralığı olmadan da çalışır", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t2", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();

    for (const def of Object.values(REPORT_CATALOG)) {
      const result = await runReport(def.key, { tenantId: tenant!.id });
      expect(result.columns.length).toBeGreaterThan(0);
    }
  });

  it("bilinmeyen rapor hata verir", async () => {
    await expect(runReport("olmayan_rapor", { tenantId: "x" })).rejects.toThrow("Bilinmeyen rapor");
  });
});
