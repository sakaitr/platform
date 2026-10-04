import { and, eq, isNotNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants, users } from "@/db/schema";
import { enqueueEmail } from "@/lib/queue";

const WARN_WINDOW_DAYS = 15;

/**
 * Günlük çalışır. Grace süresi dolan abonelikleri expired yapar,
 * bitişi yaklaşanlar için kiracı sahibine uyarı kuyruğa atar.
 */
export async function runLicenseExpiryCheck(
  now: Date = new Date(),
): Promise<{ warned: number; expired: number }> {
  const rows = await dbAdmin
    .select({
      subId: subscriptions.id,
      tenantId: subscriptions.tenantId,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
      graceDays: subscriptions.graceDays,
      tenantName: tenants.name,
    })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(and(isNotNull(subscriptions.currentPeriodEnd), eq(tenants.isActive, true)));

  let warned = 0;
  let expired = 0;

  for (const row of rows) {
    if (!row.periodEnd || row.status === "expired" || row.status === "suspended") continue;

    const graceEnd = row.periodEnd.getTime() + Number(row.graceDays) * 86_400_000;

    if (now.getTime() > graceEnd) {
      await dbAdmin
        .update(subscriptions)
        .set({ status: "expired", updatedAt: now })
        .where(eq(subscriptions.id, row.subId));
      expired += 1;
      continue;
    }

    const daysLeft = Math.ceil((row.periodEnd.getTime() - now.getTime()) / 86_400_000);
    if (daysLeft >= 0 && daysLeft <= WARN_WINDOW_DAYS) {
      const owners = await dbAdmin
        .select({ email: users.email })
        .from(users)
        .where(
          and(
            eq(users.tenantId, row.tenantId),
            eq(users.role, "owner"),
            eq(users.isActive, true),
          ),
        );
      for (const owner of owners) {
        await enqueueEmail({
          to: owner.email,
          subject: `${row.tenantName} — aboneliğinizin bitişine ${daysLeft} gün kaldı`,
          body: `Aboneliğiniz ${row.periodEnd.toLocaleDateString("tr-TR")} tarihinde sona eriyor. Kesintisiz kullanım için lütfen yenileyin.`,
        });
      }
      warned += 1;
    }
  }

  return { warned, expired };
}
