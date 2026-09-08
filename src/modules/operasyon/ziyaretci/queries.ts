import { and, desc, eq, gte, isNull, or, type SQL } from "drizzle-orm";
import { companies, visitorLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/** İçerideler üstte, sonra o günün çıkanları. */
export async function listVisitors(tenantId: string, day: string) {
  const dayStart = new Date(`${day}T00:00:00+03:00`);
  const where: SQL = and(
    eq(visitorLogs.tenantId, tenantId),
    or(isNull(visitorLogs.exitedAt), gte(visitorLogs.enteredAt, dayStart))!,
  )!;

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: visitorLogs.id,
        visitorName: visitorLogs.visitorName,
        reason: visitorLogs.reason,
        hostName: visitorLogs.hostName,
        plate: visitorLogs.plate,
        enteredAt: visitorLogs.enteredAt,
        exitedAt: visitorLogs.exitedAt,
        companyName: companies.name,
      })
      .from(visitorLogs)
      .leftJoin(companies, eq(companies.id, visitorLogs.companyId))
      .where(where)
      .orderBy(desc(visitorLogs.enteredAt)),
  );
}
