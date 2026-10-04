import "dotenv/config";
import { parseArgs } from "node:util";
import { provisionTenant } from "@/lib/sector/install";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      pack: { type: "string" },
      email: { type: "string" },
      "owner-name": { type: "string" },
      password: { type: "string" },
      "trial-days": { type: "string" },
    },
  });

  const required = ["name", "slug", "pack", "email", "password"] as const;
  for (const key of required) {
    if (!values[key]) {
      console.error(`Missing --${key}`);
      process.exit(1);
    }
  }

  const result = await provisionTenant({
    name: values.name!,
    slug: values.slug!,
    sectorPack: values.pack!,
    ownerEmail: values.email!,
    ownerName: values["owner-name"] ?? values.email!,
    ownerPassword: values.password!,
    trialDays: values["trial-days"] ? Number(values["trial-days"]) : undefined,
  });

  console.log(`Provisioned tenant ${result.tenantId} (owner ${result.userId})`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Provision failed:", error);
  process.exit(1);
});
