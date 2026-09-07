"use server";

import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { terminologyOverrides, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createInvite, requirePermission, revokeUserSessions } from "@/lib/auth";
import { setUserScope } from "@/lib/scope";
import { writeAuditLog } from "@/lib/audit";
import { tenantTag } from "@/lib/cache";
import { enqueueEmail } from "@/lib/queue";
import { AssignRoleSchema, InviteSchema, SetTermSchema } from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function inviteUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("users:invite");

  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const token = await createInvite(session.tenantId, parsed.data);
  await enqueueEmail({
    to: parsed.data.email,
    subject: "Agno Platform davetiniz",
    body: `Hesabınızı oluşturmak için: ${process.env.APP_URL}/davet/${token}`,
  });
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.invited",
    entityType: "user",
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
  return { ok: "Davet gönderildi." };
}

export async function setTermAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("terminology:update");

  const parsed = SetTermSchema.safeParse({
    termKey: formData.get("termKey"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, async (tx) => {
    const existing = await tx
      .select({ id: terminologyOverrides.id })
      .from(terminologyOverrides)
      .where(
        and(
          eq(terminologyOverrides.tenantId, session.tenantId),
          eq(terminologyOverrides.termKey, parsed.data.termKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(terminologyOverrides)
        .set({ value: parsed.data.value })
        .where(eq(terminologyOverrides.id, existing[0]!.id));
    } else {
      await tx.insert(terminologyOverrides).values({
        tenantId: session.tenantId,
        termKey: parsed.data.termKey,
        value: parsed.data.value,
      });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "terminology.changed",
    metadata: { ...parsed.data },
  });

  revalidateTag(tenantTag(session.tenantId, "terminology"), "max");
  return { ok: "Terim güncellendi." };
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("roles:assign");

  const parsed = AssignRoleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(users)
      .set({ roleId: parsed.data.roleId, updatedAt: new Date() })
      .where(and(eq(users.tenantId, session.tenantId), eq(users.id, parsed.data.userId))),
  );

  // Yetki değişti — kullanıcının açık oturumları eski izinlerle devam etmesin
  await revokeUserSessions(session.tenantId, parsed.data.userId);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.role_assigned",
    entityType: "user",
    entityId: parsed.data.userId,
    metadata: { roleId: parsed.data.roleId },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setUserScopeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("scopes:assign");

  const userId = String(formData.get("userId") ?? "");
  if (!UUID_RE.test(userId)) return;

  const raw = String(formData.get("companyIds") ?? "");
  const companyIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));

  await setUserScope(session.tenantId, userId, companyIds);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.scope_changed",
    entityType: "user",
    entityId: userId,
    metadata: { companyCount: companyIds.length },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
}
