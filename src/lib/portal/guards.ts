import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSession, PORTAL_COOKIE_NAME, type PortalSession } from "./session";

export async function getCurrentPortalSession(): Promise<PortalSession | null> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE_NAME)?.value;
  if (!token) return null;
  return getPortalSession(token);
}

export async function requirePortal(): Promise<PortalSession> {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/giris");
  // Hiçbir firmaya bağlı olmayan hesap veri göremez — boş sayfa yerine açık hata.
  if (session.companyIds.length === 0) redirect("/portal/erisim-yok");
  return session;
}
