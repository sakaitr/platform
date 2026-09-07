import { auditLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function writeAuditLog(input: {
  tenantId: string;
  userId: string | null;
  event: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await withTenant(input.tenantId, (tx) =>
    tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      userId: input.userId,
      event: input.event,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    }),
  );
}
