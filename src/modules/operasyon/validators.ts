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

/** Enlem/boylam — boş bırakılabilir, doluysa sayı olmalı. */
const coordinate = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
  .nullable()
  .refine((v) => v === null || Number.isFinite(Number(v)), "Koordinatı 40.8000000 biçiminde girin.");

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
  pickupLat: coordinate,
  pickupLng: coordinate,
  dropoffAddress: optionalText(1000),
  serviceStatus: z.enum(["aktif", "pasif", "askida"]).catch("aktif"),
  contractStatus: z.enum(["yok", "gonderildi", "imzalandi"]).catch("yok"),
  direction: z.enum(["sabah", "aksam", "her_iki"]).catch("her_iki"),
  paymentPlanId: optionalUuid,
  routeId: optionalUuid,
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

const optionalDecimal = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
  .nullable()
  .refine((v) => v === null || Number.isFinite(Number(v)), "Sayı girin.");

const optionalInt = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : Number(v)))
  .nullable()
  .refine((v) => v === null || Number.isInteger(v), "Tam sayı girin.");

const optionalClock = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Saat SS:DD biçiminde olmalı.");

export const RouteSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Güzergah adı en az 2 karakter olmalı.").max(255),
  code: optionalText(50),
  companyId: optionalUuid,
  direction: z.enum(["gidis", "donus", "ikisi"]).catch("ikisi"),
  capacity: optionalInt,
  shiftName: optionalText(100),
  morningDeparture: optionalClock,
  morningArrival: optionalClock,
  eveningDeparture: optionalClock,
  eveningArrival: optionalClock,
  vehicleId: optionalUuid,
  driverId: optionalUuid,
  distanceKm: optionalDecimal,
  durationMin: optionalInt,
  isActive: z.coerce.boolean().catch(true),
  notes: optionalText(1000),
});

export const RouteAssignmentSchema = z.object({
  routeId: z.string().uuid("Güzergah seçin."),
  vehicleId: z.string().uuid("Araç seçin."),
  driverId: optionalUuid,
  tripType: optionalText(40),
  startsOn: dayKey,
  notes: optionalText(500),
});

export const CompanyShiftSchema = z.object({
  id: z.string().uuid().optional(),
  companyId: z.string().uuid("Firma seçin."),
  name: z.string().trim().min(1, "Vardiya adı gerekli.").max(100),
  expectedAt: clockTime,
  toleranceEarly: z.coerce.number().int().min(0).max(180).catch(15),
  toleranceLate: z.coerce.number().int().min(0).max(180).catch(10),
  isActive: z.coerce.boolean().catch(true),
});

export const OpenRouteSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Güzergah adı gerekli.").max(255),
  companyId: optionalUuid,
  distanceKm: optionalDecimal,
  durationMin: optionalInt,
  price: optionalDecimal,
  status: z.enum(["acik", "fiyatlandi", "kapandi"]).catch("acik"),
  notes: optionalText(1000),
});

export const TripLogSchema = z.object({
  id: z.string().uuid().optional(),
  vehicleId: z.string().uuid("Araç seçin."),
  routeId: optionalUuid,
  driverId: optionalUuid,
  companyId: optionalUuid,
  logDate: dayKey,
  tripType: z.string().trim().min(1, "Hareket tipi gerekli.").max(40),
  direction: optionalText(10),
  passengerCount: optionalInt,
  notes: optionalText(500),
});

export const TransferSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Başlık gerekli.").max(255),
  companyId: optionalUuid,
  vehicleId: optionalUuid,
  driverId: optionalUuid,
  pickupLocation: optionalText(1000),
  dropoffLocation: optionalText(1000),
  transferDate: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih seçin."),
  transferTime: optionalClock,
  passengerCount: optionalInt,
  price: optionalDecimal,
  notes: optionalText(1000),
});

export const RoutePlanSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Plan adı gerekli.").max(255),
  companyId: optionalUuid,
  shiftName: optionalText(100),
  direction: z.enum(["gidis", "donus", "ikisi"]).catch("gidis"),
});

/** Toplu yolcu ekleme: her satır bir kişi, "Ad Soyad;Telefon;TC" biçiminde. */
export const BulkPassengerSchema = z.object({
  companyId: optionalUuid,
  routeId: optionalUuid,
  type: z.enum(["yolcu", "personel", "musteri"]).catch("personel"),
  /** Hepsine uygulanacak ortak biniş/iniş adresi. */
  pickupAddress: optionalText(1000),
  dropoffAddress: optionalText(1000),
  rows: z
    .string()
    .trim()
    .min(2, "En az bir satır girin.")
    .transform((v) =>
      v
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
});

export const ServiceChangeSchema = z.object({
  passengerId: z.string().uuid("Yolcu seçin."),
  temporaryRouteId: optionalUuid,
  startsOn: dayKey,
  endsOn: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz."),
  direction: z.enum(["sabah", "aksam", "her_iki"]).catch("her_iki"),
  notes: optionalText(500),
});

export const PaymentPlanSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Plan adı gerekli.").max(100),
  totalAmount: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
    .nullable()
    .refine((v) => v === null || Number.isFinite(Number(v)), "Tutar sayı olmalı."),
  installments: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || Number.isInteger(v), "Taksit sayısı tam sayı olmalı."),
  notes: optionalText(1000),
  isActive: z.coerce.boolean().catch(true),
});
