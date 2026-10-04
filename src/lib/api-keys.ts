import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API anahtarı biçimi: `atc_<önek>_<gizli>`.
 * - önek: 8 onaltılık karakter, açık saklanır; anahtarı satırda bulmak ve listede tanıtmak içindir.
 * - gizli: 32 rastgele bayt (64 hex). Yalnız SHA-256 özeti saklanır; yüksek entropili olduğu için
 *   yavaş hash gerekmez. Anahtarın tamamı yalnız oluşturulurken bir kez gösterilir.
 */

export const API_KEY_PREFIX = "atc";
const TOKEN_RE = /^atc_([0-9a-f]{8})_([0-9a-f]{64})$/;

export type GeneratedKey = { token: string; prefix: string; hash: string };

export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

export function generateApiKey(): GeneratedKey {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("hex");
  return { token: `${API_KEY_PREFIX}_${prefix}_${secret}`, prefix, hash: hashSecret(secret) };
}

/** Biçim geçersizse `null`. Başlıktan gelen değer hiçbir zaman olduğu gibi sorguya girmez. */
export function parseApiKey(token: string | null | undefined): { prefix: string; secret: string } | null {
  const match = TOKEN_RE.exec((token ?? "").trim());
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), "utf8");
  const b = Buffer.from(storedHash, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `Authorization: Bearer <anahtar>` başlığından anahtarı çıkarır. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  return match ? match[1]! : null;
}

export const API_SCOPES = ["leads:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
