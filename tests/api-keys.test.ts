import { describe, expect, it } from "vitest";
import { bearerToken, generateApiKey, hashSecret, parseApiKey, verifyApiKeySecret } from "@/lib/api-keys";

describe("API anahtarı", () => {
  it("biçim: atc_<8 hex>_<64 hex>; benzersiz; özet gizliyi içermez", () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey());
    expect(new Set(keys.map((k) => k.token)).size).toBe(50);
    for (const key of keys) {
      expect(key.token).toMatch(/^atc_[0-9a-f]{8}_[0-9a-f]{64}$/);
      expect(key.prefix).toHaveLength(8);
      expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(key.token).toContain(key.prefix);
      const secret = key.token.split("_")[2]!;
      expect(key.hash).not.toContain(secret);
      expect(key.hash).toBe(hashSecret(secret));
    }
  });

  it("ayrıştırma ve doğrulama gidiş-dönüşü", () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.token)!;
    expect(parsed.prefix).toBe(key.prefix);
    expect(verifyApiKeySecret(parsed.secret, key.hash)).toBe(true);
  });

  it("yanlış gizli, başka anahtarın özeti ve bozuk özet doğrulanmaz", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    const secretA = parseApiKey(a.token)!.secret;
    expect(verifyApiKeySecret(secretA, b.hash)).toBe(false);
    const flipped = secretA.slice(0, -1) + (secretA.endsWith("0") ? "1" : "0");
    expect(verifyApiKeySecret(flipped, a.hash)).toBe(false);
    expect(verifyApiKeySecret(secretA, "")).toBe(false);
    expect(verifyApiKeySecret(secretA, "abc")).toBe(false);
  });

  it("biçimi bozuk değerler ayrıştırılmaz (SQL/yol enjeksiyonu dahil)", () => {
    const good = generateApiKey().token;
    for (const bad of [
      "", " ", "atc_", "atc_1234_5678", good.toUpperCase(), good.replace("atc_", "xxx_"), `${good}0`, good.slice(0, -1),
      `${good}\n`.replace("\n", "x"), "atc_zzzzzzzz_" + "0".repeat(64), "' OR 1=1 --", "../../etc/passwd", good.replace("_", "-"),
    ]) {
      expect(parseApiKey(bad), bad).toBeNull();
    }
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey(undefined)).toBeNull();
    expect(parseApiKey(`  ${good}  `)).not.toBeNull(); // dış boşluk tolere edilir
  });

  it("Authorization başlığı: yalnız Bearer", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer abc123")).toBe("abc123");
    expect(bearerToken("Basic abc123")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});
