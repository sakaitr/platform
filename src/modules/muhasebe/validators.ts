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

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seçin.");

const dayOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tarih geçersiz.");

/** Tutar string kalır — numeric sütuna float sokmuyoruz. */
const money = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? "0" : v.replace(",", ".")))
  .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(v), "Tutarı 1234.56 biçiminde girin.");

const moneyOrNull = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? null : v.replace(",", ".")))
  .nullable()
  .refine((v) => v === null || /^-?\d+(\.\d{1,2})?$/.test(v), "Tutarı 1234.56 biçiminde girin.");

const rate = z
  .string()
  .trim()
  .transform((v) => (v.length === 0 ? "0" : v.replace(",", ".")))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100, "Oran 0–100 arasında olmalı.");

export const CompanyFinanceSchema = z.object({
  companyId: z.string().uuid("Firma seçin."),
  accountCode: text(50),
  idNumber: text(11),
  bankName: text(100),
  bankBranch: text(100),
  iban: text(34),
  contractStart: dayOrNull,
  contractEnd: dayOrNull,
  isPrimaryOperator: z.coerce.boolean().catch(false),
  isDriver: z.coerce.boolean().catch(false),
  isTitleHolder: z.coerce.boolean().catch(false),
  withholdingPolicy: z.enum(["tum_araclar", "sadece_ozmal", "uygulanmasin"]).catch("tum_araclar"),
  fuelCreditRate: moneyOrNull,
  notes: text(1000),
});

export const PricingFormSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Form adı gerekli.").max(200),
  groupName: text(100),
  unitPrice: moneyOrNull,
  vatRate: rate,
  withholdingRate: rate,
  isActive: z.coerce.boolean().catch(true),
  notes: text(1000),
});

export const VehicleOperatorSchema = z.object({
  vehicleId: z.string().uuid("Araç seçin."),
  operatorId: z.string().uuid("İşleten seçin."),
  startsOn: day,
  notes: text(500),
});

export const EarningDraftSchema = z.object({
  operatorId: z.string().uuid("İşleten seçin."),
  vehicleId: uuidOrNull,
  pricingFormId: uuidOrNull,
  periodStart: day,
  periodEnd: day,
  unitPrice: money,
  vatRate: rate,
  withholdingRate: rate,
  deductions: money,
  notes: text(1000),
});

export const LedgerEntrySchema = z.object({
  companyId: z.string().uuid("Firma seçin."),
  entryDate: day,
  dueDate: dayOrNull,
  debit: money,
  credit: money,
  kind: z.enum(["hakedis", "odeme", "avans", "kesinti", "diger"]).catch("diger"),
  description: text(500),
});

export const FinanceCategorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Kategori adı gerekli.").max(200),
  kind: z.enum(["gelir", "gider"]),
  isActive: z.coerce.boolean().catch(true),
});

export const FinanceTransactionSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["gelir", "gider"]),
  entryDate: day,
  documentNo: text(100),
  categoryId: uuidOrNull,
  companyId: uuidOrNull,
  vehicleId: uuidOrNull,
  routeId: uuidOrNull,
  amount: money,
  vatRate: rate,
  currency: z.string().trim().length(3).catch("TRY"),
  rate: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? "1" : v.replace(",", ".")))
    .refine((v) => Number(v) > 0, "Kur sıfırdan büyük olmalı."),
  status: z.enum(["taslak", "tamamlandi"]).catch("tamamlandi"),
  description: text(2000),
});

export const BudgetSchema = z.object({
  id: z.string().uuid().optional(),
  categoryId: uuidOrNull,
  companyId: uuidOrNull,
  period: z.string().trim().regex(/^\d{4}-\d{2}$/, "Dönemi YYYY-AA biçiminde girin."),
  amount: money,
  notes: text(1000),
});

export const RoutePriceSchema = z.object({
  routeId: z.string().uuid("Güzergah seçin."),
  companyId: uuidOrNull,
  supplierId: uuidOrNull,
  price: money,
  validFrom: day,
});

export const DeliveryNoteSchema = z.object({
  id: z.string().uuid().optional(),
  companyId: uuidOrNull,
  vehicleId: uuidOrNull,
  issueDate: day,
  shipDate: dayOrNull,
  fromAddress: text(1000),
  toAddress: text(1000),
  description: text(2000),
  quantity: moneyOrNull,
  unit: text(20),
  status: z.enum(["taslak", "sevk_edildi", "teslim_edildi", "iptal"]).catch("taslak"),
  notes: text(1000),
});
