import "dotenv/config";
import { inArray } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { createRole } from "@/lib/rbac";
import { provisionTenant } from "@/lib/sector/install";

const E2E_SLUGS = ["e2e-lojistik", "e2e-pilates", "e2e-kisitli"];

async function main(): Promise<void> {
  // Idempotent: önceki E2E kiracılarını temizle (cascade ile bağlı her şey gider)
  await dbAdmin.delete(tenants).where(inArray(tenants.slug, E2E_SLUGS));

  await provisionTenant({
    name: "E2E Lojistik",
    slug: "e2e-lojistik",
    sectorPack: "lojistik",
    ownerEmail: "lojistik@e2e.test",
    ownerName: "Lojistik Owner",
    ownerPassword: "E2eTest1234!",
  });
  await provisionTenant({
    name: "E2E Pilates",
    slug: "e2e-pilates",
    sectorPack: "pilates",
    ownerEmail: "pilates@e2e.test",
    ownerName: "Pilates Owner",
    ownerPassword: "E2eTest1234!",
  });
  // Kısıtlı rollü kullanıcı — menü süzgecini doğrulamak için
  const { tenantId } = await provisionTenant({
    name: "E2E Kisitli",
    slug: "e2e-kisitli",
    sectorPack: "turizm",
    ownerEmail: "kisitli-owner@e2e.test",
    ownerName: "Kisitli Owner",
    ownerPassword: "E2eTest1234!",
  });

  const viewerRoleId = await createRole(tenantId, {
    key: "sadece_dashboard",
    label: "Sadece Dashboard",
    hierarchyLevel: 0,
    permissions: ["dashboard:read"],
  });

  await dbAdmin.insert(users).values({
    tenantId,
    email: "kisitli@e2e.test",
    name: "Kisitli Kullanici",
    passwordHash: await hashPassword("E2eTest1234!"),
    roleId: viewerRoleId,
  });

  console.log("E2E tenants provisioned");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
