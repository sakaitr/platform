import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Platform operatörleri — kiracıları kuran ve lisansları yöneten ekip.
 *
 * Kiracı içi rollerden ayrı tutuluyor: operatör kiracıların üstünde durur,
 * hiçbir kiracının rolü bu yetkiyi veremez. Liste ortam değişkeninden gelir
 * ki bir kiracı yöneticisi kendini operatör yapamasın.
 */
export function operatorEmails(): string[] {
  return (process.env.PLATFORM_OPERATORS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isOperator(email: string): boolean {
  return operatorEmails().includes(email.toLowerCase());
}

export async function requireOperator(): Promise<SessionUser> {
  const session = await requireAuth();
  if (!isOperator(session.email)) redirect("/dashboard");
  return session;
}
