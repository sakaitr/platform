"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { vehicles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { FILO_TABLES, getFiloRecord } from "./registry";

export type ActionState = { error: string } | { ok: string } | null;

/**
 * Tüm araç alt kayıtları için tek kaydetme aksiyonu.
 * Hangi kayıt tipi olduğunu formdaki gizli `kayit` alanı söyler;
 * doğrulama ve alanlar kayıt defterinden gelir.
 */
export async function saveFiloRecordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const key = String(formData.get("kayit") ?? "");
  const def = getFiloRecord(key);
  if (!def) return { error: "Bilinmeyen kayıt tipi." };

  const id = String(formData.get("id") ?? "");
  const session = await requireModule(`${def.permission}:${id ? "update" : "create"}`, "filo");

  // Alanlar ŞEMADAN okunur. Form listesinden okumak, şemada olup formda
  // görünmeyen alanları (companyId, cardId) eksik bırakıp doğrulamayı düşürüyordu.
  const checkboxes = new Set(
    def
      .fields({ vehicles: [], drivers: [], companies: [], terms: (k) => k })
      .filter((f) => f.type === "checkbox")
      .map((f) => f.name),
  );
  const raw: Record<string, unknown> = {};
  for (const name of Object.keys(def.schema.shape)) {
    raw[name] = checkboxes.has(name)
      ? formData.get(name) === "on"
      : String(formData.get(name) ?? "");
  }

  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    const issue = "issues" in parsed.error ? parsed.error.issues[0] : undefined;
    return { error: issue?.message ?? "Form geçersiz." };
  }
  const values = parsed.data as Record<string, unknown>;

  // Kapsam denetimi aracın firmasından: alt kayıtta firma sütunu yok.
  const vehicleId = String(values.vehicleId ?? "");
  const owner = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ companyId: vehicles.companyId })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.id, vehicleId))),
  );
  if (owner.length === 0) return { error: "Araç bulunamadı." };
  const companyId = owner[0]!.companyId;
  if (companyId && !isInScope(session.scope, companyId)) {
    return { error: "Bu araç kapsamınızda değil." };
  }

  const table = FILO_TABLES[key as keyof typeof FILO_TABLES] as unknown as Record<string, never>;

  await withTenant(session.tenantId, async (tx) => {
    if (id) {
      await tx
        .update(table as never)
        .set(values as never)
        .where(and(eq(table.tenantId, session.tenantId), eq(table.id, id)));
    } else {
      await tx.insert(table as never).values({ ...values, tenantId: session.tenantId } as never);
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: id ? `${key}.updated` : `${key}.created`,
    entityType: key,
    entityId: id || undefined,
  });
  revalidatePath(`/filo/${key}`);
  return { ok: id ? "Kayıt güncellendi." : "Kayıt eklendi." };
}

export async function deleteFiloRecordAction(formData: FormData): Promise<void> {
  const key = String(formData.get("kayit") ?? "");
  const def = getFiloRecord(key);
  const id = String(formData.get("id") ?? "");
  if (!def || !id) return;

  const session = await requireModule(`${def.permission}:delete`, "filo");
  const table = FILO_TABLES[key as keyof typeof FILO_TABLES] as unknown as Record<string, never>;

  await withTenant(session.tenantId, (tx) =>
    tx.delete(table as never).where(and(eq(table.tenantId, session.tenantId), eq(table.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: `${key}.deleted`,
    entityType: key,
    entityId: id,
  });
  revalidatePath(`/filo/${key}`);
}
