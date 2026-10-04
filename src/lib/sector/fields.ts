import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { entityFields, type EntityField } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function getEntityFields(
  tenantId: string,
  entityKey: string,
): Promise<EntityField[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(entityFields)
      .where(
        and(
          eq(entityFields.tenantId, tenantId),
          eq(entityFields.entityKey, entityKey),
          eq(entityFields.isActive, true),
        ),
      )
      .orderBy(asc(entityFields.position)),
  );
}

function fieldToZod(field: EntityField): z.ZodTypeAny {
  const base = ((): z.ZodTypeAny => {
    switch (field.type) {
      case "number":
        return z.coerce.number();
      case "date":
        return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${field.label} geçerli bir tarih olmalı.`);
      case "boolean":
        return z.coerce.boolean();
      case "select": {
        const options = (field.options as string[]) ?? [];
        return options.length > 0
          ? z.string().refine((v) => options.includes(v), `${field.label} geçersiz seçim.`)
          : z.string();
      }
      default:
        return z.string();
    }
  })();

  return field.required
    ? base.refine((v) => v !== "" && v !== undefined && v !== null, `${field.label} zorunlu.`)
    : base.optional();
}

/** Tanımlı alanlardan Zod şeması üretir. Tanımsız anahtarlar sessizce düşer (strip). */
export function buildCustomSchema(fields: EntityField[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) shape[field.fieldKey] = fieldToZod(field);
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}

export function parseCustomValues(
  fields: EntityField[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  return buildCustomSchema(fields).parse(input);
}
