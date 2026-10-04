import { z } from "zod";
import { isValidEmail } from "./normalize";
import { parseMoney } from "./csv-leads";

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En fazla ${max} karakter olabilir.`)
    .transform((v) => (v.length === 0 ? null : v));

const uuidOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .pipe(z.string().uuid().nullable());

/** Takvim gününü İstanbul saatiyle 09:00'a sabitler (Türkiye UTC+3, yaz saati yok). */
export function followUpFromDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T09:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const TEMPERATURES = ["hot", "warm", "cold"] as const;
export const OPEN_STATUSES = ["new", "contacted", "qualified", "disqualified"] as const;

export const LeadFormSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Ad en az 2 karakter olmalı."),
  contactName: text(255),
  phone: text(40),
  email: text(255).refine((v) => v === null || isValidEmail(v), "E-posta adresi geçersiz. ornek@firma.com biçiminde yazın."),
  website: text(255),
  city: text(100),
  sector: text(100),
  service: text(255),
  eventName: text(255),
  message: text(4000),
  note: text(4000),
  estimatedValue: text(30).transform((v, ctx) => {
    if (v === null) return null;
    const parsed = parseMoney(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Tahmini değer sayı olmalı. Örnek: 15000 ya da 15.000,50" });
      return z.NEVER;
    }
    return parsed;
  }),
  temperature: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.enum(TEMPERATURES).nullable()),
  ownerUserId: uuidOrNull,
  followUpDate: text(10).refine(
    (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
    "Takip tarihi geçersiz.",
  ),
});

export type LeadFormValues = z.infer<typeof LeadFormSchema>;

export function readLeadForm(formData: FormData) {
  const raw = (key: string): FormDataEntryValue => formData.get(key) ?? "";
  return LeadFormSchema.safeParse({
    id: formData.get("id") || undefined,
    name: raw("name"),
    contactName: raw("contactName"),
    phone: raw("phone"),
    email: raw("email"),
    website: raw("website"),
    city: raw("city"),
    sector: raw("sector"),
    service: raw("service"),
    eventName: raw("eventName"),
    message: raw("message"),
    note: raw("note"),
    estimatedValue: raw("estimatedValue"),
    temperature: raw("temperature"),
    ownerUserId: raw("ownerUserId"),
    followUpDate: raw("followUpDate"),
  });
}

export const ContactFormSchema = z.object({
  leadId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Kişi adı en az 2 karakter olmalı."),
  title: text(150),
  phone: text(40),
  email: text(255).refine((v) => v === null || isValidEmail(v), "E-posta adresi geçersiz."),
});

export const BulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Önce en az bir aday seçin.").max(500, "Tek seferde en fazla 500 aday işlenir."),
  op: z.enum(["status", "owner", "temperature", "delete"]),
  value: z.string().trim().default(""),
});
