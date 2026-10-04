import { and, eq, inArray } from "drizzle-orm";
import { crmLeads, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { canSeeAll, ownerVisibility, type VisibilitySession } from "./visibility";

/** Satışçı yalnız görebildiği adayı değiştirebilir: görünürlük süzgeci yazma yollarında da uygulanır. */
export async function findVisibleLeadIds(
  tx: TenantTx,
  session: VisibilitySession,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: crmLeads.id })
    .from(crmLeads)
    .where(
      and(
        eq(crmLeads.tenantId, session.tenantId),
        inArray(crmLeads.id, [...ids]),
        ownerVisibility(crmLeads.ownerUserId, session),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Sahip ataması kuralı: tümünü görebilen herkese atayabilir; diğerleri yalnız sahipsiz adayı
 * kendine alabilir ya da bırakabilir. Başkasına atamak o kullanıcıdan adayı koparır.
 */
export async function resolveOwner(
  tx: TenantTx,
  session: VisibilitySession,
  requested: string | null,
): Promise<{ ok: true; ownerUserId: string | null } | { ok: false; error: string }> {
  if (requested === null) return { ok: true, ownerUserId: null };
  if (!canSeeAll(session) && requested !== session.userId) {
    return { ok: false, error: "Adayı yalnızca kendinize atayabilirsiniz." };
  }
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.id, requested), eq(users.isActive, true)));
  return user ? { ok: true, ownerUserId: user.id } : { ok: false, error: "Seçilen kullanıcı bulunamadı." };
}
