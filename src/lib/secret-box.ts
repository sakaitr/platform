import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Entegrasyon gizli anahtarlarının saklanması.
 *
 * HMAC imzası için ham anahtar gerekir, bu yüzden hash değil ŞİFRELİ saklanır:
 * `INTEGRATION_SECRET_KEY` ortam değişkeninden HKDF-SHA256 ile 32 baytlık anahtar türetilir,
 * AES-256-GCM ile şifrelenir. Saklama biçimi: `v1:<iv>:<etiket>:<şifreli>` (base64url).
 *
 * Satır kimliği AAD (ek doğrulanan veri) olarak bağlanır: bir satırın şifreli değeri başka bir
 * satıra kopyalanırsa çözülemez.
 *
 * DİKKAT: `INTEGRATION_SECRET_KEY` değişirse mevcut anahtarlar ÇÖZÜLEMEZ. Yönetici
 * "yeniden oluştur" yapıp yeni anahtarı alıcıya girmelidir. Ortam değişkeni tanımsız ya da
 * 32 karakterden kısaysa çalışmak yerine açıkça hata verir (sessizce zayıf anahtara düşmez).
 */

const VERSION = "v1";
const HKDF_SALT = "atricrm-integration-secret-salt-v1";
const HKDF_INFO = "atricrm-integration-secret-key";
export const MIN_MASTER_KEY_LENGTH = 32;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function deriveKey(master: string | undefined): Buffer {
  const value = master ?? process.env.INTEGRATION_SECRET_KEY;
  if (!value || value.length < MIN_MASTER_KEY_LENGTH) {
    throw new SecretBoxError(
      `INTEGRATION_SECRET_KEY tanımlı değil ya da ${MIN_MASTER_KEY_LENGTH} karakterden kısa. Örnek üretim: openssl rand -base64 48`,
    );
  }
  return Buffer.from(hkdfSync("sha256", value, HKDF_SALT, HKDF_INFO, 32));
}

const b64 = (buffer: Buffer): string => buffer.toString("base64url");

export function encryptSecret(plain: string, aad: string, masterKey?: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(encrypted)].join(":");
}

/** Yanlış anahtar, değişmiş veri ya da yanlış AAD'de `SecretBoxError` fırlatır (ayrıntı sızdırmaz). */
export function decryptSecret(stored: string, aad: string, masterKey?: string): string {
  const key = deriveKey(masterKey);
  const [version, iv, tag, data, ...rest] = stored.split(":");
  if (version !== VERSION || !iv || !tag || data === undefined || rest.length > 0) {
    throw new SecretBoxError("Saklanan anahtar biçimi tanınmıyor.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError(
      "Anahtar çözülemedi. INTEGRATION_SECRET_KEY değişmiş olabilir; anahtarı yeniden oluşturun.",
    );
  }
}

/** Yeni imza anahtarı: `whsec_` + 32 rastgele bayt (hex). Yalnız oluşturulurken bir kez gösterilir. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}
