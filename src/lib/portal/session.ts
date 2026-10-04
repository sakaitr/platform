import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { companies, portalSessions, portalUserCompanies, portalUsers } from "@/db/schema";
import { dbAdmin } from "@/db/admin";

export const PORTAL_COOKIE_NAME = process.env.PORTAL_COOKIE_NAME ?? "agno_portal_session";
const SESSION_DAYS = 14;

export type PortalSession = {
  portalUserId: string;
  tenantId: string;
  email: string;
  fullName: string;
  /** Erişebildiği firmalar — portalın tüm sorguları bununla sınırlanır. */
  companyIds: string[];
  companyNames: string[];
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Portal oturumu. Personel oturumundan tamamen ayrı:
 * ayrı çerez, ayrı tablo, ayrı yetki modeli.
 * dbAdmin kullanır çünkü oturum çözülmeden hangi kiracı olduğu bilinmiyor.
 */
export async function createPortalSession(portalUserId: string, tenantId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await dbAdmin.insert(portalSessions).values({
    tenantId,
    portalUserId,
    tokenHash: hashToken(token),
    expiresAt,
  });
  await dbAdmin
    .update(portalUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(portalUsers.id, portalUserId));
  return token;
}

export async function getPortalSession(token: string): Promise<PortalSession | null> {
  const rows = await dbAdmin
    .select({
      portalUserId: portalUsers.id,
      tenantId: portalUsers.tenantId,
      email: portalUsers.email,
      fullName: portalUsers.fullName,
      isActive: portalUsers.isActive,
    })
    .from(portalSessions)
    .innerJoin(portalUsers, eq(portalUsers.id, portalSessions.portalUserId))
    .where(
      and(
        eq(portalSessions.tokenHash, hashToken(token)),
        gt(portalSessions.expiresAt, new Date()),
        isNull(portalSessions.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;

  // Firma erişimi her istekte DB'den çözülür — çerezde taşınmaz.
  const links = await dbAdmin
    .select({ companyId: companies.id, companyName: companies.name })
    .from(portalUserCompanies)
    .innerJoin(companies, eq(companies.id, portalUserCompanies.companyId))
    .where(eq(portalUserCompanies.portalUserId, row.portalUserId));

  return {
    portalUserId: row.portalUserId,
    tenantId: row.tenantId,
    email: row.email,
    fullName: row.fullName,
    companyIds: links.map((l) => l.companyId),
    companyNames: links.map((l) => l.companyName),
  };
}

export async function revokePortalSession(token: string): Promise<void> {
  await dbAdmin
    .update(portalSessions)
    .set({ revokedAt: new Date() })
    .where(eq(portalSessions.tokenHash, hashToken(token)));
}
