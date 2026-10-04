import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionByToken, type SessionUser } from "./session";

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "agno_platform_session";

export async function getCurrentSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

export async function requireAuth(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

/** Oturumun izin kümesinde anahtar var mı. */
export function hasPermission(session: SessionUser, permissionKey: string): boolean {
  return session.permissions.has(permissionKey);
}

export async function requirePermission(permissionKey: string): Promise<SessionUser> {
  const session = await requireAuth();
  if (!hasPermission(session, permissionKey)) redirect("/dashboard");
  return session;
}

/**
 * İzin + modül lisansı birlikte. Server action'larda kullanılır:
 * sayfayı gizlemek yetmez, aksiyon da lisanssız kiracıya çalışmamalı.
 */
export async function requireModule(permissionKey: string, moduleKey: string): Promise<SessionUser> {
  const session = await requirePermission(permissionKey);
  const { getTenantAccess } = await import("@/lib/licensing");
  const access = await getTenantAccess(session.tenantId);
  if (access.modules.get(moduleKey)?.allowed !== true) redirect("/dashboard");
  return session;
}
