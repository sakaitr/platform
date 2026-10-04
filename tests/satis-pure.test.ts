import { describe, expect, it } from "vitest";
import {
  buildLeadKeys,
  emailKey,
  foldText,
  nameKey,
  phoneKey,
  websiteKey,
  whatsappNumber,
} from "@/modules/satis/normalize";
import { resolveScore, scoreLead } from "@/modules/satis/scoring";
import { buildCsvText, escapeCsvCell, escapeFormula, parseCsv } from "@/modules/satis/csv";
import { mapHeaders, parseLeadRow, parseMoney } from "@/modules/satis/csv-leads";

describe("telefon anahtarı", () => {
  it("aynı numaranın farklı yazımları aynı anahtara düşer", () => {
    const variants = ["0532 000 00 00", "+90 532 000 0000", "905320000000", "0090 532 000 00 00", "(532) 000-00-00"];
    for (const v of variants) expect(phoneKey(v), v).toBe("5320000000");
  });
  it("çok kısa, çok uzun ya da boş değer anahtar üretmez", () => {
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey("1".repeat(16))).toBeNull();
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("yok")).toBeNull();
  });
  it("yabancı numarayı bozmaz", () => {
    expect(phoneKey("+44 20 7946 0958")).toBe("442079460958");
  });
  it("wa.me numarası: yerel numaraya 90 eklenir", () => {
    expect(whatsappNumber("0532 000 00 00")).toBe("905320000000");
    expect(whatsappNumber("+44 20 7946 0958")).toBe("442079460958");
    expect(whatsappNumber("abc")).toBeNull();
  });
});

describe("e-posta, web ve ad anahtarı", () => {
  it("e-posta küçük harfe çevrilir, geçersiz değer anahtar üretmez", () => {
    expect(emailKey("  Deniz@Example.COM ")).toBe("deniz@example.com");
    expect(emailKey("deniz@")).toBeNull();
    expect(emailKey(null)).toBeNull();
  });
  it("web sitesi alan adına indirgenir", () => {
    for (const v of ["https://www.Mavitur.com/hakkimizda?x=1", "http://mavitur.com/", "mavitur.com", "WWW.mavitur.com:8080"]) {
      expect(websiteKey(v), v).toBe("mavitur.com");
    }
    expect(websiteKey("yok")).toBeNull();
    expect(websiteKey("bir iki.com")).toBeNull();
  });
  it("ad+şehir: Türkçe karakter ve boşluktan bağımsız; şehir yoksa anahtar yok", () => {
    expect(nameKey("Mavi Tur Ltd.", "İstanbul")).toBe(nameKey("MAVİ TUR LTD", "istanbul"));
    expect(nameKey("Çağrı Şahin", "Şanlıurfa")).toBe("cagrisahin|sanliurfa");
    expect(nameKey("Mavi Tur", null)).toBeNull();
  });
  it("foldText I/İ ve ı/i ayrımını doğru yapar", () => {
    expect(foldText("IŞIK İÇİN")).toBe("isikicin");
  });
  it("buildLeadKeys hepsini bir arada üretir", () => {
    expect(buildLeadKeys({ name: "Mavi Tur", city: "Ankara", phone: "0532 000 00 00", email: "A@b.co", website: "www.mavi.com" })).toEqual({
      phoneKey: "5320000000", emailKey: "a@b.co", websiteKey: "mavi.com", nameKey: "mavitur|ankara",
    });
  });
});

describe("puanlama", () => {
  it("alan doluluğuna göre toplar", () => {
    expect(scoreLead({})).toBe(0);
    expect(scoreLead({ website: "a.com" })).toBe(30);
    expect(scoreLead({ email: "a@b.co" })).toBe(25);
    expect(scoreLead({ phone: "5320000000" })).toBe(20);
    expect(scoreLead({ website: "a.com", email: "a@b.co", phone: "5" })).toBe(75);
  });
  it("yüksek puan 15, sektör eşleşmesi 10, tavan 100", () => {
    expect(scoreLead({ rating: 4.5 })).toBe(15);
    expect(scoreLead({ rating: 4.4 })).toBe(0);
    expect(scoreLead({ sectorMatch: true })).toBe(10);
    expect(scoreLead({ website: "a", email: "a", phone: "a", rating: 5, sectorMatch: true })).toBe(100);
  });
  it("boşluktan ibaret değer sayılmaz", () => {
    expect(scoreLead({ website: "   ", email: "" })).toBe(0);
  });
  it("sıcaklık varsa puanı o belirler: HOT 80, WARM 50, COLD 20; yoksa hesap", () => {
    expect(resolveScore({ temperature: "hot", website: "a" })).toBe(80);
    expect(resolveScore({ temperature: "warm" })).toBe(50);
    expect(resolveScore({ temperature: "cold", email: "a@b.co" })).toBe(20);
    expect(resolveScore({ temperature: null, email: "a@b.co" })).toBe(25);
  });
});

describe("CSV ayrıştırma", () => {
  it("noktalı virgül ayracını ve BOM'u tanır", () => {
    const { headers, rows } = parseCsv("﻿Ad;Telefon\nMavi Tur;0532\nYeşil;0533\n");
    expect(headers).toEqual(["Ad", "Telefon"]);
    expect(rows).toEqual([["Mavi Tur", "0532"], ["Yeşil", "0533"]]);
  });
  it("virgül ayracı ve CRLF", () => {
    const { rows } = parseCsv("ad,tel\r\nA,1\r\nB,2");
    expect(rows).toEqual([["A", "1"], ["B", "2"]]);
  });
  it("tırnak içinde ayraç, çift tırnak ve satır sonu korunur", () => {
    const { rows } = parseCsv('ad;mesaj\n"Mavi; Tur";"Dedi ki ""merhaba""\nikinci satır"\n');
    expect(rows).toEqual([["Mavi; Tur", 'Dedi ki "merhaba"\nikinci satır']]);
  });
  it("boş satırları atar, kısa satırı bozmaz", () => {
    const { rows } = parseCsv("a;b\n\nx\n;\n1;2\n");
    expect(rows).toEqual([["x"], ["1", "2"]]);
  });
  it("boş girdi", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], lines: [] });
  });
  it("satır numaraları dosyadaki gerçek satırdır: boş satır ve tırnak içi satır sonu sayılır", () => {
    const { rows, lines } = parseCsv('ad;mesaj\nA;1\n\n;;\nB;"iki\nsatır"\r\nC;3');
    expect(rows.map((r) => r[0])).toEqual(["A", "B", "C"]);
    expect(lines).toEqual([2, 5, 7]);
  });
  it("CRLF dosyada satır numarası", () => {
    const { lines } = parseCsv("a;b\r\nx;1\r\n\r\ny;2\r\n");
    expect(lines).toEqual([2, 4]);
  });
});

describe("CSV yazma: formül enjeksiyonu", () => {
  it("=, +, -, @, sekme ve satır başı ile başlayan hücre kaçırılır", () => {
    for (const v of ["=CMD()", "+90532", "-1+1", "@SUM(A1)", "\t=x", "\r=x"]) {
      expect(escapeFormula(v).startsWith("'"), JSON.stringify(v)).toBe(true);
    }
    expect(escapeFormula("Mavi Tur")).toBe("Mavi Tur");
    expect(escapeFormula("1+1")).toBe("1+1");
  });
  it("ayraç, tırnak ve satır sonu içeren hücre tırnaklanır", () => {
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(5)).toBe("5");
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
  });
  it("buildCsvText BOM ve CRLF ile yazar; yazılan metin geri okunur", () => {
    const text = buildCsvText(["Ad", "Not"], [["Mavi; Tur", "satır\nsonu"], ["=x", "ok"]]);
    expect(text.startsWith("﻿")).toBe(true);
    const parsed = parseCsv(text);
    expect(parsed.rows[0]).toEqual(["Mavi; Tur", "satır\nsonu"]);
    expect(parsed.rows[1]![0]).toBe("'=x");
  });
});

describe("aday CSV eşlemesi", () => {
  it("Türkçe ve İngilizce başlıkları tanır", () => {
    const map = mapHeaders(["Firma Adı", "Yetkili", "Cep", "E-posta", "Web Sitesi", "Şehir", "Sektör", "Tahmini Değer", "Sıcaklık", "Bilinmeyen"]);
    expect(map).toEqual({ name: 0, contactName: 1, phone: 2, email: 3, website: 4, city: 5, sector: 6, estimatedValue: 7, temperature: 8 });
    expect(mapHeaders(["Name", "Phone", "Email"])).toEqual({ name: 0, phone: 1, email: 2 });
  });
  it("satırı doğrular ve normalize eder", () => {
    const map = mapHeaders(["Ad", "Yetkili", "E-posta", "Değer", "Sıcaklık"]);
    const ok = parseLeadRow(["Mavi Tur", "Deniz", "d@x.co", "1.250,50", "Sıcak"], map);
    expect(ok).toEqual({
      ok: true,
      value: expect.objectContaining({ name: "Mavi Tur", contactName: "Deniz", estimatedValue: 1250.5, temperature: "hot" }),
    });
  });
  it("ad yoksa yetkili adı kullanılır; ikisi de yoksa hata", () => {
    const map = mapHeaders(["Ad", "Yetkili"]);
    expect(parseLeadRow(["", "Deniz Yılmaz"], map)).toMatchObject({ ok: true, value: { name: "Deniz Yılmaz", contactName: null } });
    expect(parseLeadRow(["", ""], map)).toMatchObject({ ok: false });
    expect(parseLeadRow(["A"], map)).toMatchObject({ ok: false });
  });
  it("geçersiz e-posta, değer ve sıcaklık satır hatası olur", () => {
    const map = mapHeaders(["Ad", "E-posta", "Değer", "Sıcaklık"]);
    expect(parseLeadRow(["Mavi", "yok", "", ""], map)).toMatchObject({ ok: false });
    expect(parseLeadRow(["Mavi", "", "abc", ""], map)).toMatchObject({ ok: false });
    expect(parseLeadRow(["Mavi", "", "", "kaynar"], map)).toMatchObject({ ok: false });
  });
  it("para yazımları", () => {
    expect(parseMoney("1.234,50")).toBe(1234.5);
    expect(parseMoney("1,234.50")).toBe(1234.5);
    expect(parseMoney("₺1.000")).toBe(1000);
    expect(parseMoney("1000")).toBe(1000);
    expect(parseMoney("12,5")).toBe(12.5);
    expect(parseMoney("1,000")).toBe(1000);
    expect(parseMoney("abc")).toBeNull();
  });
});
