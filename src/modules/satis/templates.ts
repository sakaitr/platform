import { whatsappNumber } from "./normalize";

/** Şablon yer tutucuları: `{firma} {ad} {hizmet} {sehir} {sektor}`. */
export const PLACEHOLDERS = ["firma", "ad", "hizmet", "sehir", "sektor"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export type TemplateVars = Partial<Record<Placeholder, string | null | undefined>>;

/**
 * Bilinen yer tutucuları doldurur; değer yoksa boş bırakır ve çevresindeki gereksiz boşluğu toplar.
 * Bilinmeyen `{...}` ifadesine dokunmaz (kullanıcının metni olabilir). Değerler metin olarak eklenir:
 * HTML/URL kaçışı çıktının kullanıldığı yerde (bağlantı kurarken) yapılır.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  const known = new Set<string>(PLACEHOLDERS);
  const filled = body.replace(/\{([a-z]+)\}/g, (match, key: string) => {
    if (!known.has(key)) return match;
    return vars[key as Placeholder]?.trim() ?? "";
  });
  // Boş değer yüzünden oluşan çift boşluk ve "boşluk + noktalama" kalıntısını temizle
  return filled.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/[ \t]+\n/g, "\n").trim();
}

/** Şablondaki tanınmayan yer tutucular (kullanıcıyı yazım hatasına karşı uyarmak için). */
export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  return [...new Set([...body.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]!))].filter((k) => !known.has(k));
}

/** `wa.me` bağlantısı. Numara geçersizse `null`. Metin URL için kodlanır. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const number = whatsappNumber(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

/** `tel:` bağlantısı: yalnız rakam ve baştaki `+` korunur. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  return /\d{7,}/.test(cleaned) ? `tel:${cleaned}` : null;
}

/** `mailto:` bağlantısı; konu ve gövde kodlanır. */
export function mailtoLink(email: string | null | undefined, subject: string | null | undefined, body: string): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return null;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  params.set("body", body);
  // URLSearchParams boşluğu "+" yapar; mailto için %20 gerekir
  return `mailto:${encodeURIComponent(email.trim())}?${params.toString().replace(/\+/g, "%20")}`;
}
