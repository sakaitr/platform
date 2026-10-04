import { desc, eq } from "drizzle-orm";
import { importJobs } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listImportJobs(tenantId: string, limit = 25) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(importJobs)
      .where(eq(importJobs.tenantId, tenantId))
      .orderBy(desc(importJobs.createdAt))
      .limit(limit),
  );
}
