import { addMoney, calcVat, multiplyMoney, percentOf, subMoney } from "@/lib/money";

export type EarningInput = {
  /** Sefer başı brüt ücret. */
  unitPrice: string;
  tripCount: number;
  vatRate: string;
  /** Tevkifat oranı — KDV'nin yüzde kaçı alıcıda kalır. */
  withholdingRate: string;
  /** Yakıt kredisi, avans mahsubu gibi kesintiler. */
  deductions?: string;
};

export type EarningBreakdown = {
  gross: string;
  vat: string;
  withholding: string;
  deductions: string;
  net: string;
};

/**
 * Hakediş zinciri: brüt → KDV → tevkifat → kesinti → net.
 *
 * Türkiye'de taşımacılıkta tevkifat, KDV'nin bir kısmının alıcı tarafından
 * doğrudan vergi dairesine yatırılmasıdır; işletene ödenmez. Bu yüzden
 * net = brüt + KDV − tevkifat − kesintiler.
 *
 * Tüm aritmetik kuruş tam sayısı üzerinden; float kullanılmaz.
 */
export function calcEarning(input: EarningInput): EarningBreakdown {
  const gross = multiplyMoney(input.unitPrice, input.tripCount);
  const { vat } = calcVat(gross, input.vatRate);
  const withholding = percentOf(vat, input.withholdingRate);
  const deductions = input.deductions ?? "0.00";

  const withVat = addMoney(gross, vat);
  const afterWithholding = subMoney(withVat, withholding);
  const net = subMoney(afterWithholding, deductions);

  return { gross, vat, withholding, deductions, net };
}
