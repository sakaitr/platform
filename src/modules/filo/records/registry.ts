import { z } from "zod";
import {
  fuelCards,
  fuelPurchases,
  inspections,
  vehicleAccidents,
  vehicleBreakdowns,
  vehicleDocuments,
  vehicleInsurances,
  vehicleMaintenance,
  vehiclePenalties,
  vehicleTires,
} from "@/db/schema";
import type { FiloRecordDef } from "./types";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .catch(null);

const uuidOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Geçersiz seçim.");

const requiredUuid = z.string().uuid("Araç seçin.");

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin.");

const dayOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz.");

const intOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : Number(v)))
  .nullable()
  .refine((v) => v === null || Number.isInteger(v), "Tam sayı girin.");

const decimalOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
  .nullable()
  .refine((v) => v === null || Number.isFinite(Number(v)), "Sayı girin.");

const bool = z.coerce.boolean().catch(false);

/** Her kayıt tipinde ortak: araç seçimi. */
const vehicleField = (o: { vehicles: readonly { value: string; label: string }[]; terms: (k: string) => string }) =>
  ({
    name: "vehicleId",
    label: o.terms("asset"),
    type: "select" as const,
    required: true,
    options: o.vehicles,
  });

const driverField = (o: { drivers: readonly { value: string; label: string }[]; terms: (k: string) => string }) =>
  ({ name: "driverId", label: o.terms("staff"), type: "select" as const, options: o.drivers });

export const FILO_RECORDS: Record<string, FiloRecordDef> = {
  bakim: {
    key: "bakim",
    label: "Bakım",
    plural: "Bakımlar",
    description: "Periyodik ve arıza bakımları; sonraki bakım km/tarihi uyarı üretir",
    permission: "bakim",
    dateField: "maintenanceDate",
    defaults: { status: "yapildi", type: "periyodik" },
    schema: z.object({
      vehicleId: requiredUuid,
      type: z.string().trim().min(1, "Bakım tipi gerekli.").max(50),
      maintenanceDate: day,
      kmAtService: intOrNull,
      nextServiceKm: intOrNull,
      nextServiceDate: dayOrNull,
      cost: decimalOrNull,
      technician: text(255),
      status: z.enum(["planlandi", "yapildi", "iptal"]).catch("yapildi"),
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      { name: "type", label: "Bakım Tipi", type: "text", required: true, hint: "periyodik, yağ, fren, arıza…" },
      { name: "maintenanceDate", label: "Tarih", type: "date", required: true },
      {
        name: "status",
        label: "Durum",
        type: "select",
        options: [
          { value: "planlandi", label: "Planlandı" },
          { value: "yapildi", label: "Yapıldı" },
          { value: "iptal", label: "İptal" },
        ],
      },
      { name: "kmAtService", label: "Bakım KM", type: "number" },
      { name: "nextServiceKm", label: "Sonraki Bakım KM", type: "number" },
      { name: "nextServiceDate", label: "Sonraki Bakım Tarihi", type: "date" },
      { name: "cost", label: "Tutar (₺)", type: "text" },
      { name: "technician", label: "Servis / Usta", type: "text" },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "maintenanceDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "type", label: "Tip" },
      { key: "kmAtService", label: "KM", format: "number" },
      { key: "nextServiceDate", label: "Sonraki", format: "expiry", warnDays: 30 },
      { key: "cost", label: "Tutar", format: "money" },
      {
        key: "status",
        label: "Durum",
        format: "badge",
        tone: { planlandi: "info", yapildi: "ok", iptal: "mute" },
        labels: { planlandi: "Planlandı", yapildi: "Yapıldı", iptal: "İptal" },
      },
    ],
  },

  belgeler: {
    key: "belgeler",
    label: "Belge",
    plural: "Belgeler",
    description: "Ruhsat, muayene, K belgesi; bitiş tarihi yaklaşan belgeler kırmızı işaretlenir",
    permission: "belgeler",
    dateField: "expiresOn",
    schema: z.object({
      vehicleId: requiredUuid,
      docType: z.string().trim().min(1, "Belge tipi gerekli.").max(50),
      label: text(200),
      issuedOn: dayOrNull,
      expiresOn: dayOrNull,
      fileUrl: text(1000),
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      { name: "docType", label: "Belge Tipi", type: "text", required: true, hint: "ruhsat, muayene, K belgesi…" },
      { name: "label", label: "Açıklama", type: "text" },
      { name: "issuedOn", label: "Veriliş", type: "date" },
      { name: "expiresOn", label: "Bitiş", type: "date" },
      { name: "fileUrl", label: "Dosya Bağlantısı", type: "text", wide: true },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "plate", label: "Araç" },
      { key: "docType", label: "Tip" },
      { key: "label", label: "Açıklama" },
      { key: "issuedOn", label: "Veriliş", format: "date" },
      { key: "expiresOn", label: "Bitiş", format: "expiry", warnDays: 30 },
    ],
  },

  denetimler: {
    key: "denetimler",
    label: "Denetim",
    plural: "Denetimler",
    description: "Araç denetimleri ve sonuçları",
    permission: "denetimler",
    dateField: "inspectionDate",
    defaults: { result: "bekliyor", type: "rutin" },
    schema: z.object({
      vehicleId: requiredUuid,
      inspectionDate: day,
      type: z.string().trim().min(1).max(50),
      result: z.enum(["bekliyor", "gecti", "kaldi", "sartli"]).catch("bekliyor"),
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      { name: "inspectionDate", label: "Tarih", type: "date", required: true },
      { name: "type", label: "Denetim Tipi", type: "text", required: true, hint: "rutin, ani, müşteri…" },
      {
        name: "result",
        label: "Sonuç",
        type: "select",
        options: [
          { value: "bekliyor", label: "Bekliyor" },
          { value: "gecti", label: "Geçti" },
          { value: "sartli", label: "Şartlı" },
          { value: "kaldi", label: "Kaldı" },
        ],
      },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "inspectionDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "type", label: "Tip" },
      {
        key: "result",
        label: "Sonuç",
        format: "badge",
        tone: { bekliyor: "warn", gecti: "ok", sartli: "info", kaldi: "bad" },
        labels: { bekliyor: "Bekliyor", gecti: "Geçti", sartli: "Şartlı", kaldi: "Kaldı" },
      },
      { key: "notes", label: "Not" },
    ],
  },

  kazalar: {
    key: "kazalar",
    label: "Kaza",
    plural: "Kazalar",
    description: "Kaza kayıtları ve kusur oranları",
    permission: "filo_kaza",
    dateField: "accidentDate",
    defaults: { status: "acik" },
    schema: z.object({
      vehicleId: requiredUuid,
      driverId: uuidOrNull,
      accidentDate: day,
      km: intOrNull,
      kind: text(100),
      form: text(100),
      documentNo: text(50),
      faultPercent: decimalOrNull,
      status: z.enum(["acik", "kapali"]).catch("acik"),
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      driverField(o),
      { name: "accidentDate", label: "Tarih", type: "date", required: true },
      { name: "km", label: "Araç KM", type: "number" },
      { name: "kind", label: "Kaza Türü", type: "text" },
      { name: "form", label: "Kaza Şekli", type: "text" },
      { name: "documentNo", label: "Belge No", type: "text" },
      { name: "faultPercent", label: "Kusur Oranı (%)", type: "text" },
      {
        name: "status",
        label: "Durum",
        type: "select",
        options: [
          { value: "acik", label: "Açık" },
          { value: "kapali", label: "Kapalı" },
        ],
      },
      { name: "notes", label: "Açıklama", type: "textarea", wide: true },
    ],
    columns: [
      { key: "accidentDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "driverName", label: "Sürücü" },
      { key: "kind", label: "Tür" },
      { key: "faultPercent", label: "Kusur %", format: "number" },
      {
        key: "status",
        label: "Durum",
        format: "badge",
        tone: { acik: "warn", kapali: "mute" },
        labels: { acik: "Açık", kapali: "Kapalı" },
      },
    ],
  },

  cezalar: {
    key: "cezalar",
    label: "Ceza",
    plural: "Cezalar",
    description: "Trafik cezaları ve ödeme durumu",
    permission: "filo_ceza",
    dateField: "penaltyDate",
    schema: z.object({
      vehicleId: requiredUuid,
      driverId: uuidOrNull,
      penaltyDate: day,
      referenceNo: text(100),
      documentNo: text(50),
      points: intOrNull,
      amount: decimalOrNull,
      kind: text(100),
      isPaid: bool,
      paidAt: dayOrNull,
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      driverField(o),
      { name: "penaltyDate", label: "Ceza Tarihi", type: "date", required: true },
      { name: "kind", label: "Ceza Türü", type: "text" },
      { name: "referenceNo", label: "Referans No", type: "text" },
      { name: "documentNo", label: "Belge No", type: "text" },
      { name: "points", label: "Ceza Puanı", type: "number" },
      { name: "amount", label: "Tutar (₺)", type: "text" },
      { name: "paidAt", label: "Ödeme Tarihi", type: "date" },
      { name: "notes", label: "Açıklama", type: "textarea", wide: true },
      { name: "isPaid", label: "Ödendi", type: "checkbox" },
    ],
    columns: [
      { key: "penaltyDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "driverName", label: "Sürücü" },
      { key: "kind", label: "Tür" },
      { key: "points", label: "Puan", format: "number" },
      { key: "amount", label: "Tutar", format: "money" },
      { key: "isPaid", label: "Ödendi", format: "bool" },
    ],
  },

  arizalar: {
    key: "arizalar",
    label: "Arıza",
    plural: "Arızalar",
    description: "Sahadan bildirilen arızalar ve onarım durumu",
    permission: "filo_ariza",
    dateField: "breakdownDate",
    defaults: { status: "bekliyor" },
    schema: z.object({
      vehicleId: requiredUuid,
      driverId: uuidOrNull,
      breakdownDate: day,
      km: intOrNull,
      detail: text(2000),
      reportedBy: text(100),
      reporterRole: text(100),
      status: z.enum(["bekliyor", "devam_ediyor", "onarildi"]).catch("bekliyor"),
      resolvedAt: dayOrNull,
    }),
    fields: (o) => [
      vehicleField(o),
      driverField(o),
      { name: "breakdownDate", label: "Arıza Tarihi", type: "date", required: true },
      { name: "km", label: "Araç KM", type: "number" },
      { name: "reportedBy", label: "Bildiren", type: "text" },
      { name: "reporterRole", label: "Görevi", type: "text" },
      {
        name: "status",
        label: "Durum",
        type: "select",
        options: [
          { value: "bekliyor", label: "Bekliyor" },
          { value: "devam_ediyor", label: "Devam ediyor" },
          { value: "onarildi", label: "Onarıldı" },
        ],
      },
      { name: "resolvedAt", label: "Onarım Tarihi", type: "date" },
      { name: "detail", label: "Arıza Detayı", type: "textarea", wide: true },
    ],
    columns: [
      { key: "breakdownDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "detail", label: "Detay" },
      { key: "reportedBy", label: "Bildiren" },
      {
        key: "status",
        label: "Durum",
        format: "badge",
        tone: { bekliyor: "warn", devam_ediyor: "info", onarildi: "ok" },
        labels: { bekliyor: "Bekliyor", devam_ediyor: "Devam ediyor", onarildi: "Onarıldı" },
      },
    ],
  },

  sigortalar: {
    key: "sigortalar",
    label: "Sigorta",
    plural: "Sigortalar",
    description: "Poliçeler; bitişi yaklaşanlar kırmızı işaretlenir",
    permission: "filo_sigorta",
    dateField: "endsOn",
    schema: z.object({
      vehicleId: requiredUuid,
      policyNo: z.string().trim().min(1, "Poliçe no gerekli.").max(100),
      kind: z.enum(["kasko", "trafik", "koltuk", "ferdi_kaza"]).catch("trafik"),
      insurer: text(100),
      agencyNo: text(50),
      startsOn: day,
      endsOn: day,
      premium: decimalOrNull,
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      { name: "policyNo", label: "Poliçe No", type: "text", required: true },
      {
        name: "kind",
        label: "Sigorta Türü",
        type: "select",
        options: [
          { value: "trafik", label: "Trafik" },
          { value: "kasko", label: "Kasko" },
          { value: "koltuk", label: "Koltuk" },
          { value: "ferdi_kaza", label: "Ferdi Kaza" },
        ],
      },
      { name: "insurer", label: "Sigorta Firması", type: "text" },
      { name: "agencyNo", label: "Acente No", type: "text" },
      { name: "startsOn", label: "Başlangıç", type: "date", required: true },
      { name: "endsOn", label: "Bitiş", type: "date", required: true },
      { name: "premium", label: "Prim (₺)", type: "text" },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "plate", label: "Araç" },
      {
        key: "kind",
        label: "Tür",
        format: "badge",
        tone: { trafik: "info", kasko: "ok", koltuk: "mute", ferdi_kaza: "mute" },
        labels: { trafik: "Trafik", kasko: "Kasko", koltuk: "Koltuk", ferdi_kaza: "Ferdi Kaza" },
      },
      { key: "policyNo", label: "Poliçe No" },
      { key: "insurer", label: "Firma" },
      { key: "startsOn", label: "Başlangıç", format: "date" },
      { key: "endsOn", label: "Bitiş", format: "expiry", warnDays: 30 },
      { key: "premium", label: "Prim", format: "money" },
    ],
  },

  lastikler: {
    key: "lastikler",
    label: "Lastik",
    plural: "Lastikler",
    description: "Lastik değişim kayıtları",
    permission: "filo_lastik",
    dateField: "changedOn",
    defaults: { quantity: 4 },
    schema: z.object({
      vehicleId: requiredUuid,
      changedOn: day,
      km: intOrNull,
      tireType: text(50),
      size: text(30),
      quantity: z.coerce.number().int().min(1).max(24).catch(4),
      unitPrice: decimalOrNull,
      total: decimalOrNull,
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      { name: "changedOn", label: "Değişim Tarihi", type: "date", required: true },
      { name: "km", label: "Araç KM", type: "number" },
      { name: "tireType", label: "Lastik Türü", type: "text", hint: "yaz, kış, dört mevsim" },
      { name: "size", label: "Ebat", type: "text" },
      { name: "quantity", label: "Adet", type: "number" },
      { name: "unitPrice", label: "Birim Fiyat (₺)", type: "text" },
      { name: "total", label: "Toplam (₺)", type: "text" },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "changedOn", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "tireType", label: "Tür" },
      { key: "size", label: "Ebat" },
      { key: "quantity", label: "Adet", format: "number" },
      { key: "total", label: "Tutar", format: "money" },
    ],
  },

  yakit: {
    key: "yakit",
    label: "Yakıt Dolumu",
    plural: "Yakıt Dolumları",
    description: "Dolum kayıtları; tüketim km farkından hesaplanır",
    permission: "yakit_kartlari",
    dateField: "purchaseDate",
    schema: z.object({
      vehicleId: requiredUuid,
      cardId: uuidOrNull,
      purchaseDate: day,
      station: text(100),
      liters: decimalOrNull,
      previousKm: intOrNull,
      currentKm: intOrNull,
      unitPrice: decimalOrNull,
      total: decimalOrNull,
      notes: text(1000),
    }),
    fields: (o) => [
      vehicleField(o),
      // Seçenekleri sayfa dolduruyor; burada yer tutuyor ki aksiyon alanı tanısın.
      { name: "cardId", label: "Yakıt Kartı", type: "select", options: [] },
      { name: "purchaseDate", label: "Dolum Tarihi", type: "date", required: true },
      { name: "station", label: "İstasyon", type: "text" },
      { name: "liters", label: "Litre", type: "text" },
      { name: "previousKm", label: "Önceki KM", type: "number" },
      { name: "currentKm", label: "Son KM", type: "number" },
      { name: "unitPrice", label: "Birim Fiyat (₺)", type: "text" },
      { name: "total", label: "Tutar (₺)", type: "text" },
      { name: "notes", label: "Not", type: "textarea", wide: true },
    ],
    columns: [
      { key: "purchaseDate", label: "Tarih", format: "date" },
      { key: "plate", label: "Araç" },
      { key: "station", label: "İstasyon" },
      { key: "liters", label: "Litre", format: "number" },
      { key: "currentKm", label: "KM", format: "number" },
      { key: "tuketim", label: "L/100km", format: "number" },
      { key: "total", label: "Tutar", format: "money" },
    ],
  },
};

/** Kayıt anahtarı → Drizzle tablosu. Sorgu katmanı buradan çözer. */
export const FILO_TABLES = {
  bakim: vehicleMaintenance,
  belgeler: vehicleDocuments,
  denetimler: inspections,
  kazalar: vehicleAccidents,
  cezalar: vehiclePenalties,
  arizalar: vehicleBreakdowns,
  sigortalar: vehicleInsurances,
  lastikler: vehicleTires,
  yakit: fuelPurchases,
  yakit_kartlari: fuelCards,
} as const;

export function getFiloRecord(key: string): FiloRecordDef | undefined {
  return FILO_RECORDS[key];
}

/** İzni olan kayıt tipleri — menü ve sekmeler bunu kullanır. */
export function listFiloRecords(permissions: Set<string>): FiloRecordDef[] {
  return Object.values(FILO_RECORDS).filter((r) => permissions.has(`${r.permission}:read`));
}
