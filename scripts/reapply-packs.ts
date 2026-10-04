import "dotenv/config";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import { applySectorPack, getPack } from "@/lib/sector/install";

/**
 * Sektör paketini tüm kiracılara yeniden uygular.
 * Idempotent: yeni modül/yetenek/alan eklendiğinde mevcut kiracıları günceller,
 * var olanı bozmaz. Modül portlarından sonra çalıştırılır.
 */
async function main(): Promise<void> {
  const rows = await dbAdmin.select().from(tenants);
  for (const tenant of rows) {
    const pack = getPack(tenant.sectorPack);
    await applySectorPack(tenant.id, tenant.sectorPack);
    console.log(`${tenant.slug} → ${pack.key} v${pack.version} (${pack.modules.length} modül)`);
  }
  console.log(`${rows.length} kiracı güncellendi.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
