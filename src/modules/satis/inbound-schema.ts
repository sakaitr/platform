import { z } from "zod";

/**
 * Atricard → AtriCRM sözleşmesi (v1). Alıcı toleranslıdır: bilinmeyen alanlar yok sayılır (Atricard
 * yeni alan ekleyince eski alıcı kırılmasın), bilinmeyen olay tipi `200 ignored` döner.
 * Boş alanlar `null` gelir.
 */

const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v.trim() === "" ? null : v.trim()));

export const AtricardLeadCreated = z.object({
  event: z.literal("lead.created"),
  version: z.number().int().positive(),
  id: z.string().trim().min(1).max(100),
  occurred_at: z.string().max(40).optional(),
  lead: z.object({
    name: z.string().trim().min(1, "lead.name boş olamaz").max(255),
    company: nullableText(255),
    email: nullableText(255),
    phone: nullableText(40),
    message: nullableText(4000),
    service: nullableText(255),
    origin: z.string().max(20).nullable().optional(),
    status: z.string().max(20).nullable().optional(),
    temperature: z.enum(["HOT", "WARM", "COLD"]).nullable().optional(),
    event_name: nullableText(255),
  }),
  owner: z
    .object({
      name: nullableText(255),
      email: nullableText(255),
      card: nullableText(500),
    })
    .nullable()
    .optional(),
  company: z.object({ name: nullableText(255) }).nullable().optional(),
  consent: z.object({ photo: z.boolean().optional() }).nullable().optional(),
});

export const AtricardLeadDeleted = z.object({
  event: z.literal("lead.deleted"),
  version: z.number().int().positive(),
  id: z.string().trim().min(1).max(100),
  occurred_at: z.string().max(40).optional(),
  reason: z.enum(["erasure_request", "owner_deleted", "account_removed"]).optional(),
});

export type LeadCreatedPayload = z.infer<typeof AtricardLeadCreated>;
export type LeadDeletedPayload = z.infer<typeof AtricardLeadDeleted>;

/** Atricard `temperature` → AtriCRM (puanı da belirler: HOT 80, WARM 50, COLD 20). */
export const TEMPERATURE_MAP = { HOT: "hot", WARM: "warm", COLD: "cold" } as const;
