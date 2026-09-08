"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { companies } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requirePermission } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { isInScope } from "@/lib/scope";
import { CompanySchema } from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

function readCompanyForm(formData: FormData) {
  return CompanySchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name") ?? "",
    code: formData.get("code") ?? "",
    type: formData.get("type") ?? "musteri",
    taxNumber: formData.get("taxNumber") ?? "",
    taxOffice: formData.get("taxOffice") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    notes: formData.get("notes") ?? "",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
}

export async function saveCompanyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const isUpdate = Boolean(formData.get("id"));
  const session = await requirePermission(isUpdate ? "firmalar:update" : "firmalar:create");

  const parsed = readCompanyForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const { id, ...values } = parsed.data;

  if (isUpdate && id && !isInScope(session.scope, id)) {
    return { error: "Bu firma kapsamınızda değil." };
  }

  await withTenant(session.tenantId, async (tx) => {
    if (isUpdate && id) {
      await tx
        .update(companies)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(companies.tenantId, session.tenantId), eq(companies.id, id)));
    } else {
      await tx.insert(companies).values({ ...values, tenantId: session.tenantId, createdBy: session.userId });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: isUpdate ? "company.updated" : "company.created",
    entityType: "company",
    entityId: id,
    metadata: { name: values.name },
  });

  revalidatePath("/crm/firmalar");
  return { ok: isUpdate ? "Firma güncellendi." : "Firma eklendi." };
}

export async function deleteCompanyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("firmalar:delete");
  const id = String(formData.get("id") ?? "");
  if (!id || !isInScope(session.scope, id)) return;

  await withTenant(session.tenantId, (tx) =>
    tx.delete(companies).where(and(eq(companies.tenantId, session.tenantId), eq(companies.id, id))),
  );
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "company.deleted",
    entityType: "company",
    entityId: id,
  });
  revalidatePath("/crm/firmalar");
}
