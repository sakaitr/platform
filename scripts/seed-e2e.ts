import "dotenv/config";
import { inArray } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { and, eq } from "drizzle-orm";
import {
  companies,
  crmDeals,
  crmLeads,
  crmStages,
  passengers,
  roles,
  portalUserCompanies,
  portalUsers,
  tenants,
  tickets,
  users,
  vehicles,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { createRole } from "@/lib/rbac";
import { provisionTenant } from "@/lib/sector/install";

const E2E_SLUGS = ["e2e-lojistik", "e2e-pilates", "e2e-kisitli", "e2e-satis", "e2e-satis-b"];

/** Satış CRM (AtriCRM) kiracıları: yönetici, iki satışçı + izolasyon sınaması için ikinci kiracı. */
async function seedSatis(): Promise<void> {
  const { tenantId } = await provisionTenant({
    name: "E2E Satis",
    slug: "e2e-satis",
    sectorPack: "satis_crm",
    ownerEmail: "satis@e2e.test",
    ownerName: "Satis Owner",
    ownerPassword: "E2eTest1234!",
  });
  await provisionTenant({
    name: "E2E Satis B",
    slug: "e2e-satis-b",
    sectorPack: "satis_crm",
    ownerEmail: "satis-b@e2e.test",
    ownerName: "Satis B Owner",
    ownerPassword: "E2eTest1234!",
  });

  const roleId = async (key: string): Promise<string> => {
    const [row] = await dbAdmin
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)));
    return row!.id;
  };
  const passwordHash = await hashPassword("E2eTest1234!");
  const [manager, repOne, repTwo] = await dbAdmin
    .insert(users)
    .values([
      { tenantId, email: "yonetici@e2e.test", name: "Yonetici Kisi", passwordHash, roleId: await roleId("satis_yonetici") },
      { tenantId, email: "satisci1@e2e.test", name: "Satisci Bir", passwordHash, roleId: await roleId("satisci") },
      { tenantId, email: "satisci2@e2e.test", name: "Satisci Iki", passwordHash, roleId: await roleId("satisci") },
    ])
    .returning();
  void manager;
  await dbAdmin.insert(crmLeads).values([
    { tenantId, name: "Birinci Satiscinin Adayi", ownerUserId: repOne!.id, source: "manual" },
    { tenantId, name: "Ikinci Satiscinin Adayi", ownerUserId: repTwo!.id, source: "manual" },
    { tenantId, name: "Sahipsiz Aday", source: "manual" },
  ]);

  const [firstStage] = await dbAdmin
    .select({ id: crmStages.id })
    .from(crmStages)
    .where(and(eq(crmStages.tenantId, tenantId), eq(crmStages.key, "yeni")));
  await dbAdmin.insert(crmDeals).values([
    { tenantId, title: "Birinci Satiscinin Firsati", stageId: firstStage!.id, ownerUserId: repOne!.id, value: "1000.00" },
    { tenantId, title: "Ikinci Satiscinin Firsati", stageId: firstStage!.id, ownerUserId: repTwo!.id, value: "2000.00" },
  ]);
}

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

  // Kapsam testleri için iki firma + araç + yolcu
  const [alfa, beta] = await dbAdmin
    .insert(companies)
    .values([
      { tenantId, name: "Alfa Sanayi" },
      { tenantId, name: "Beta Tekstil" },
    ])
    .returning();
  await dbAdmin.insert(vehicles).values([
    { tenantId, companyId: alfa!.id, plate: "34ABC01", capacity: 27, brand: "Mercedes" },
    { tenantId, companyId: beta!.id, plate: "34XYZ02", capacity: 16, brand: "Ford" },
  ]);
  await dbAdmin.insert(passengers).values([
    { tenantId, companyId: alfa!.id, fullName: "Alfa Yolcu" },
    { tenantId, companyId: beta!.id, fullName: "Beta Yolcu" },
  ]);

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

  // Portal kullanıcısı yalnız Alfa'ya bağlı — izolasyon testinin dayanağı
  const [portalUser] = await dbAdmin
    .insert(portalUsers)
    .values({
      tenantId,
      email: "portal@e2e.test",
      fullName: "Portal Musteri",
      passwordHash: await hashPassword("E2eTest1234!"),
    })
    .returning();
  await dbAdmin
    .insert(portalUserCompanies)
    .values({ tenantId, portalUserId: portalUser!.id, companyId: alfa!.id });

  // Firmasız portal hesabı — erişim yok sayfasını doğrular
  await dbAdmin.insert(portalUsers).values({
    tenantId,
    email: "portal-bos@e2e.test",
    fullName: "Bagsiz Musteri",
    passwordHash: await hashPassword("E2eTest1234!"),
  });

  // İki firmanın da talebi var; portal yalnız Alfa'nınkini görmeli
  await dbAdmin.insert(tickets).values([
    { tenantId, ticketNo: "SEED-ALFA", title: "Alfa talebi", companyId: alfa!.id },
    { tenantId, ticketNo: "SEED-BETA", title: "Beta talebi", companyId: beta!.id },
  ]);

  await seedSatis();

  console.log("E2E tenants provisioned");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
