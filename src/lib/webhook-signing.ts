import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook imzası. Atricard ve AtriCRM aynı sözleşmeyi kullanır:
 *   imza = "sha256=" + hex(HMAC-SHA256(gizli_anahtar, `${zaman_damgası}.${ham_gövde}`))
 * Alıcı imzayı HAM gövde üzerinden, sabit zamanlı karşılaştırmayla doğrular; zaman damgası
 * 5 dakikadan eskiyse ya da gelecekteyse reddeder (tekrar saldırısı).
 */

export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function secondsNow(now: Date = new Date()): string {
  return String(Math.floor(now.getTime() / 1000));
}

/** `timingSafeEqual` eşit uzunluk ister; uzunluk farkı zaten imzanın yanlış olduğunu gösterir. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "timestamp" | "signature" };

export function verifySignature(input: {
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  now?: Date;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { timestamp, signature } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "timestamp" };

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const drift = Math.abs(nowSeconds - Number(timestamp));
  if (drift > (input.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS)) {
    return { ok: false, reason: "timestamp" };
  }
  const expected = signPayload(input.secret, timestamp, input.rawBody);
  return safeEqual(expected, signature.trim()) ? { ok: true } : { ok: false, reason: "signature" };
}
