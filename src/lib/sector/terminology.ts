import { eq } from "drizzle-orm";
import { terminologyOverrides } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Sistem varsayılan terimleri. Sektör paketi bunları ezer,
 * kiracı da paketi ezer. UI'da sabit metin yerine t("...") kullanılır.
 */
export const SYSTEM_TERMS: Record<string, string> = {
  customer: "Müşteri",
  customer_plural: "Müşteriler",
  resource: "Kaynak",
  resource_plural: "Kaynaklar",
  appointment: "Randevu",
  appointment_plural: "Randevular",
  service: "Hizmet",
  service_plural: "Hizmetler",
  package: "Paket",
  package_plural: "Paketler",
  staff: "Personel",
  staff_plural: "Personeller",
  asset: "Varlık",
  asset_plural: "Varlıklar",
  document: "Belge",
  document_plural: "Belgeler",
};

export type Terms = {
  t: (key: string) => string;
  all: Record<string, string>;
};

/** Çözüm sırası: kiracı ezmesi → paket varsayılanı → sistem varsayılanı → anahtarın kendisi. */
export async function getTerms(
  tenantId: string,
  packTerms: Record<string, string>,
): Promise<Terms> {
  const overrides = await withTenant(tenantId, (tx) =>
    tx
      .select({ termKey: terminologyOverrides.termKey, value: terminologyOverrides.value })
      .from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId)),
  );

  const all: Record<string, string> = { ...SYSTEM_TERMS, ...packTerms };
  for (const row of overrides) all[row.termKey] = row.value;

  return { t: (key: string): string => all[key] ?? key, all };
}
