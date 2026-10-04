/**
 * Tekilleştirme anahtarları. Aynı kişi telefonu "0532 000 00 00", "+90 532 000 0000" ya da
 * "905320000000" diye yazsa da aynı anahtara düşmeli. Saf fonksiyonlar: veritabanı gerekmez.
 */

/** Türkçe karakterleri sadeleştirip küçük harfe çevirir; harf/rakam dışını atar. */
export function foldText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Telefon anahtarı: yalnız rakam, ülke/trunk öneki atılmış.
 * 0090 / 90 / 0 önekleri Türkiye numarasından (10 hane) çıkarılır. 7 haneden kısa ya da
 * 15 haneden uzun değer anahtar üretmez (yanlış eşleşmeyi önler).
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("90") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(raw.trim());
}

export function emailKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

/** Web sitesi anahtarı: protokol, `www.`, yol ve sondaki eğik çizgi atılmış alan adı. */
export function websiteKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  return host.includes(".") && !/\s/.test(host) ? host : null;
}

/** Ad + şehir anahtarı. Şehir yoksa anahtar yok: yalnız ad eşleşmesi çok gevşek olur. */
export function nameKey(name: string | null | undefined, city: string | null | undefined): string | null {
  if (!name || !city) return null;
  const n = foldText(name);
  const c = foldText(city);
  return n && c ? `${n}|${c}` : null;
}

export type LeadKeys = {
  phoneKey: string | null;
  emailKey: string | null;
  websiteKey: string | null;
  nameKey: string | null;
};

export function buildLeadKeys(input: {
  name?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}): LeadKeys {
  return {
    phoneKey: phoneKey(input.phone),
    emailKey: emailKey(input.email),
    websiteKey: websiteKey(input.website),
    nameKey: nameKey(input.name, input.city),
  };
}

/** `wa.me` bağlantısı için uluslararası numara (başında `+` ve boşluk yok). */
export function whatsappNumber(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  if (!key) return null;
  // 10 haneli yerel numara Türkiye kabul edilir; daha uzunsa ülke kodu zaten vardır.
  return key.length === 10 ? `90${key}` : key;
}
