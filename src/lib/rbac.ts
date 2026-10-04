import { and, eq, sql } from "drizzle-orm";
import { rolePermissions, roles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isValidPermission } from "./permissions";

export type CreateRoleInput = {
  key: string;
  label: string;
  hierarchyLevel?: number;
  isSystem?: boolean;
  permissions: readonly string[];
};

function assertValidPermissions(permissions: readonly string[]): void {
  const invalid = permissions.filter((p) => !isValidPermission(p));
  if (invalid.length > 0) {
    throw new Error(`Geçersiz izin anahtarı: ${invalid.join(", ")}`);
  }
}

export async function createRole(tenantId: string, input: CreateRoleInput): Promise<string> {
  assertValidPermissions(input.permissions);

  return withTenant(tenantId, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({
        tenantId,
        key: input.key,
        label: input.label,
        hierarchyLevel: input.hierarchyLevel ?? 0,
        isSystem: input.isSystem ?? false,
      })
      .returning({ id: roles.id });

    const roleId = role!.id;
    if (input.permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(input.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
    }
    return roleId;
  });
}

export async function getRolePermissions(tenantId: string, roleId: string): Promise<Set<string>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId))),
  );
  return new Set(rows.map((r) => r.permissionKey));
}

/** İzin listesini TAM olarak değiştirir — mevcutlar silinir. */
export async function setRolePermissions(
  tenantId: string,
  roleId: string,
  permissions: readonly string[],
): Promise<void> {
  assertValidPermissions(permissions);

  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));

    if (permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
    }
  });
}

export async function listRolesWithCounts(tenantId: string): Promise<
  Array<{
    id: string;
    key: string;
    label: string;
    hierarchyLevel: number;
    isSystem: boolean;
    permissionCount: number;
  }>
> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: roles.id,
        key: roles.key,
        label: roles.label,
        hierarchyLevel: roles.hierarchyLevel,
        isSystem: roles.isSystem,
        permissionCount: sql<number>`count(${rolePermissions.id})::int`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(roles.tenantId, tenantId))
      .groupBy(roles.id)
      .orderBy(roles.hierarchyLevel, roles.label),
  );
}
