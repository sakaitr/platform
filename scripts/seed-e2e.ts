import "dotenv/config";
import { provisionTenant } from "@/lib/sector/install";

async function main(): Promise<void> {
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
  console.log("E2E tenants provisioned");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
