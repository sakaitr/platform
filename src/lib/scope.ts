import { and, eq } from "drizzle-orm";
import { userScopes } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Kullanıcının erişebileceği firmalar.
 * `null` = kısıtlama yok (kiracının tamamı). Boş dizi hiçbir zaman dönmez —
 * kapsam kaydı silindiğinde null'a düşer.
 */
export async function getUserScope(tenantId: string, userId: string): Promise<string[] | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ companyId: userScopes.companyId })
      .from(userScopes)
      .where(and(eq(userScopes.tenantId, tenantId), eq(userScopes.userId, userId))),
  );
  return rows.length === 0 ? null : rows.map((r) => r.companyId);
}

/** Kapsamı TAM olarak değiştirir. Boş dizi = kısıtlamayı kaldır. */
export async function setUserScope(
  tenantId: string,
  userId: string,
  companyIds: readonly string[],
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(userScopes)
      .where(and(eq(userScopes.tenantId, tenantId), eq(userScopes.userId, userId)));

    if (companyIds.length > 0) {
      await tx.insert(userScopes).values(companyIds.map((companyId) => ({ tenantId, userId, companyId })));
    }
  });
}

/** `null` kapsam her firmaya izin verir; boş dizi hiçbirine. */
export function isInScope(scope: string[] | null, companyId: string): boolean {
  if (scope === null) return true;
  return scope.includes(companyId);
}
