import { z } from "zod";

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .catch(null);

export const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Geçersiz seçim.");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayKey = z.string().trim().regex(DAY, "Tarih GG.AA.YYYY biçiminde seçilmeli.");
export const clockTime = z.string().trim().regex(HHMM, "Saat SS:DD biçiminde olmalı.");

export const PassengerSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı."),
  companyId: optionalUuid,
  phone: optionalText(30),
  email: optionalText(255),
  idNumber: optionalText(30),
  type: z.enum(["yolcu", "personel", "musteri"]).catch("yolcu"),
  grade: optionalText(20),
  branch: optionalText(10),
  barcode: optionalText(50),
  pickupAddress: optionalText(1000),
  dropoffAddress: optionalText(1000),
  serviceStatus: z.enum(["aktif", "pasif", "askida"]).catch("aktif"),
  isActive: z.coerce.boolean().catch(true),
  notes: optionalText(1000),
});

export const ArrivalSchema = z.object({
  id: z.string().uuid().optional(),
  vehicleId: z.string().uuid("Araç seçin."),
  companyId: optionalUuid,
  driverId: optionalUuid,
  arrivalDate: dayKey,
  shift: z.string().trim().min(1, "Vardiya girin.").max(100),
  arrivedAt: clockTime,
  plannedAt: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine((v) => v === null || HHMM.test(v), "Planlanan saat SS:DD biçiminde olmalı."),
  note: optionalText(1000),
});

export const VisitorSchema = z.object({
  id: z.string().uuid().optional(),
  visitorName: z.string().trim().min(2, "Ziyaretçi adı gerekli."),
  reason: z.string().trim().min(2, "Geliş sebebi gerekli.").max(500),
  hostName: z.string().trim().min(2, "Kime geldiği yazılmalı.").max(200),
  companyId: optionalUuid,
  plate: optionalText(20),
});

export const DailyQuestionSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(3, "Soru en az 3 karakter olmalı.").max(500),
  type: z.enum(["evet_hayir", "metin", "uzun_metin", "secim", "checklist"]).catch("evet_hayir"),
  /** Satır başına bir seçenek. */
  options: z
    .string()
    .trim()
    .transform((v) =>
      v
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .catch([]),
  required: z.coerce.boolean().catch(true),
  position: z.coerce.number().int().min(0).catch(0),
  isActive: z.coerce.boolean().catch(true),
});
