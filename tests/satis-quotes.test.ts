import { describe, expect, it } from "vitest";
import {
  canTransition,
  computeQuote,
  formatAmount,
  formatQty,
  isEditable,
  lineNetCents,
  normalizeItems,
  parseDecimal,
  toEditorItem,
  validateItems,
  type QuoteItem,
} from "@/modules/satis/quotes";

const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({ name: "Hizmet", qty: "1", unitPrice: "100.00", vatRate: "20", ...over });

describe("sayı ayrıştırma (kesin kurallar)", () => {
  it.each([
    ["1250", 2, "1250"],
    ["1250.5", 2, "1250.5"],
    ["1250,50", 2, "1250.50"],
    ["1.250,50", 2, "1250.50"],
    ["1,250.50", 2, "1250.50"],
    ["12,5", 2, "12.5"],
    ["1.000", 2, "1000"],
    ["1.234.567", 2, "1234567"],
    ["₺ 1.000,00 TL", 2, "1000.00"],
    ["0,125", 3, "0.125"],
    ["0.125", 3, "0.125"],
    ["007", 2, "7"],
    ["12,", 2, "12"],
  ])("%s → %s", (raw, decimals, expected) => {
    expect(parseDecimal(raw, decimals)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1,2,3", "1.2.3", "1,250,50", "12,345", "1.00,5", "1,2.5", "1e5", "٣"])("geçersiz: %j", (raw) => {
    expect(parseDecimal(raw, 2)).toBeNull();
  });

  it("ondalık sınırı aşılırsa yuvarlamaz, reddeder", () => {
    expect(parseDecimal("1,255", 2)).toBeNull();
    expect(parseDecimal("1,2555", 3)).toBeNull();
    expect(parseDecimal("1,255", 3)).toBe("1.255");
  });
});

describe("kalem ve toplam hesabı", () => {
  it("kalem: birim fiyat × adet, yarıyı yukarı yuvarlar", () => {
    expect(lineNetCents(item({ qty: "3", unitPrice: "19.99" }))).toBe(5997n);
    expect(lineNetCents(item({ qty: "1.5", unitPrice: "10.01" }))).toBe(1502n); // 15.015 → 15.02
    expect(lineNetCents(item({ qty: "0.333", unitPrice: "100.00" }))).toBe(3330n);
    expect(lineNetCents(item({ qty: "0.001", unitPrice: "0.50" }))).toBe(0n);
  });

  it("float hatası yok: 0.1 + 0.2 sınıfı toplamlar kuruşu şaşırmaz", () => {
    const t = computeQuote([item({ unitPrice: "0.10", vatRate: "0" }), item({ unitPrice: "0.20", vatRate: "0" })]);
    expect(t.subtotal).toBe("0.30");
    expect(t.total).toBe("0.30");
  });

  it("KDV oran grubu üzerinden hesaplanır, toplam = matrah + KDV", () => {
    const t = computeQuote([
      item({ name: "A", qty: "2", unitPrice: "1000.00", vatRate: "20" }),
      item({ name: "B", qty: "1", unitPrice: "500.00", vatRate: "10" }),
      item({ name: "C", qty: "1", unitPrice: "250.50", vatRate: "20.0" }),
      item({ name: "D", qty: "1", unitPrice: "100.00", vatRate: "0" }),
    ]);
    expect(t.lines.map((l) => l.net)).toEqual(["2000.00", "500.00", "250.50", "100.00"]);
    expect(t.vatByRate).toEqual([
      { rate: "0", base: "100.00", vat: "0.00" },
      { rate: "10", base: "500.00", vat: "50.00" },
      { rate: "20", base: "2250.50", vat: "450.10" }, // "20.0" ve "20" aynı grup
    ]);
    expect(t.subtotal).toBe("2850.50");
    expect(t.vatTotal).toBe("500.10");
    expect(t.total).toBe("3350.60");
  });

  it("KDV grup başına bir kez yuvarlanır (kalem başına birikmez)", () => {
    // 3 kalem × 0.05 TL, %20: kalem başına 0.01×3 = 0.03; grup: 0.15×%20 = 0.03
    // 3 kalem × 0.07 TL: kalem başına 0.014→0.01 ×3 = 0.03; grup: 0.21×%20 = 0.042→0.04
    const t = computeQuote([item({ unitPrice: "0.07" }), item({ unitPrice: "0.07" }), item({ unitPrice: "0.07" })]);
    expect(t.vatTotal).toBe("0.04");
    expect(t.total).toBe("0.25");
  });

  it("yarım kuruş yukarı yuvarlanır", () => {
    // 0.25 × %10 = 0.025 → 0.03
    expect(computeQuote([item({ unitPrice: "0.25", vatRate: "10" })]).vatTotal).toBe("0.03");
  });

  it("büyük tutarlarda taşma/kayıp yok", () => {
    const t = computeQuote([item({ qty: "1000000", unitPrice: "99999999.99", vatRate: "20" })]);
    expect(t.subtotal).toBe("99999999990000.00");
    expect(t.total).toBe("119999999988000.00");
  });

  it("boş liste sıfır döner", () => {
    expect(computeQuote([])).toMatchObject({ subtotal: "0.00", vatTotal: "0.00", total: "0.00", vatByRate: [] });
  });
});

describe("kalem doğrulama", () => {
  it("geçerli", () => expect(validateItems([item()])).toBeNull());
  it("boş liste ve çok kalem", () => {
    expect(validateItems([])).toMatch(/en az bir kalem/);
    expect(validateItems(Array.from({ length: 101 }, () => item()))).toMatch(/en fazla 100/);
  });
  it("ad, adet, fiyat, KDV hataları satır numarasıyla", () => {
    expect(validateItems([item(), item({ name: "  " })])).toBe("Kalem 2: ad boş olamaz.");
    expect(validateItems([item({ name: "x".repeat(256) })])).toMatch(/Kalem 1: ad en fazla/);
    expect(validateItems([item({ qty: "0" })])).toMatch(/adet sıfırdan büyük/);
    expect(validateItems([item({ qty: "abc" })])).toMatch(/adet/);
    expect(validateItems([item({ qty: "1.5555" })])).toMatch(/adet/);
    expect(validateItems([item({ qty: "2000000" })])).toMatch(/adet çok büyük/);
    expect(validateItems([item({ unitPrice: "-1" })])).toMatch(/birim fiyat/);
    expect(validateItems([item({ unitPrice: "1,234" })])).toMatch(/birim fiyat/);
    expect(validateItems([item({ unitPrice: "200000000" })])).toMatch(/çok büyük/);
    expect(validateItems([item({ vatRate: "101" })])).toMatch(/KDV oranı/);
    expect(validateItems([item({ vatRate: "x" })])).toMatch(/KDV oranı/);
    expect(validateItems([item({ unitPrice: "0" })])).toBeNull(); // ücretsiz kalem serbest
  });
  it("normalizeItems TR yazımı standarda çevirir", () => {
    const r = normalizeItems([{ name: " Web sitesi ", qty: "1,5", unitPrice: "1.250,50", vatRate: "20" }]);
    expect(r).toEqual({ ok: true, items: [{ name: "Web sitesi", qty: "1.5", unitPrice: "1250.50", vatRate: "20" }] });
    expect(normalizeItems([{ name: "", qty: "1", unitPrice: "1", vatRate: "0" }])).toMatchObject({ ok: false });
  });
});

describe("durum makinesi ve gösterim", () => {
  it("geçişler", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "rejected")).toBe(true);
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("sent", "draft")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
    expect(canTransition("rejected", "sent")).toBe(false);
  });
  it("yalnız taslak düzenlenir", () => {
    expect(isEditable("draft")).toBe(true);
    for (const s of ["sent", "accepted", "rejected"] as const) expect(isEditable(s)).toBe(false);
  });
  it("gösterim biçimleri", () => {
    expect(formatAmount("1250.50")).toBe("1.250,50");
    expect(formatAmount("0.30")).toBe("0,30");
    expect(formatAmount("1234567.00")).toBe("1.234.567,00");
    expect(formatAmount("-5.5")).toBe("-5,50");
    expect(formatQty("2.500")).toBe("2,5");
    expect(formatQty("3.000")).toBe("3");
    expect(formatQty("3")).toBe("3");
  });
});

describe("düzenleyici gidiş-dönüşü", () => {
  it("saklanan değer düzenleyiciye TR biçiminde verilip yeniden okununca değişmez", () => {
    const stored: QuoteItem[] = [
      { name: "A", qty: "2.500", unitPrice: "1250.50", vatRate: "20" },
      { name: "B", qty: "1000", unitPrice: "0.05", vatRate: "0.00" },
      { name: "C", qty: "0.125", unitPrice: "10.00", vatRate: "1.5" },
      { name: "D", qty: "3.000", unitPrice: "1000.00", vatRate: "10" },
    ];
    const shown = stored.map(toEditorItem);
    expect(shown[0]).toEqual({ name: "A", qty: "2,5", unitPrice: "1250,50", vatRate: "20" });
    expect(shown[3]).toEqual({ name: "D", qty: "3", unitPrice: "1000,00", vatRate: "10" });
    const back = normalizeItems(shown);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(computeQuote(back.items)).toEqual(computeQuote(stored));
    }
  });
  it("tuzak: standart '2.500' doğrudan ayrıştırılırsa 2500 olur (toEditorItem bunu önler)", () => {
    expect(parseDecimal("2.500", 3)).toBe("2500");
    expect(parseDecimal(toEditorItem({ name: "x", qty: "2.500", unitPrice: "1.00", vatRate: "0" }).qty, 3)).toBe("2.5");
  });
});
