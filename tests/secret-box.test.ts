import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateWebhookSecret, SecretBoxError } from "@/lib/secret-box";

const MASTER = "master-key-for-tests-0123456789-abcdefghij";
const OTHER = "another-master-key-0123456789-abcdefghijkl";

describe("gizli anahtar kutusu (AES-256-GCM)", () => {
  it("gidiş-dönüş: şifreler ve çözer (Türkçe karakter dahil)", () => {
    for (const plain of ["whsec_abc123", "", "Şifreli çğıöşü İĞÜ 🔐", "x".repeat(5000)]) {
      const stored = encryptSecret(plain, "row-1", MASTER);
      expect(decryptSecret(stored, "row-1", MASTER)).toBe(plain);
    }
  });

  it("saklama biçimi v1:iv:etiket:şifreli ve düz metni içermez", () => {
    const stored = encryptSecret("whsec_gizli_deger", "row-1", MASTER);
    const parts = stored.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(stored).not.toContain("whsec_gizli_deger");
    expect(stored).not.toContain(Buffer.from("whsec_gizli_deger").toString("base64url"));
  });

  it("her şifreleme farklı IV üretir (aynı girdi, farklı çıktı)", () => {
    const a = encryptSecret("aynı", "row-1", MASTER);
    const b = encryptSecret("aynı", "row-1", MASTER);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
  });

  it("yanlış ana anahtarla çözülemez", () => {
    const stored = encryptSecret("whsec_x", "row-1", MASTER);
    expect(() => decryptSecret(stored, "row-1", OTHER)).toThrow(SecretBoxError);
    expect(() => decryptSecret(stored, "row-1", OTHER)).toThrow(/yeniden oluşturun/);
  });

  it("başka satırın kimliğiyle (AAD) çözülemez: şifreli değer satırlar arası kopyalanamaz", () => {
    const stored = encryptSecret("whsec_x", "row-1", MASTER);
    expect(() => decryptSecret(stored, "row-2", MASTER)).toThrow(SecretBoxError);
  });

  it("değiştirilmiş veri, etiket ya da IV çözülemez", () => {
    const stored = encryptSecret("whsec_x", "row-1", MASTER);
    const [v, iv, tag, data] = stored.split(":") as [string, string, string, string];
    const flip = (s: string): string => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(() => decryptSecret([v, iv, tag, flip(data)].join(":"), "row-1", MASTER)).toThrow(SecretBoxError);
    expect(() => decryptSecret([v, iv, flip(tag), data].join(":"), "row-1", MASTER)).toThrow(SecretBoxError);
    expect(() => decryptSecret([v, flip(iv), tag, data].join(":"), "row-1", MASTER)).toThrow(SecretBoxError);
  });

  it("biçimi bozuk ya da bilinmeyen sürüm reddedilir", () => {
    for (const bad of ["", "v1", "v1:a:b", "v2:a:b:c", "v1:a:b:c:d", "düz metin"]) {
      expect(() => decryptSecret(bad, "row-1", MASTER), bad).toThrow(SecretBoxError);
    }
  });

  it("hata mesajı düz metni ya da anahtarı sızdırmaz", () => {
    const stored = encryptSecret("whsec_cok_gizli", "row-1", MASTER);
    try {
      decryptSecret(stored, "row-1", OTHER);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("whsec_cok_gizli");
      expect(message).not.toContain(MASTER);
      expect(message).not.toContain(OTHER);
    }
  });

  it("ana anahtar yok ya da kısaysa açık hata verir, zayıf anahtara düşmez", () => {
    const saved = process.env.INTEGRATION_SECRET_KEY;
    try {
      delete process.env.INTEGRATION_SECRET_KEY;
      expect(() => encryptSecret("x", "r")).toThrow(/INTEGRATION_SECRET_KEY/);
      process.env.INTEGRATION_SECRET_KEY = "kisa";
      expect(() => encryptSecret("x", "r")).toThrow(/32 karakter/);
      expect(() => encryptSecret("x", "r", "kisa")).toThrow(/32 karakter/);
      // ortam değişkeni uygun olunca varsayılan olarak onu kullanır
      process.env.INTEGRATION_SECRET_KEY = MASTER;
      expect(decryptSecret(encryptSecret("ok", "r"), "r")).toBe("ok");
    } finally {
      if (saved === undefined) delete process.env.INTEGRATION_SECRET_KEY;
      else process.env.INTEGRATION_SECRET_KEY = saved;
    }
  });

  it("whsec_ anahtarı: önek, 64 hex karakter, benzersiz", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(50);
    for (const s of secrets) expect(s).toMatch(/^whsec_[0-9a-f]{64}$/);
  });
});
