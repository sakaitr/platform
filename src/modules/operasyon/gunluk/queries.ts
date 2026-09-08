import { and, asc, desc, eq } from "drizzle-orm";
import { dailyEntries, dailyQuestions, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listQuestions(tenantId: string, onlyActive = false) {
  return withTenant(tenantId, (tx) => {
    const where = onlyActive
      ? and(eq(dailyQuestions.tenantId, tenantId), eq(dailyQuestions.isActive, true))!
      : eq(dailyQuestions.tenantId, tenantId);
    return tx
      .select()
      .from(dailyQuestions)
      .where(where)
      .orderBy(asc(dailyQuestions.position), asc(dailyQuestions.label));
  });
}

/** Kullanıcının belirli güne ait check-in'i — yoksa null. */
export async function getEntry(tenantId: string, userId: string, day: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(dailyEntries)
      .where(
        and(
          eq(dailyEntries.tenantId, tenantId),
          eq(dailyEntries.userId, userId),
          eq(dailyEntries.entryDate, day),
        ),
      ),
  );
  return rows[0] ?? null;
}

/** Yöneticinin gördüğü liste: kim, hangi gün doldurdu. */
export async function listEntries(tenantId: string, day: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: dailyEntries.id,
        userName: users.name,
        entryDate: dailyEntries.entryDate,
        answers: dailyEntries.answers,
        note: dailyEntries.note,
        createdAt: dailyEntries.createdAt,
      })
      .from(dailyEntries)
      .innerJoin(users, eq(users.id, dailyEntries.userId))
      .where(and(eq(dailyEntries.tenantId, tenantId), eq(dailyEntries.entryDate, day)))
      .orderBy(desc(dailyEntries.createdAt)),
  );
}
