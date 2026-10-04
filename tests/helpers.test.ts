import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { numberingSequences, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { calcVat, calcWithholding, formatTRY } from "@/lib/money";
import { istanbulDayKey, istanbulPeriodKey } from "@/lib/time";
import { nextNumber } from "@/lib/numbering";
import { tenantTag } from "@/lib/cache";
import { resetDatabase } from "./setup";

describe("para", () => {
  it("TRY biçimler", () => {
    expect(formatTRY("1234.5")).toBe("₺1.234,50");
  });

  it("KDV hesaplar — kuruş kaybı yok", () => {
    expect(calcVat("1000.00", "20.00")).toEqual({ vat: "200.00", gross: "1200.00" });
    expect(calcVat("333.33", "20.00")).toEqual({ vat: "66.67", gross: "400.00" });
  });

  it("tevkifat hesaplar", () => {
    expect(calcWithholding("200.00", "50.00")).toBe("100.00");
  });
});

describe("zaman", () => {
  it("İstanbul gününü döner — UTC gece yarısı kayması yok", () => {
    expect(istanbulDayKey(new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-08");
  });

  it("dönem anahtarı üretir", () => {
    const d = new Date("2026-09-07T10:00:00Z");
    expect(istanbulPeriodKey("yearly", d)).toBe("2026");
    expect(istanbulPeriodKey("monthly", d)).toBe("2026-09");
    expect(istanbulPeriodKey("none", d)).toBe("");
  });
});

describe("numaralandırma", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("boşluksuz artan numara üretir", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(numberingSequences).values({
      tenantId: tenant!.id,
      sequenceKey: "fatura",
      prefix: "FT",
      padding: 5,
      periodReset: "yearly",
    });

    const first = await withTenant(tenant!.id, (tx) => nextNumber(tx, tenant!.id, "fatura"));
    const second = await withTenant(tenant!.id, (tx) => nextNumber(tx, tenant!.id, "fatura"));

    expect(first).toBe("FT2026-00001");
    expect(second).toBe("FT2026-00002");
  });
});

describe("cache etiketi", () => {
  it("kiracıya kapsanmış etiket üretir", () => {
    expect(tenantTag("abc", "modules")).toBe("t:abc:modules");
  });
});
