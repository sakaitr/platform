import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .catch(null);

const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), "Geçersiz seçim.");

const optionalInt = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : Number(v)))
  .nullable()
  .refine((v) => v === null || Number.isFinite(v), "Sayı girin.");

/** Türk plakası: 34 ABC 123 → boşluk/tire temizlenip büyütülür. */
export const normalizePlate = (raw: string): string =>
  raw.toLocaleUpperCase("tr-TR").replace(/[\s-]+/g, "");

export const VehicleSchema = z.object({
  id: z.string().uuid().optional(),
  plate: z
    .string()
    .trim()
    .min(5, "Plaka en az 5 karakter olmalı.")
    .transform(normalizePlate),
  companyId: optionalUuid,
  brand: optionalText(80),
  model: optionalText(80),
  modelYear: optionalInt,
  capacity: optionalInt,
  vehicleType: optionalText(40),
  titleHolder: optionalText(200),
  status: z.enum(["aktif", "bakimda", "pasif"]).catch("aktif"),
  notes: optionalText(1000),
});

export const DriverSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı."),
  companyId: optionalUuid,
  phone: optionalText(30),
  idNumber: optionalText(20),
  licenseClass: optionalText(20),
  licenseExpiry: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable(),
  status: z.enum(["aktif", "izinli", "pasif"]).catch("aktif"),
  notes: optionalText(1000),
});

export const FuelCardSchema = z.object({
  id: z.string().uuid().optional(),
  cardNo: z.string().trim().min(3, "Kart numarası en az 3 karakter olmalı.").max(50),
  provider: optionalText(50),
  vehicleId: optionalUuid,
  companyId: optionalUuid,
  limitKind: z.enum(["sinirsiz", "miktar", "tutar"]).catch("sinirsiz"),
  limitValue: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
    .nullable()
    .refine((v) => v === null || Number.isFinite(Number(v)), "Sayı girin."),
  isActive: z.coerce.boolean().catch(true),
  notes: optionalText(1000),
});
