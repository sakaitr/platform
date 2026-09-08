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
