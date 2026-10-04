import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import { listReports, registerReport, REPORT_CATALOG, runReport } from "@/lib/reports/engine";
import { buildCsv, buildXlsx, contentDisposition } from "@/lib/reports/export";
import { resetDatabase } from "./setup";

registerReport({
  key: "test_rapor",
  name: "Test Raporu",
  category: "Test",
  description: "Deneme",
  permission: "raporlar:read",
  needsDateRange: false,
  run: async () => ({
    columns: [
      { key: "ad", label: "Ad" },
      { key: "adet", label: "Adet", align: "right" },
    ],
    rows: [{ ad: "Satır", adet: 5 }],
    summary: { Toplam: "5" },
  }),
});

describe("rapor motoru", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kayıtlı raporu çalıştırır", async () => {
    const [t] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "rap", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    const result = await runReport("test_rapor", { tenantId: t!.id });
    expect(result.rows).toHaveLength(1);
    expect(result.columns.map((c) => c.key)).toEqual(["ad", "adet"]);
    expect(result.summary).toEqual({ Toplam: "5" });
  });

  it("bilinmeyen rapor hata verir", async () => {
    await expect(runReport("yok", { tenantId: "x" })).rejects.toThrow(/Bilinmeyen rapor/);
  });

  it("izne göre süzer", () => {
    expect(listReports(new Set(["raporlar:read"])).map((r) => r.key)).toContain("test_rapor");
    expect(listReports(new Set(["dashboard:read"])).map((r) => r.key)).not.toContain("test_rapor");
  });

  it("katalog anahtarı tanımla eşleşir", () => {
    for (const [key, def] of Object.entries(REPORT_CATALOG)) {
      expect(def.key).toBe(key);
    }
  });
});

describe("rapor dışa aktarma", () => {
  const result = {
    columns: [
      { key: "ad", label: "Ad" },
      { key: "tutar", label: "Tutar", align: "right" as const },
    ],
    rows: [
      { ad: "Ali", tutar: 1500 },
      { ad: 'Vel"i; Test', tutar: 2000 },
    ],
    summary: { Toplam: "3500" },
  };

  it("CSV üretir — BOM'lu, noktalı virgül ayraçlı", () => {
    const csv = buildCsv(result);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ad;Tutar");
    expect(csv).toContain("Ali;1500");
  });

  it("CSV içindeki tırnak ve ayracı kaçırır", () => {
    expect(buildCsv(result)).toContain('"Vel""i; Test"');
  });

  it("XLSX üretir — geçerli zip başlığı", async () => {
    const buf = await buildXlsx("Test", result);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

describe("çekirdek raporlar", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kullanıcı raporu kiracının kullanıcılarını döner", async () => {
    const { registerCoreReports } = await import("@/modules/reports/core-reports");
    registerCoreReports();

    const [t] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "cr", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    const { users } = await import("@/db/schema");
    await dbAdmin
      .insert(users)
      .values({ tenantId: t!.id, email: "r@x.com", name: "Rapor", passwordHash: "x" });

    const result = await runReport("kullanicilar", { tenantId: t!.id });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["email"]).toBe("r@x.com");
    expect(result.summary!["Toplam kullanıcı"]).toBe("1");
  });
});

describe("contentDisposition", () => {
  it("Türkçe karakterleri ASCII'ye indirger", () => {
    expect(contentDisposition("Kullanıcı Listesi", "csv")).toContain('filename="kullanici-listesi.csv"');
  });

  it("orijinal adı UTF-8 filename* ile korur", () => {
    const header = contentDisposition("Kullanıcı Listesi", "csv");
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("Kullanıcı Listesi.csv"));
  });

  it("başlığın tamamı ByteString'e sığar", () => {
    const header = contentDisposition("Şoför Çetelesi", "xlsx");
    for (const ch of header) expect(ch.charCodeAt(0)).toBeLessThan(256);
  });
});
