"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { companies, companyResponsibles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { requireModule, requirePermission } from "@/lib/auth";
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
  const session = await requireModule(isUpdate ? "firmalar:update" : "firmalar:create", "crm");

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
  const session = await requireModule("firmalar:delete", "crm");
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

/** Firmaya sorumlu atar — birden çok kişi olabilir. */
export async function addResponsibleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("firmalar:update");
  const companyId = String(formData.get("companyId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!companyId || !userId) return;
  if (!isInScope(session.scope, companyId)) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .insert(companyResponsibles)
      .values({ tenantId: session.tenantId, companyId, userId })
      .onConflictDoNothing(),
  );
  revalidatePath(`/crm/firmalar/${companyId}`);
}

export async function removeResponsibleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("firmalar:update");
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (!id) return;
  await withTenant(session.tenantId, (tx) =>
    tx
      .delete(companyResponsibles)
      .where(
        and(eq(companyResponsibles.tenantId, session.tenantId), eq(companyResponsibles.id, id)),
      ),
  );
  revalidatePath(`/crm/firmalar/${companyId}`);
}
