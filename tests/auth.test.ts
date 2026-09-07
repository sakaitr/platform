import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import {
  createSession,
  destroySessionByToken,
  getSessionByToken,
  hashPassword,
  revokeUserSessions,
  verifyPassword,
} from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { resetDatabase } from "./setup";

async function seedUser() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [user] = await dbAdmin
    .insert(users)
    .values({
      tenantId: tenant!.id,
      email: "a@x.com",
      name: "A",
      passwordHash: await hashPassword("Gizli1234!"),
      role: "admin",
    })
    .returning();
  return { tenant: tenant!, user: user! };
}

describe("şifre", () => {
  it("hash üretir ve doğrular", async () => {
    const hash = await hashPassword("Gizli1234!");
    expect(hash).not.toBe("Gizli1234!");
    expect(await verifyPassword("Gizli1234!", hash)).toBe(true);
    expect(await verifyPassword("yanlis", hash)).toBe(false);
  });
});

describe("oturum", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("oturum açar ve token ile çözer", async () => {
    const { tenant, user } = await seedUser();
    const token = await createSession(user.id, tenant.id);
    const s = await getSessionByToken(token);
    expect(s?.userId).toBe(user.id);
    expect(s?.role).toBe("admin");
  });

  it("geçersiz ve iptal edilmiş token null döner", async () => {
    const { tenant, user } = await seedUser();
    expect(await getSessionByToken("yok")).toBeNull();
    const token = await createSession(user.id, tenant.id);
    await destroySessionByToken(token);
    expect(await getSessionByToken(token)).toBeNull();
  });

  it("rol değişince tüm oturumlar iptal edilebilir", async () => {
    const { tenant, user } = await seedUser();
    const t1 = await createSession(user.id, tenant.id);
    const t2 = await createSession(user.id, tenant.id);
    await revokeUserSessions(tenant.id, user.id);
    expect(await getSessionByToken(t1)).toBeNull();
    expect(await getSessionByToken(t2)).toBeNull();
  });
});

describe("izinler", () => {
  it("owner yönetir, viewer yönetemez", () => {
    expect(hasPermission("owner", "users.manage")).toBe(true);
    expect(hasPermission("viewer", "users.manage")).toBe(false);
    expect(hasPermission("viewer", "dashboard.read")).toBe(true);
  });
});
