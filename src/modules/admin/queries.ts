import { asc, eq } from "drizzle-orm";
import { entityFields, terminologyOverrides, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listUsers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name)),
  );
}

export async function listOverrides(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId))
      .orderBy(asc(terminologyOverrides.termKey)),
  );
}

export async function listAllFields(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(entityFields)
      .where(eq(entityFields.tenantId, tenantId))
      .orderBy(asc(entityFields.entityKey), asc(entityFields.position)),
  );
}
