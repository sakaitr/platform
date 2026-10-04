import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { rolePermissions, roles, tenants } from "@/db/schema";
import { resetDatabase } from "./setup";

async function seedTenant(slug: string) {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  return t!;
}

describe("rbac şeması", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı kiracıda aynı rol anahtarı iki kez olamaz", async () => {
    const tenant = await seedTenant("a");
    await dbAdmin.insert(roles).values({ tenantId: tenant.id, key: "operasyon", label: "Operasyon" });
    await expect(
      dbAdmin.insert(roles).values({ tenantId: tenant.id, key: "operasyon", label: "Başka" }),
    ).rejects.toThrow();
  });

  it("farklı kiracılar aynı rol anahtarını kullanabilir", async () => {
    const a = await seedTenant("a");
    const b = await seedTenant("b");
    await dbAdmin.insert(roles).values({ tenantId: a.id, key: "operasyon", label: "Operasyon" });
    await dbAdmin.insert(roles).values({ tenantId: b.id, key: "operasyon", label: "Operasyon" });
    const rows = await dbAdmin.select().from(roles);
    expect(rows).toHaveLength(2);
  });

  it("aynı role aynı izin iki kez verilemez", async () => {
    const tenant = await seedTenant("a");
    const [role] = await dbAdmin
      .insert(roles)
      .values({ tenantId: tenant.id, key: "operasyon", label: "Operasyon" })
      .returning();
    await dbAdmin
      .insert(rolePermissions)
      .values({ tenantId: tenant.id, roleId: role!.id, permissionKey: "araclar:read" });
    await expect(
      dbAdmin
        .insert(rolePermissions)
        .values({ tenantId: tenant.id, roleId: role!.id, permissionKey: "araclar:read" }),
    ).rejects.toThrow();
  });
});

import { createRole, getRolePermissions, listRolesWithCounts, setRolePermissions } from "@/lib/rbac";

describe("rol çözümleme", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rol oluşturur ve izinlerini döner", async () => {
    const tenant = await seedTenant("a");
    const roleId = await createRole(tenant.id, {
      key: "operasyon",
      label: "Operasyon",
      permissions: ["araclar:read", "arrivals:create"],
    });

    const perms = await getRolePermissions(tenant.id, roleId);
    expect(perms.has("araclar:read")).toBe(true);
    expect(perms.has("arrivals:create")).toBe(true);
    expect(perms.size).toBe(2);
  });

  it("geçersiz izin anahtarını reddeder", async () => {
    const tenant = await seedTenant("a");
    await expect(
      createRole(tenant.id, { key: "x", label: "X", permissions: ["uydurma:read"] }),
    ).rejects.toThrow(/Ge.ersiz izin/);
  });

  it("izinleri tam olarak değiştirir (eskiler silinir)", async () => {
    const tenant = await seedTenant("a");
    const roleId = await createRole(tenant.id, {
      key: "operasyon",
      label: "Operasyon",
      permissions: ["araclar:read", "araclar:create"],
    });

    await setRolePermissions(tenant.id, roleId, ["yolcular:read"]);
    const perms = await getRolePermissions(tenant.id, roleId);
    expect([...perms]).toEqual(["yolcular:read"]);
  });

  it("rolleri izin sayısıyla listeler", async () => {
    const tenant = await seedTenant("a");
    await createRole(tenant.id, { key: "a", label: "A", permissions: ["araclar:read"] });
    await createRole(tenant.id, { key: "b", label: "B", permissions: ["araclar:read", "araclar:create"] });

    const list = await listRolesWithCounts(tenant.id);
    expect(list.find((r) => r.key === "a")?.permissionCount).toBe(1);
    expect(list.find((r) => r.key === "b")?.permissionCount).toBe(2);
  });
});
