/**
 * Teklif hesabı. Platform kuralı: para birimi float değildir. Tutarlar `"1250.50"` biçiminde metin,
 * hesap tamsayı kuruş (ve adet için binde bir) üzerinden. Sunucu toplamı HER ZAMAN kalemlerden
 * yeniden hesaplar; istemciden gelen toplam hiçbir yerde kullanılmaz.
 */

export type QuoteItem = {
  name: string;
  /** Adet, en çok 3 ondalık: "1", "2.5" */
  qty: string;
  /** Birim fiyat (KDV hariç), en çok 2 ondalık */
  unitPrice: string;
  /** KDV oranı yüzde olarak: "20", "10", "1", "0" */
  vatRate: string;
};

export const MAX_ITEMS = 100;
export const MAX_QTY = "1000000";
export const MAX_UNIT_PRICE = "100000000"; // 100 milyon

/**
 * Türkçe yazımlı sayıyı `.` ondalıklı metne çevirir. Kurallar kesindir, tahmin yok:
 * - `,` ondalık, `.` binlik ayracıdır ("1.250,50" → 1250.50; "12,5" → 12.5).
 * - İki ayraç birlikteyse sonuncusu ondalıktır ("1,250.50" → 1250.50).
 * - Tek `.` ve sonunda tam 3 hane varsa binliktir ("1.000" → 1000); 1-2 hane ise ondalık
 *   kabul edilir ("1250.5"); başı "0" ise ondalıktır ("0.125").
 * - Birden çok `,` geçersizdir. `maxDecimals` aşılırsa `null`: sessizce yuvarlanmaz.
 */
export function parseDecimal(raw: string, maxDecimals: number): string | null {
  const text = raw.trim().replace(/\s/g, "").replace(/[₺$€]|TL|TRY/gi, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;

  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  let whole: string;
  let frac = "";

  if (commas >= 1 && dots >= 1 && text.lastIndexOf(".") > text.lastIndexOf(",")) {
    // İngilizce yazım: "1,250.50"
    const at = text.lastIndexOf(".");
    const head = text.slice(0, at);
    if (!/^\d{1,3}(,\d{3})+$/.test(head) || text.slice(at + 1).includes(",")) return null;
    whole = head.replace(/,/g, "");
    frac = text.slice(at + 1);
  } else if (commas > 1) {
    return null;
  } else if (commas === 1) {
    const [head, tail] = text.split(",") as [string, string];
    whole = head.replace(/\./g, "");
    frac = tail;
    if (tail.includes(".")) return null; // "1,2.5" belirsiz
    if (dots > 0 && !/^\d{1,3}(\.\d{3})*$/.test(head)) return null; // binlik gruplar düzgün olmalı
  } else if (dots > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(text)) return null;
    whole = text.replace(/\./g, "");
  } else if (dots === 1) {
    const [head, tail] = text.split(".") as [string, string];
    if (tail.length === 3 && head !== "0") {
      whole = head + tail; // binlik
    } else {
      whole = head;
      frac = tail;
    }
  } else {
    whole = text;
  }

  if (!/^\d+$/.test(whole) || (frac !== "" && !/^\d+$/.test(frac))) return null;
  if (frac.length > maxDecimals) return null;
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  return frac === "" ? normalizedWhole : `${normalizedWhole}.${frac}`;
}

const toBig = (value: string, decimals: number): bigint => {
  const [whole = "0", frac = ""] = value.split(".");
  return BigInt(`${whole}${frac.padEnd(decimals, "0").slice(0, decimals)}`);
};

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Kalem net tutarı (kuruş): birim fiyat × adet, yarıyı yukarı yuvarlar. */
export function lineNetCents(item: Pick<QuoteItem, "qty" | "unitPrice">): bigint {
  return (toBig(item.unitPrice, 2) * toBig(item.qty, 3) + 500n) / 1000n;
}

export type QuoteTotals = {
  lines: { net: string }[];
  subtotal: string;
  vatByRate: { rate: string; base: string; vat: string }[];
  vatTotal: string;
  total: string;
};

/** Oran metnini karşılaştırma için normalleştirir: "20.0" ve "20" aynı grup. */
function rateKey(rate: string): string {
  const [whole = "0", frac = ""] = rate.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/**
 * Toplamlar: KDV oran grubu üzerinden hesaplanır (faturadaki gibi, her oran için taban × oran
 * bir kez yuvarlanır), kalem bazında yuvarlama birikimi olmaz.
 */
export function computeQuote(items: readonly QuoteItem[]): QuoteTotals {
  const lines = items.map((item) => ({ net: lineNetCents(item) }));
  const groups = new Map<string, bigint>();
  items.forEach((item, i) => {
    const key = rateKey(item.vatRate);
    groups.set(key, (groups.get(key) ?? 0n) + lines[i]!.net);
  });

  let subtotal = 0n;
  let vatTotal = 0n;
  const vatByRate = [...groups.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([rate, base]) => {
      const vat = (base * toBig(rate, 2) + 5000n) / 10000n;
      subtotal += base;
      vatTotal += vat;
      return { rate, base: fromCents(base), vat: fromCents(vat) };
    });

  return {
    lines: lines.map((l) => ({ net: fromCents(l.net) })),
    subtotal: fromCents(subtotal),
    vatByRate,
    vatTotal: fromCents(vatTotal),
    total: fromCents(subtotal + vatTotal),
  };
}

/** Kalem listesini doğrular; ilk hatayı Türkçe döner. */
export function validateItems(items: readonly QuoteItem[]): string | null {
  if (items.length === 0) return "Teklifte en az bir kalem olmalı.";
  if (items.length > MAX_ITEMS) return `Teklifte en fazla ${MAX_ITEMS} kalem olabilir.`;
  for (const [index, item] of items.entries()) {
    const row = `Kalem ${index + 1}`;
    if (!item.name.trim()) return `${row}: ad boş olamaz.`;
    if (item.name.trim().length > 255) return `${row}: ad en fazla 255 karakter olabilir.`;
    const qty = parseDecimal(item.qty, 3);
    if (qty === null || toBig(qty, 3) <= 0n) return `${row}: adet sıfırdan büyük bir sayı olmalı (en çok 3 ondalık).`;
    if (toBig(qty, 3) > toBig(MAX_QTY, 3)) return `${row}: adet çok büyük.`;
    const price = parseDecimal(item.unitPrice, 2);
    if (price === null) return `${row}: birim fiyat sayı olmalı (en çok 2 ondalık).`;
    if (toBig(price, 2) > toBig(MAX_UNIT_PRICE, 2)) return `${row}: birim fiyat çok büyük.`;
    const rate = parseDecimal(item.vatRate, 2);
    if (rate === null || toBig(rate, 2) > 10000n) return `${row}: KDV oranı 0 ile 100 arasında olmalı.`;
  }
  return null;
}

/** Form girdisini (TR yazımlı) standart `QuoteItem`'a çevirir; geçersizse hata döner. */
export function normalizeItems(
  raw: readonly { name: string; qty: string; unitPrice: string; vatRate: string }[],
): { ok: true; items: QuoteItem[] } | { ok: false; error: string } {
  const error = validateItems(raw);
  if (error) return { ok: false, error };
  return {
    ok: true,
    items: raw.map((r) => ({
      name: r.name.trim(),
      qty: parseDecimal(r.qty, 3)!,
      unitPrice: parseDecimal(r.unitPrice, 2)!,
      vatRate: parseDecimal(r.vatRate, 2)!,
    })),
  };
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";

const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Yalnız taslak düzenlenir; gönderilmiş teklif için "yeni sürüm" (kopya) gerekir. */
export function isEditable(status: QuoteStatus): boolean {
  return status === "draft";
}

/** Gösterim: "1250.50" → "1.250,50". */
export function formatAmount(value: string): string {
  const negative = value.startsWith("-");
  const [whole = "0", frac = "00"] = value.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac.padEnd(2, "0").slice(0, 2)}`;
}

/** Adet gösterimi: "2.500" → "2,5", "3.000" → "3". */
export function formatQty(value: string): string {
  const [whole = "0", frac = ""] = value.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole;
}

/**
 * Saklanan (standart) kalemi düzenleyiciye TR yazımıyla verir. Standart "2.500" (= 2,5) metni
 * `parseDecimal`'e olduğu gibi girerse binlik sanılıp 2500 olurdu; gidiş-dönüş bu yüzden TR biçiminde yapılır.
 */
export function toEditorItem(item: QuoteItem): QuoteItem {
  const trim = (value: string): string => {
    const [whole = "0", frac = ""] = value.split(".");
    const kept = frac.replace(/0+$/, "");
    return kept ? `${whole},${kept}` : whole;
  };
  const [pw = "0", pf = "00"] = item.unitPrice.split(".");
  return {
    name: item.name,
    qty: trim(item.qty),
    unitPrice: `${pw},${pf.padEnd(2, "0")}`,
    vatRate: trim(item.vatRate),
  };
}
