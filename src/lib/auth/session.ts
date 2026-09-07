import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { sessions, users, type UserRole } from "@/db/schema";

export const SESSION_DURATION_DAYS = 30;

export type SessionUser = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Oturum tabloları dbAdmin ile okunur: giriş anında henüz tenant context'i YOK
 * (token'dan tenant'ı öğreniyoruz). Bu tek istisna, denetlenmiş ve dar kapsamlı.
 */
export async function createSession(userId: string, tenantId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 86_400_000);
  await dbAdmin.insert(sessions).values({ userId, tenantId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export async function getSessionByToken(token: string): Promise<SessionUser | null> {
  const rows = await dbAdmin
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;
  return { userId: row.userId, tenantId: row.tenantId, email: row.email, name: row.name, role: row.role };
}

export async function destroySessionByToken(token: string): Promise<void> {
  await dbAdmin
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** Rol/yetki değişiminde çağrılır — eski oturumlar eski yetkiyle devam etmesin. */
export async function revokeUserSessions(tenantId: string, userId: string): Promise<void> {
  await dbAdmin
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
      ),
    );
}
