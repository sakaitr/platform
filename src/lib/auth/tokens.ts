import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { invites, passwordResets, users, type UserRole } from "@/db/schema";
import { hashPassword } from "./password";
import { hashToken, revokeUserSessions } from "./session";

const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 86_400_000;

/** Kullanıcı yoksa da null döner — e-posta varlığını sızdırmamak için çağıran aynı mesajı gösterir. */
export async function createPasswordReset(email: string): Promise<string | null> {
  const [user] = await dbAdmin.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return null;

  const token = randomBytes(32).toString("hex");
  await dbAdmin.insert(passwordResets).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return token;
}

export async function consumePasswordReset(token: string, newPassword: string): Promise<boolean> {
  const [row] = await dbAdmin
    .select()
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return false;

  await dbAdmin
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, row.userId));
  await dbAdmin
    .update(passwordResets)
    .set({ usedAt: new Date() })
    .where(eq(passwordResets.id, row.id));
  // Şifre değişti — eski oturumlar geçersiz
  await revokeUserSessions(row.tenantId, row.userId);
  return true;
}

export async function createInvite(
  tenantId: string,
  input: { email: string; name: string; role: UserRole },
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await dbAdmin.insert(invites).values({
    tenantId,
    email: input.email,
    name: input.name,
    role: input.role,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return token;
}

export async function acceptInvite(token: string, password: string): Promise<boolean> {
  const [invite] = await dbAdmin
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!invite) return false;

  await dbAdmin.insert(users).values({
    tenantId: invite.tenantId,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    passwordHash: await hashPassword(password),
  });
  await dbAdmin.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  return true;
}
