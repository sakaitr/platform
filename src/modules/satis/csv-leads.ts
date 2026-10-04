import { foldText, isValidEmail } from "./normalize";

/** CSV başlıklarının aday alanına eşlemesi. Başlıklar `foldText` ile sadeleştirilip aranır. */
export type LeadCsvField =
  | "name"
  | "contactName"
  | "phone"
  | "email"
  | "website"
  | "city"
  | "sector"
  | "message"
  | "service"
  | "note"
  | "estimatedValue"
  | "temperature";

const ALIASES: Record<LeadCsvField, readonly string[]> = {
  name: ["ad", "adi", "isim", "firma", "firmaadi", "unvan", "sirket", "sirketadi", "name", "company", "companyname"],
  contactName: ["yetkili", "yetkilikisi", "kisi", "ilgilikisi", "irtibat", "contact", "contactname"],
  phone: ["telefon", "tel", "gsm", "cep", "ceptelefonu", "phone", "mobile"],
  email: ["eposta", "email", "mail", "epostaadresi"],
  website: ["web", "websitesi", "website", "site", "internetsitesi", "url"],
  city: ["sehir", "il", "city"],
  sector: ["sektor", "sector"],
  message: ["mesaj", "message"],
  service: ["hizmet", "ilgilendigihizmet", "service"],
  note: ["not", "notlar", "note", "notes"],
  estimatedValue: ["tahminideger", "deger", "tutar", "value"],
  temperature: ["sicaklik", "temperature"],
};

export function mapHeaders(headers: readonly string[]): Partial<Record<LeadCsvField, number>> {
  const map: Partial<Record<LeadCsvField, number>> = {};
  headers.forEach((header, index) => {
    const folded = foldText(header);
    for (const [field, aliases] of Object.entries(ALIASES) as [LeadCsvField, readonly string[]][]) {
      if (map[field] === undefined && aliases.includes(folded)) {
        map[field] = index;
        return;
      }
    }
  });
  return map;
}

const TEMPERATURE_ALIASES: Record<string, "hot" | "warm" | "cold"> = {
  hot: "hot", sicak: "hot", warm: "warm", ilik: "warm", cold: "cold", soguk: "cold",
};

/** "1.234,50", "1234.5", "₺1.000" gibi yazımları sayıya çevirir. Geçersizse null. */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = /,\d{1,2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if ((cleaned.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export type ParsedLeadRow = {
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  sector: string | null;
  message: string | null;
  service: string | null;
  note: string | null;
  estimatedValue: number | null;
  temperature: "hot" | "warm" | "cold" | null;
};

export type RowResult = { ok: true; value: ParsedLeadRow } | { ok: false; error: string };

/** Tek satırı doğrular. Satır hatası içe aktarmayı durdurmaz, rapora yazılır. */
export function parseLeadRow(
  row: readonly string[],
  columns: Partial<Record<LeadCsvField, number>>,
): RowResult {
  const get = (field: LeadCsvField): string | null => {
    const index = columns[field];
    const value = index === undefined ? "" : (row[index] ?? "").trim();
    return value === "" ? null : value;
  };

  const contactName = get("contactName");
  const name = get("name") ?? contactName;
  if (!name || name.length < 2) return { ok: false, error: "Ad boş ya da çok kısa." };

  const email = get("email");
  if (email && !isValidEmail(email)) return { ok: false, error: `E-posta geçersiz: ${email}` };

  const moneyRaw = get("estimatedValue");
  const estimatedValue = moneyRaw === null ? null : parseMoney(moneyRaw);
  if (moneyRaw !== null && estimatedValue === null) {
    return { ok: false, error: `Tahmini değer sayı değil: ${moneyRaw}` };
  }

  const tempRaw = get("temperature");
  const temperature = tempRaw ? (TEMPERATURE_ALIASES[foldText(tempRaw)] ?? null) : null;
  if (tempRaw && !temperature) return { ok: false, error: `Sıcaklık tanınmadı: ${tempRaw}` };

  return {
    ok: true,
    value: {
      name,
      contactName: contactName && contactName !== name ? contactName : null,
      phone: get("phone"),
      email,
      website: get("website"),
      city: get("city"),
      sector: get("sector"),
      message: get("message"),
      service: get("service"),
      note: get("note"),
      estimatedValue,
      temperature,
    },
  };
}
