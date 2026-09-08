/** Tutarlar string olarak taşınır (numeric). Float asla kullanılmaz. */

function toCents(value: string | number): bigint {
  const normalized = typeof value === "number" ? value.toFixed(2) : value.trim();
  const [whole, frac = ""] = normalized.split(".");
  const cents = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`;
  return BigInt(cents);
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatTRY(amount: string | number): string {
  const value = Number(typeof amount === "number" ? amount : amount.replace(",", "."));
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);
}

/** Yarıyı yukarı yuvarlar — muhasebe standardı. */
export function calcVat(net: string, ratePercent: string): { vat: string; gross: string } {
  const netCents = toCents(net);
  const rateBasis = toCents(ratePercent); // %20.00 -> 2000
  const vatCents = (netCents * rateBasis + 5000n) / 10000n;
  return { vat: fromCents(vatCents), gross: fromCents(netCents + vatCents) };
}

/** Tevkifat: KDV'nin belirtilen yüzdesi alıcıda kalır. */
export function calcWithholding(vat: string, ratePercent: string): string {
  const vatCents = toCents(vat);
  const rateBasis = toCents(ratePercent);
  return fromCents((vatCents * rateBasis + 5000n) / 10000n);
}

/** Tutar toplama. Float toplama kuruş kaybettirir; hep tam sayı sent üzerinden. */
export function addMoney(...values: readonly string[]): string {
  return fromCents(values.reduce((sum, v) => sum + toCents(v), 0n));
}

export function subMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

/** Tutar × adet. Adet tam sayı. */
export function multiplyMoney(amount: string, count: number): string {
  return fromCents(toCents(amount) * BigInt(Math.trunc(count)));
}

/** Yüzde uygula — yarıyı yukarı yuvarlar. */
export function percentOf(amount: string, ratePercent: string): string {
  const cents = toCents(amount);
  const basis = toCents(ratePercent);
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const result = (abs * basis + 5000n) / 10000n;
  return fromCents(negative ? -result : result);
}

export function compareMoney(a: string, b: string): number {
  const diff = toCents(a) - toCents(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

/**
 * KDV dahil brüt tutardan net tutarı çıkarır: net = brüt / (1 + oran/100).
 * Yarıyı yukarı yuvarlar; net + KDV her zaman brüte eşit olacak şekilde
 * kalan kuruş KDV'ye bırakılır.
 */
export function netFromGross(gross: string, ratePercent: string): string {
  const grossCents = toCents(gross);
  const rateBasis = toCents(ratePercent); // %20.00 -> 2000
  const denominator = 10000n + rateBasis;
  const negative = grossCents < 0n;
  const abs = negative ? -grossCents : grossCents;
  const net = (abs * 10000n + denominator / 2n) / denominator;
  return fromCents(negative ? -net : net);
}

/** Döviz kuru uygular — kur 6 haneye kadar ondalık olabilir. */
export function applyRate(amount: string, rate: string): string {
  const cents = toCents(amount);
  const [whole, frac = ""] = rate.trim().split(".");
  const scaled = BigInt(`${whole}${frac.padEnd(6, "0").slice(0, 6)}`); // 1.0 -> 1000000
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const result = (abs * scaled + 500000n) / 1000000n;
  return fromCents(negative ? -result : result);
}

/**
 * Miktar gösterimi: numeric sütun "12.00" döner, kullanıcı "12" bekler.
 * Ondalık anlamlıysa korunur ("12.50" → "12,5").
 */
export function formatQuantity(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const trimmed = value.replace(/\.?0+$/, "");
  return (trimmed === "" ? "0" : trimmed).replace(".", ",");
}
