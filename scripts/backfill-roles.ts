import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { roles, tenants, users } from "@/db/schema";
import { applySectorPack } from "@/lib/sector/install";

/**
 * Faz 2 öncesi provizyon edilmiş kiracılara sektör paketi rollerini kurar ve
 * rolü olmayan owner kullanıcıları "owner" rolüne bağlar. Idempotent.
 */
async function main(): Promise<void> {
  const allTenants = await dbAdmin.select().from(tenants);
  let rolesInstalled = 0;
  let usersLinked = 0;

  for (const tenant of allTenants) {
    await applySectorPack(tenant.id, tenant.sectorPack);
    rolesInstalled += 1;

    const [ownerRole] = await dbAdmin
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenant.id), eq(roles.key, "owner")))
      .limit(1);
    if (!ownerRole) continue;

    const orphans = await dbAdmin
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, "owner"), isNull(users.roleId)));

    for (const orphan of orphans) {
      await dbAdmin.update(users).set({ roleId: ownerRole.id }).where(eq(users.id, orphan.id));
      usersLinked += 1;
    }
  }

  console.log(`Backfill complete: ${rolesInstalled} tenants, ${usersLinked} owners linked`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
