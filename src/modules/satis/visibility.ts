import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** Görünürlük için gereken en az oturum bilgisi (SessionUser bunu karşılar). */
export type VisibilitySession = {
  tenantId: string;
  userId: string;
  permissions: ReadonlySet<string>;
};

/** `satis_hepsi:read` olan (Yönetici, İzleyici) tüm satış kayıtlarını görür. */
export function canSeeAll(session: Pick<VisibilitySession, "permissions">): boolean {
  return session.permissions.has("satis_hepsi:read");
}

/**
 * Satışçı yalnız kendine atanmış ya da sahipsiz kayıtları görür. RLS kiracıyı izole eder;
 * bu süzgeç kiracı İÇİNDEKİ sahipliği uygular. Her sorguya ve her server action'a uygulanmalı.
 * `undefined` dönerse kısıt yok.
 */
export function ownerVisibility(column: AnyPgColumn, session: VisibilitySession): SQL | undefined {
  if (canSeeAll(session)) return undefined;
  return or(eq(column, session.userId), isNull(column));
}
