import "dotenv/config";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";

export async function resetDatabase(): Promise<void> {
  await dbAdmin.execute(sql`
    TRUNCATE TABLE crm_api_keys, crm_webhook_deliveries, crm_deleted_external, crm_inbound_events,
      crm_integrations, crm_templates, crm_quotes, crm_activities, crm_deals, crm_contacts, crm_leads,
      crm_stages, import_job_rows, import_jobs, audit_logs, invites, password_resets, sessions,
      user_scopes, role_permissions, roles, users,
      numbering_sequences, entity_fields, terminology_overrides,
      tenant_capabilities, tenant_modules, subscriptions, tenants
    RESTART IDENTITY CASCADE
  `);
}
