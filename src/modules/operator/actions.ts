"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants } from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { requireOperator } from "@/lib/operator";
import { SECTOR_PACKS } from "@/lib/sector/packs";
import { applySectorPack, provisionTenant } from "@/lib/sector/install";

export type ActionState = { error: string } | { ok: string } | null;

const ProvisionSchema = z.object({
  name: z.string().trim().min(2, "Kiracı adı gerekli.").max(255),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,100}$/, "Kısa ad yalnız küçük harf, rakam ve tire içerebilir."),
  sectorPack: z.string().trim().min(1, "Sektör paketi seçin."),
  ownerName: z.string().trim().min(2, "Sahip adı gerekli.").max(255),
  ownerEmail: z.string().trim().email("Geçerli e-posta girin."),
  ownerPassword: z.string().min(8, "Şifre en az 8 karakter olmalı."),
  trialDays: z.coerce.number().int().min(0).max(365).catch(14),
});

/** Yeni kiracı kurar: paket uygulanır, sahip hesabı açılır, deneme başlatılır. */
export async function provisionTenantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireOperator();

  const parsed = ProvisionSchema.safeParse({
    name: formData.get("name") ?? "",
    slug: formData.get("slug") ?? "",
    sectorPack: formData.get("sectorPack") ?? "",
    ownerName: formData.get("ownerName") ?? "",
    ownerEmail: formData.get("ownerEmail") ?? "",
    ownerPassword: formData.get("ownerPassword") ?? "",
    trialDays: formData.get("trialDays") ?? "14",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  const input = parsed.data;

  if (!SECTOR_PACKS[input.sectorPack]) return { error: "Bilinmeyen sektör paketi." };

  const existing = await dbAdmin.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug));
  if (existing.length > 0) return { error: "Bu kısa ad kullanılıyor." };

  try {
    const { tenantId } = await provisionTenant({
      name: input.name,
      slug: input.slug,
      sectorPack: input.sectorPack,
      ownerEmail: input.ownerEmail,
      ownerName: input.ownerName,
      ownerPassword: input.ownerPassword,
    });

    if (input.trialDays > 0) {
      await dbAdmin
        .update(subscriptions)
        .set({
          status: "trial",
          trialEndsAt: new Date(Date.now() + input.trialDays * 86_400_000),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.tenantId, tenantId));
    }

    await writeAuditLog({
      tenantId,
      userId: session.userId,
      event: "tenant.provisioned",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { slug: input.slug, sectorPack: input.sectorPack, by: session.email },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Bu e-posta ile bir kullanıcı zaten var." };
    }
    throw error;
  }

  revalidatePath("/operator");
  return { ok: `${input.name} kuruldu. Sahip: ${input.ownerEmail}` };
}

const StatusSchema = z.enum(["trial", "active", "grace", "expired", "suspended"]);

export async function setTenantStatusAction(formData: FormData): Promise<void> {
  const session = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  const parsed = StatusSchema.safeParse(formData.get("status"));
  if (!tenantId || !parsed.success) return;

  const months = Number(formData.get("months") ?? "0");
  const periodEnd =
    parsed.data === "active" && months > 0
      ? new Date(Date.now() + months * 30 * 86_400_000)
      : undefined;

  await dbAdmin
    .update(subscriptions)
    .set({ status: parsed.data, currentPeriodEnd: periodEnd, updatedAt: new Date() })
    .where(eq(subscriptions.tenantId, tenantId));

  await writeAuditLog({
    tenantId,
    userId: session.userId,
    event: "tenant.status_changed",
    entityType: "tenant",
    entityId: tenantId,
    metadata: { status: parsed.data, by: session.email },
  });
  revalidatePath("/operator");
}

/** Paket sürümünü yeniden uygular — yeni modül/alan eklendiğinde kiracıyı günceller. */
export async function reapplyPackAction(formData: FormData): Promise<void> {
  const session = await requireOperator();
  const tenantId = String(formData.get("tenantId") ?? "");
  if (!tenantId) return;

  const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return;

  await applySectorPack(tenantId, tenant.sectorPack);
  const pack = SECTOR_PACKS[tenant.sectorPack];
  if (pack) {
    await dbAdmin
      .update(tenants)
      .set({ sectorPackVersion: pack.version, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  }

  await writeAuditLog({
    tenantId,
    userId: session.userId,
    event: "tenant.pack_reapplied",
    entityType: "tenant",
    entityId: tenantId,
    metadata: { pack: tenant.sectorPack, by: session.email },
  });
  revalidatePath("/operator");
}
