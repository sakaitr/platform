import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import { getTenantAccess } from "@/lib/licensing";
import { importAgnoExport } from "@/modules/satis/import-agno";

/**
 * Agno CRM verisini Agno'nun kendi kiracısına aktarır (salt okur kaynak: JSON dışa aktarım dosyası).
 *
 *   npx tsx scripts/import-agno-crm.ts --file agno-export.json --tenant agno            # DENEME (varsayılan)
 *   npx tsx scripts/import-agno-crm.ts --file agno-export.json --tenant agno --apply    # gerçekten yaz
 *
 * Seçenekler: --report rapor.json (eşleme raporunu dosyaya yaz), --ignore-limit (max_leads sınırını yok say).
 * Agno CRM'in kapatılması ayrı bir karardır; bu betik hiçbir şeyi kesmez ya da silmez.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      tenant: { type: "string" },
      apply: { type: "boolean", default: false },
      report: { type: "string" },
      "ignore-limit": { type: "boolean", default: false },
    },
  });
  if (!values.file || !values.tenant) {
    console.error("Kullanım: --file <dışa-aktarım.json> --tenant <kiracı-slug> [--apply] [--report rapor.json] [--ignore-limit]");
    process.exit(1);
  }

  const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.slug, values.tenant));
  if (!tenant) {
    console.error(`Kiracı bulunamadı: ${values.tenant}`);
    process.exit(1);
  }
  const access = await getTenantAccess(tenant.id);
  if (access.modules.get("satis")?.allowed !== true) {
    console.error(`"${tenant.slug}" kiracısında Satış CRM modülü açık değil. Önce operatör panelinden ya da provision ile açın.`);
    process.exit(1);
  }

  const raw: unknown = JSON.parse(readFileSync(values.file, "utf8"));
  const report = await importAgnoExport(tenant.id, raw, { apply: values.apply, ignoreLimit: values["ignore-limit"] });

  console.log(`\n=== Eşleme raporu (${report.mode.toUpperCase()}) ===`);
  console.log("Adaylar:   ", report.leads);
  console.log("Fırsatlar: ", report.deals);
  console.log("Aktiviteler:", report.activities);
  console.log("Mezar taşı:", report.mezarTaslari);
  if (Object.keys(report.eslesmeyenAsamalar).length > 0) console.log("Eşleşmeyen aşamalar:", report.eslesmeyenAsamalar);
  if (Object.keys(report.taninmayanDurumlar).length > 0) console.log("Tanınmayan durumlar:", report.taninmayanDurumlar);
  if (report.eslesmeyenSahipler.length > 0) console.log("Eşleşmeyen sahipler:", report.eslesmeyenSahipler);
  for (const w of report.uyarilar) console.log("UYARI:", w);
  for (const e of report.hatalar) console.log("HATA:", e);
  if (!values.apply) console.log("\nBu bir DENEMEDİR: hiçbir şey yazılmadı. Yazmak için --apply ekleyin.");
  if (values.report) {
    writeFileSync(values.report, JSON.stringify(report, null, 2));
    console.log(`Rapor yazıldı: ${values.report}`);
  }
  process.exit(report.hatalar.length > 0 ? 2 : 0);
}

main().catch((error: unknown) => {
  console.error("İçe aktarma başarısız:", error instanceof Error ? error.message : error);
  process.exit(1);
});
