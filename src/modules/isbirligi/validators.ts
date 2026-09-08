import { z } from "zod";

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

const dayOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz.");

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin.");

const PRIORITIES = ["dusuk", "normal", "yuksek", "kritik"] as const;

export const TaskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Başlık en az 3 karakter olmalı.").max(255),
  description: text(4000),
  status: z.enum(["yapilacak", "yapiliyor", "bekliyor", "bitti"]).catch("yapilacak"),
  priority: z.enum(PRIORITIES).catch("normal"),
  assignedTo: uuidOrNull,
  companyId: uuidOrNull,
  dueDate: dayOrNull,
});

export const TicketSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Konu en az 3 karakter olmalı.").max(255),
  description: text(4000),
  priority: z.enum(PRIORITIES).catch("normal"),
  companyId: uuidOrNull,
  vehicleId: uuidOrNull,
  assignedTo: uuidOrNull,
});

export const TicketMessageSchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1, "Mesaj boş olamaz.").max(4000),
  isInternal: z.coerce.boolean().catch(false),
});

export const SuggestionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Başlık gerekli.").max(255),
  description: text(4000),
  kind: z.enum(["oneri", "talep", "sikayet", "istek"]).catch("oneri"),
  assignedTo: uuidOrNull,
});

export const WarningSchema = z.object({
  id: z.string().uuid().optional(),
  vehicleId: uuidOrNull,
  driverId: uuidOrNull,
  reason: z.string().trim().min(5, "Gerekçe en az 5 karakter olmalı.").max(2000),
  deadline: dayOrNull,
});

export const LeaveRequestSchema = z.object({
  leaveTypeId: uuidOrNull,
  startsOn: day,
  endsOn: day,
  reason: text(2000),
});

export const LeaveTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "İzin türü adı gerekli.").max(100),
  annualDays: z.coerce.number().int().min(0).max(365).catch(0),
  isActive: z.coerce.boolean().catch(true),
});

export const DriverRecordSchema = z.object({
  id: z.string().uuid().optional(),
  driverId: z.string().uuid("Sürücü seçin."),
  vehicleId: uuidOrNull,
  incidentDate: day,
  category: z.string().trim().min(1).max(50).catch("diger"),
  severity: z.coerce.number().int().min(1).max(5).catch(1),
  description: z.string().trim().min(5, "Açıklama en az 5 karakter olmalı.").max(4000),
  actionTaken: text(2000),
});

const score = z.coerce.number().int().min(1).max(5).catch(3);

export const DriverEvaluationSchema = z.object({
  driverId: z.string().uuid("Sürücü seçin."),
  vehicleId: uuidOrNull,
  companyId: uuidOrNull,
  evaluationDate: day,
  punctuality: score,
  driving: score,
  communication: score,
  cleanliness: score,
  routeCompliance: score,
  appearance: score,
  notes: text(2000),
});

export const PortalUserSchema = z.object({
  id: z.string().uuid().optional(),
  email: z.string().trim().email("Geçerli e-posta girin."),
  fullName: z.string().trim().min(2, "Ad soyad gerekli.").max(150),
  password: z
    .string()
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .refine((v) => v === null || v.length >= 8, "Şifre en az 8 karakter olmalı."),
  companyIds: z.array(z.string().uuid()).min(1, "En az bir firma seçin."),
  isActive: z.coerce.boolean().catch(true),
});

export const ContactSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Ad gerekli.").max(200),
  category: text(50),
  title: text(150),
  phone: text(30),
  email: text(255),
  companyId: uuidOrNull,
  notes: text(1000),
});

export const BlacklistSchema = z
  .object({
    id: z.string().uuid().optional(),
    fullName: text(200),
    idNumber: text(20),
    plate: text(20),
    reason: z.string().trim().min(5, "Gerekçe en az 5 karakter olmalı.").max(2000),
    addedOn: day,
    isActive: z.coerce.boolean().catch(true),
  })
  .refine((v) => v.fullName !== null || v.plate !== null, {
    message: "Ad soyad ya da plakadan biri girilmeli.",
    path: ["fullName"],
  });

export const AnnouncementSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(3, "Başlık gerekli.").max(255),
  body: z.string().trim().min(5, "İçerik gerekli.").max(8000),
  showInPortal: z.coerce.boolean().catch(false),
  startsOn: dayOrNull,
  endsOn: dayOrNull,
  isActive: z.coerce.boolean().catch(true),
});
