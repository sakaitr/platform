import { ALL_PERMISSIONS } from "@/lib/permissions";

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

export type PackRole = {
  key: string;
  label: string;
  /** 0 = en dar, 3 = en geniş. */
  hierarchyLevel: number;
  isSystem?: boolean;
  permissions: readonly string[];
};

export type PackPipelineStage = {
  key: string;
  label: string;
  kind: "open" | "won" | "lost";
  color?: string;
};

export type PackMessageTemplate = {
  name: string;
  channel: "whatsapp" | "email";
  subject?: string;
  body: string;
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
  /** Kurulacak varsayılan roller */
  roles: readonly PackRole[];
  /** Satış CRM varsayılanları: pipeline aşamaları ve örnek mesaj şablonları. */
  crmDefaults?: {
    stages: readonly PackPipelineStage[];
    templates: readonly PackMessageTemplate[];
  };
};

const COMMON_NUMBERING: readonly PackSequence[] = [
  { sequenceKey: "fatura", prefix: "FT", padding: 6, periodReset: "yearly" },
  { sequenceKey: "talep", prefix: "TLP", padding: 6, periodReset: "yearly" },
  { sequenceKey: "oneri", prefix: "ONR", padding: 6, periodReset: "yearly" },
  { sequenceKey: "uyari", prefix: "UYR", padding: 6, periodReset: "yearly" },
];

/** Her pakette bulunan çekirdek roller. Paket kendi rollerini üstüne ekler. */
const COMMON_ROLES: readonly PackRole[] = [
  { key: "owner", label: "Sahip", hierarchyLevel: 3, isSystem: true, permissions: ALL_PERMISSIONS },
  {
    key: "admin",
    label: "Yönetici",
    hierarchyLevel: 3,
    isSystem: true,
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("roles:")),
  },
  {
    key: "viewer",
    label: "İzleyici",
    hierarchyLevel: 0,
    isSystem: true,
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith(":read")),
  },
];

const SATIS_RESOURCES = [
  "satis_aday",
  "satis_firsat",
  "satis_aktivite",
  "satis_teklif",
  "satis_sablon",
] as const;

/** Yazma yetkisi: oluştur + güncelle (silme yok). */
const satisWrite = SATIS_RESOURCES.flatMap((r) => [`${r}:read`, `${r}:create`, `${r}:update`]);

/**
 * Sektör paketleri. Kod içinde tanımlı: versiyonlanır, tip güvenli, test edilir.
 * YENİ SEKTÖR EKLEMEK = buraya yeni kayıt. Modül kodu değişmez.
 */
export const SECTOR_PACKS: Record<string, SectorPack> = {
  turizm: {
    key: "turizm",
    name: "Turizm / Personel Taşıma",
    version: "1.0.0",
    modules: [
      "dashboard",
      "operasyon",
      "filo",
      "crm",
      "muhasebe",
      "gorevler",
      "destek",
      "ik",
      "raporlar",
      "admin",
    ],
    capabilities: [
      "muhasebe.hakedis",
      "muhasebe.mutabakat",
      "operasyon.cetele",
      "operasyon.rota_planlama",
      "operasyon.transfer",
    ],
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
    roles: [
      ...COMMON_ROLES,
      {
        key: "operasyon",
        label: "Operasyon",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "arrivals:read", "arrivals:create", "arrivals:update",
          "yolcular:read", "yolcular:create", "yolcular:update",
          "guzergahlar:read", "araclar:read", "firmalar:read",
          "ziyaretci:read", "ziyaretci:create", "gunluk:read", "gunluk:create",
          "raporlar:read",
        ],
      },
      {
        key: "muhasebe",
        label: "Muhasebe",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "finans_gider:read", "finans_gider:create", "finans_hareket:read",
          "hakedis:read", "cari:read", "raporlar:read", "raporlar:export",
        ],
      },
    ],
  },

  lojistik: {
    key: "lojistik",
    name: "Lojistik / Nakliye",
    version: "1.0.0",
    modules: [
      "dashboard",
      "operasyon",
      "filo",
      "crm",
      "muhasebe",
      "gorevler",
      "destek",
      "ik",
      "raporlar",
      "admin",
    ],
    capabilities: ["muhasebe.irsaliye", "operasyon.rota_planlama"],
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
    roles: [
      ...COMMON_ROLES,
      {
        key: "operasyon",
        label: "Operasyon",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "guzergahlar:read", "araclar:read", "transferler:read",
          "transferler:create", "raporlar:read",
        ],
      },
      {
        key: "muhasebe",
        label: "Muhasebe",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "finans_gider:read", "finans_gider:create",
          "cari:read", "raporlar:read", "raporlar:export",
        ],
      },
    ],
  },

  pilates: {
    key: "pilates",
    name: "Pilates / Fitness Stüdyo",
    version: "1.0.0",
    modules: ["dashboard", "crm", "muhasebe", "gorevler", "destek", "ik", "raporlar", "admin"],
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
    roles: [
      ...COMMON_ROLES,
      {
        key: "egitmen",
        label: "Eğitmen",
        hierarchyLevel: 1,
        permissions: ["dashboard:read", "musteriler:read", "raporlar:read"],
      },
    ],
  },

  oto_servis: {
    key: "oto_servis",
    name: "Oto Servis",
    version: "1.0.0",
    modules: ["dashboard", "crm", "muhasebe", "gorevler", "destek", "ik", "raporlar", "admin"],
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
    roles: [
      ...COMMON_ROLES,
      {
        key: "usta",
        label: "Usta",
        hierarchyLevel: 1,
        permissions: ["dashboard:read", "musteriler:read", "araclar:read"],
      },
    ],
  },

  satis_crm: {
    key: "satis_crm",
    name: "AtriCRM (Satış CRM)",
    version: "1.0.0",
    modules: ["dashboard", "crm", "satis", "raporlar", "admin"],
    capabilities: ["satis.teklif", "satis.entegrasyon"],
    terminology: {
      customer: "Müşteri",
      customer_plural: "Müşteriler",
      lead: "Aday",
      lead_plural: "Adaylar",
      deal: "Fırsat",
      deal_plural: "Fırsatlar",
    },
    entityFields: [],
    numbering: [{ sequenceKey: "teklif", prefix: "TKL", padding: 5, periodReset: "yearly" }],
    roles: [
      ...COMMON_ROLES,
      {
        key: "satis_yonetici",
        label: "Satış Yöneticisi",
        hierarchyLevel: 3,
        permissions: [
          "dashboard:read",
          "firmalar:read", "firmalar:create", "firmalar:update",
          "raporlar:read", "raporlar:export",
          ...ALL_PERMISSIONS.filter((p) => p.startsWith("satis_")),
        ],
      },
      {
        key: "satisci",
        label: "Satışçı",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "firmalar:read", "raporlar:read",
          ...satisWrite,
          "satis_asama:read",
        ],
      },
      {
        key: "satis_izleyici",
        label: "Satış İzleyici",
        hierarchyLevel: 0,
        permissions: [
          "dashboard:read", "firmalar:read", "raporlar:read",
          ...SATIS_RESOURCES.map((r) => `${r}:read`),
          "satis_hepsi:read", "satis_asama:read",
        ],
      },
    ],
    crmDefaults: {
      stages: [
        { key: "yeni", label: "Yeni", kind: "open", color: "#64748b" },
        { key: "gorusuldu", label: "Görüşüldü", kind: "open", color: "#0ea5e9" },
        { key: "teklif", label: "Teklif", kind: "open", color: "#f59e0b" },
        { key: "kazanildi", label: "Kazanıldı", kind: "won", color: "#10b981" },
        { key: "kaybedildi", label: "Kaybedildi", kind: "lost", color: "#ef4444" },
      ],
      templates: [
        {
          name: "Tanıştığımıza memnun oldum",
          channel: "whatsapp",
          body:
            "Merhaba {ad}, tanıştığımıza memnun oldum. {firma} için {hizmet} konusunda size nasıl yardımcı olabileceğimizi konuşmak isterim. Uygun olduğunuzda yazabilirsiniz.",
        },
        {
          name: "Teklif gönderimi",
          channel: "email",
          subject: "{firma} için teklifimiz",
          body:
            "Merhaba {ad},\n\n{hizmet} konusundaki görüşmemizin ardından teklifimizi iletiyorum. Sorularınız olursa memnuniyetle yanıtlarım.\n\nİyi çalışmalar.",
        },
      ],
    },
  },
};
