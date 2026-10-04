import { and, asc, eq } from "drizzle-orm";
import { crmTemplates } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listTemplates(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(crmTemplates)
      .where(eq(crmTemplates.tenantId, tenantId))
      .orderBy(asc(crmTemplates.channel), asc(crmTemplates.name)),
  );
}

export async function getTemplate(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(crmTemplates).where(and(eq(crmTemplates.tenantId, tenantId), eq(crmTemplates.id, id))),
  );
  return rows[0] ?? null;
}
