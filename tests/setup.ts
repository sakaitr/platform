import "dotenv/config";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";

export async function resetDatabase(): Promise<void> {
  await dbAdmin.execute(sql`
    TRUNCATE TABLE audit_logs, invites, password_resets, sessions,
      user_scopes, role_permissions, roles, users,
      numbering_sequences, entity_fields, terminology_overrides,
      tenant_capabilities, tenant_modules, subscriptions, tenants
    RESTART IDENTITY CASCADE
  `);
}
