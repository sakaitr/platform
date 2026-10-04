import { describe, expect, it } from "vitest";
import { mailtoLink, renderTemplate, telLink, unknownPlaceholders, whatsappLink } from "@/modules/satis/templates";

describe("şablon doldurma", () => {
  it("bilinen yer tutucuları doldurur", () => {
    expect(renderTemplate("Merhaba {ad}, {firma} için {hizmet}.", { ad: "Deniz", firma: "Mavi Tur", hizmet: "Web sitesi" })).toBe(
      "Merhaba Deniz, Mavi Tur için Web sitesi.",
    );
    expect(renderTemplate("{sehir} / {sektor}", { sehir: "Ankara", sektor: "Turizm" })).toBe("Ankara / Turizm");
  });
  it("eksik değer boş kalır, boşluk ve noktalama düzelir", () => {
    expect(renderTemplate("Merhaba {ad}, hoş geldiniz.", {})).toBe("Merhaba, hoş geldiniz.");
    expect(renderTemplate("{firma} için {hizmet} teklifi", { firma: "Mavi" })).toBe("Mavi için teklifi");
    expect(renderTemplate("Merhaba {ad}", { ad: "   " })).toBe("Merhaba");
  });
  it("bilinmeyen yer tutucuya ve süslü parantezli metne dokunmaz", () => {
    expect(renderTemplate("Kod: {kupon} ve {ad}", { ad: "A" })).toBe("Kod: {kupon} ve A");
    expect(renderTemplate("{ad} { ad } {AD}", { ad: "A" })).toBe("A { ad } {AD}");
  });
  it("değer içindeki yer tutucu tekrar işlenmez (enjeksiyon yok)", () => {
    expect(renderTemplate("{ad} - {firma}", { ad: "{firma}", firma: "X" })).toBe("{firma} - X");
  });
  it("satır sonlarını korur", () => {
    expect(renderTemplate("Merhaba {ad},\n\nTeklif ekte.\n", { ad: "Deniz" })).toBe("Merhaba Deniz,\n\nTeklif ekte.");
  });
  it("tanınmayan yer tutucuları bulur", () => {
    expect(unknownPlaceholders("{ad} {firma} {kupon} {kupon} {Tarih}")).toEqual(["kupon", "Tarih"]);
    expect(unknownPlaceholders("düz metin")).toEqual([]);
  });
});

describe("bağlantılar", () => {
  it("wa.me: yerel numaraya 90 eklenir, metin kodlanır", () => {
    expect(whatsappLink("0532 000 00 00", "Merhaba Deniz & ekibi?")).toBe(
      "https://wa.me/905320000000?text=Merhaba%20Deniz%20%26%20ekibi%3F",
    );
    expect(whatsappLink("yok", "x")).toBeNull();
    expect(whatsappLink(null, "x")).toBeNull();
  });
  it("tel: yalnız rakam ve +", () => {
    expect(telLink("+90 (532) 000-00-00")).toBe("tel:+905320000000");
    expect(telLink("abc")).toBeNull();
    expect(telLink("123")).toBeNull();
    expect(telLink(null)).toBeNull();
  });
  it("mailto: konu ve gövde %20 ile kodlanır; geçersiz adres null", () => {
    const link = mailtoLink("a@b.co", "Teklif & bilgi", "Merhaba\nDeniz")!;
    expect(link.startsWith("mailto:a%40b.co?")).toBe(true);
    expect(link).toContain("subject=Teklif%20%26%20bilgi");
    expect(link).toContain("body=Merhaba%0ADeniz");
    expect(link).not.toContain("+");
    expect(mailtoLink("bozuk", "x", "y")).toBeNull();
    expect(mailtoLink(null, "x", "y")).toBeNull();
  });
});
