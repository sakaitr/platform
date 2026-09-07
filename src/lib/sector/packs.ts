export type PackField = {
  entityKey: string;
  fieldKey: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  options?: string[];
  required?: boolean;
  position: number;
};

export type PackSequence = {
  sequenceKey: string;
  prefix: string;
  padding: number;
  periodReset: "none" | "yearly" | "monthly";
};

export type SectorPack = {
  key: string;
  name: string;
  version: string;
  /** Kurulacak modüller */
  modules: readonly string[];
  /** Açılacak alt-yetenekler */
  capabilities: readonly string[];
  /** Terim ezmeleri — sistem varsayılanını ezer */
  terminology: Record<string, string>;
  /** Kurulacak özel alanlar */
  entityFields: readonly PackField[];
  /** Belge numarası dizileri */
  numbering: readonly PackSequence[];
};

const COMMON_NUMBERING: readonly PackSequence[] = [
  { sequenceKey: "fatura", prefix: "FT", padding: 6, periodReset: "yearly" },
];

/**
 * Sektör paketleri. Kod içinde tanımlı: versiyonlanır, tip güvenli, test edilir.
 * YENİ SEKTÖR EKLEMEK = buraya yeni kayıt. Modül kodu değişmez.
 */
export const SECTOR_PACKS: Record<string, SectorPack> = {
  turizm: {
    key: "turizm",
    name: "Turizm / Personel Taşıma",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "filo", "admin"],
    capabilities: ["muhasebe.hakedis", "muhasebe.mutabakat"],
    terminology: {
      customer: "Firma",
      customer_plural: "Firmalar",
      asset: "Araç",
      asset_plural: "Araçlar",
      staff: "Sürücü",
      staff_plural: "Sürücüler",
      service: "Sefer",
      service_plural: "Seferler",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
      { entityKey: "asset", fieldKey: "kapasite", label: "Koltuk Kapasitesi", type: "number", position: 1 },
    ],
    numbering: [
      ...COMMON_NUMBERING,
      { sequenceKey: "hakedis", prefix: "HK", padding: 6, periodReset: "yearly" },
    ],
  },

  lojistik: {
    key: "lojistik",
    name: "Lojistik / Nakliye",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "filo", "admin"],
    capabilities: ["muhasebe.irsaliye"],
    terminology: {
      customer: "Müşteri",
      customer_plural: "Müşteriler",
      asset: "Araç",
      asset_plural: "Araçlar",
      staff: "Şoför",
      staff_plural: "Şoförler",
      service: "Sevkiyat",
      service_plural: "Sevkiyatlar",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
      { entityKey: "invoice", fieldKey: "irsaliye_no", label: "İrsaliye No", type: "text", required: true, position: 1 },
      { entityKey: "invoice", fieldKey: "sevk_tarihi", label: "Sevk Tarihi", type: "date", position: 2 },
    ],
    numbering: [
      ...COMMON_NUMBERING,
      { sequenceKey: "irsaliye", prefix: "IR", padding: 6, periodReset: "yearly" },
    ],
  },

  pilates: {
    key: "pilates",
    name: "Pilates / Fitness Stüdyo",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "admin"],
    capabilities: ["randevu.paket", "randevu.bekleme_listesi"],
    terminology: {
      customer: "Üye",
      customer_plural: "Üyeler",
      appointment: "Ders",
      appointment_plural: "Dersler",
      staff: "Eğitmen",
      staff_plural: "Eğitmenler",
      resource: "Salon",
      resource_plural: "Salonlar",
      package: "Ders Paketi",
      package_plural: "Ders Paketleri",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "dogum_tarihi", label: "Doğum Tarihi", type: "date", position: 1 },
      { entityKey: "customer", fieldKey: "saglik_notu", label: "Sağlık Notu", type: "text", position: 2 },
    ],
    numbering: COMMON_NUMBERING,
  },

  oto_servis: {
    key: "oto_servis",
    name: "Oto Servis",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "admin"],
    capabilities: ["randevu.parca_stok", "randevu.proforma"],
    terminology: {
      customer: "Araç Sahibi",
      customer_plural: "Araç Sahipleri",
      appointment: "Servis Randevusu",
      appointment_plural: "Servis Randevuları",
      staff: "Usta",
      staff_plural: "Ustalar",
      resource: "Lift",
      resource_plural: "Liftler",
      package: "İş Emri",
      package_plural: "İş Emirleri",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "plaka", label: "Plaka", type: "text", required: true, position: 1 },
      { entityKey: "customer", fieldKey: "sasi_no", label: "Şasi No", type: "text", position: 2 },
    ],
    numbering: [
      ...COMMON_NUMBERING,
      { sequenceKey: "is_emri", prefix: "IE", padding: 6, periodReset: "yearly" },
    ],
  },
};
