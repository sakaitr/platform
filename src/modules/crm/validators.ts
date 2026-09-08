import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .catch(null);

export const CompanySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Ünvan en az 2 karakter olmalı."),
  code: optionalText(30),
  type: z.enum(["musteri", "tedarikci", "isleten", "diger"]).catch("musteri"),
  taxNumber: optionalText(20),
  taxOffice: optionalText(120),
  phone: optionalText(30),
  email: optionalText(255),
  address: optionalText(1000),
  notes: optionalText(1000),
  isActive: z.coerce.boolean().catch(true),
});

export type CompanyInput = z.infer<typeof CompanySchema>;
