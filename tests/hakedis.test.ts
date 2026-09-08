import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  formatQuantity,
  multiplyMoney,
  percentOf,
  subMoney,
} from "@/lib/money";
import { calcEarning } from "@/modules/muhasebe/hakedis-hesap";

describe("para aritmetiği", () => {
  it("kuruş kaybetmeden toplar", () => {
    expect(addMoney("0.10", "0.20")).toBe("0.30");
    expect(addMoney("1234.56", "0.44")).toBe("1235.00");
    expect(addMoney("0.01", "0.01", "0.01")).toBe("0.03");
  });

  it("negatif sonucu doğru biçimler", () => {
    expect(subMoney("100.00", "250.50")).toBe("-150.50");
    expect(subMoney("0.10", "0.20")).toBe("-0.10");
  });

  it("adetle çarpar", () => {
    expect(multiplyMoney("1250.75", 22)).toBe("27516.50");
    expect(multiplyMoney("0.01", 300)).toBe("3.00");
  });

  it("yüzde alırken yarıyı yukarı yuvarlar", () => {
    expect(percentOf("100.00", "20")).toBe("20.00");
    expect(percentOf("0.05", "50")).toBe("0.03");
    expect(percentOf("-100.00", "20")).toBe("-20.00");
  });

  it("karşılaştırma", () => {
    expect(compareMoney("100.00", "100.00")).toBe(0);
    expect(compareMoney("100.01", "100.00")).toBe(1);
    expect(compareMoney("99.99", "100.00")).toBe(-1);
  });
});

describe("hakediş hesabı", () => {
  it("tevkifatsız: net = brüt + KDV", () => {
    const r = calcEarning({ unitPrice: "1000.00", tripCount: 22, vatRate: "20", withholdingRate: "0" });
    expect(r.gross).toBe("22000.00");
    expect(r.vat).toBe("4400.00");
    expect(r.withholding).toBe("0.00");
    expect(r.net).toBe("26400.00");
  });

  it("2/10 tevkifatta KDV'nin %20'si alıcıda kalır", () => {
    const r = calcEarning({ unitPrice: "1000.00", tripCount: 10, vatRate: "20", withholdingRate: "20" });
    expect(r.gross).toBe("10000.00");
    expect(r.vat).toBe("2000.00");
    expect(r.withholding).toBe("400.00");
    // 10000 + 2000 - 400
    expect(r.net).toBe("11600.00");
  });

  it("5/10 tevkifat", () => {
    const r = calcEarning({ unitPrice: "500.00", tripCount: 4, vatRate: "20", withholdingRate: "50" });
    expect(r.gross).toBe("2000.00");
    expect(r.vat).toBe("400.00");
    expect(r.withholding).toBe("200.00");
    expect(r.net).toBe("2200.00");
  });

  it("kesinti nettten düşülür", () => {
    const r = calcEarning({
      unitPrice: "1000.00",
      tripCount: 10,
      vatRate: "20",
      withholdingRate: "20",
      deductions: "1500.00",
    });
    expect(r.net).toBe("10100.00");
  });

  it("kuruşlu birim fiyat toplamda kaymaz", () => {
    const r = calcEarning({ unitPrice: "333.33", tripCount: 3, vatRate: "20", withholdingRate: "0" });
    expect(r.gross).toBe("999.99");
    expect(r.vat).toBe("200.00");
    expect(r.net).toBe("1199.99");
  });

  it("sıfır sefer sıfır hakediş üretir", () => {
    const r = calcEarning({ unitPrice: "1000.00", tripCount: 0, vatRate: "20", withholdingRate: "20" });
    expect(r.gross).toBe("0.00");
    expect(r.net).toBe("0.00");
  });

  it("KDV oranı değişince zincir uyum sağlar (%10)", () => {
    const r = calcEarning({ unitPrice: "1000.00", tripCount: 10, vatRate: "10", withholdingRate: "20" });
    expect(r.vat).toBe("1000.00");
    expect(r.withholding).toBe("200.00");
    expect(r.net).toBe("10800.00");
  });
});

describe("miktar biçimlendirme", () => {
  it("gereksiz sıfırları atar", () => {
    expect(formatQuantity("12.00")).toBe("12");
    expect(formatQuantity("0.50")).toBe("0,5");
    expect(formatQuantity("100.25")).toBe("100,25");
  });

  it("boş değerde tire döner", () => {
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity("")).toBe("—");
  });
});
