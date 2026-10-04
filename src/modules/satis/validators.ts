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

/** `datetime-local` değerini (YYYY-MM-DDTHH:mm) İstanbul saati olarak okur. */
export function dateTimeFromLocal(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const DealFormSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Fırsat başlığı en az 2 karakter olmalı."),
  stageId: uuidOrNull,
  value: text(30).transform((v, ctx) => {
    if (v === null) return null;
    const parsed = parseMoney(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Tutar sayı olmalı. Örnek: 15000 ya da 15.000,50" });
      return z.NEVER;
    }
    return parsed;
  }),
  companyId: uuidOrNull,
  leadId: uuidOrNull,
  ownerUserId: uuidOrNull,
  expectedCloseDate: text(10).refine(
    (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v),
    "Beklenen kapanış tarihi geçersiz.",
  ),
  note: text(4000),
});

export function readDealForm(formData: FormData) {
  const raw = (key: string): FormDataEntryValue => formData.get(key) ?? "";
  return DealFormSchema.safeParse({
    id: formData.get("id") || undefined,
    title: raw("title"),
    stageId: raw("stageId"),
    value: raw("value"),
    companyId: raw("companyId"),
    leadId: raw("leadId"),
    ownerUserId: raw("ownerUserId"),
    expectedCloseDate: raw("expectedCloseDate"),
    note: raw("note"),
  });
}

export const ActivityFormSchema = z
  .object({
    leadId: uuidOrNull,
    dealId: uuidOrNull,
    type: z.enum(["call", "meeting", "email", "note", "task"]),
    subject: z.string().trim().min(2, "Konu en az 2 karakter olmalı.").max(255, "Konu en fazla 255 karakter olabilir."),
    note: text(4000),
    due: text(16).refine((v) => v === null || dateTimeFromLocal(v) !== null, "Vade tarihi geçersiz."),
    assigneeUserId: uuidOrNull,
  })
  .refine((v) => v.leadId || v.dealId, { message: "Aktivite bir aday ya da fırsata bağlı olmalı." });

export const StageFormSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, "Aşama adı boş olamaz.").max(100, "Aşama adı en fazla 100 karakter olabilir."),
  kind: z.enum(["open", "won", "lost"], { errorMap: () => ({ message: "Aşama türünü seçin." }) }),
  color: text(20).refine((v) => v === null || /^#[0-9a-fA-F]{3,8}$/.test(v), "Renk #rrggbb biçiminde olmalı."),
});
