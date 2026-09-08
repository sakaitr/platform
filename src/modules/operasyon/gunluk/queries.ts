import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
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

/** Tarih aralığında kim hangi gün doldurdu — yönetici görünümü. */
export async function listEntriesRange(
  tenantId: string,
  input: { from: string; to: string; userId?: string },
) {
  const parts = [
    eq(dailyEntries.tenantId, tenantId),
    gte(dailyEntries.entryDate, input.from),
    lte(dailyEntries.entryDate, input.to),
  ];
  if (input.userId) parts.push(eq(dailyEntries.userId, input.userId));

  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: dailyEntries.id,
        userId: dailyEntries.userId,
        userName: users.name,
        entryDate: dailyEntries.entryDate,
        answers: dailyEntries.answers,
        note: dailyEntries.note,
        createdAt: dailyEntries.createdAt,
      })
      .from(dailyEntries)
      .innerJoin(users, eq(users.id, dailyEntries.userId))
      .where(and(...parts))
      .orderBy(desc(dailyEntries.entryDate), asc(users.name)),
  );
}

/**
 * Katılım özeti: kim kaç gün doldurdu, kaç gün eksik.
 * Yalnız aktif kullanıcılar sayılır.
 */
export async function participation(tenantId: string, from: string, to: string) {
  const gunSayisi =
    Math.floor(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ) + 1;

  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        kisi: users.name,
        doldurulan: sql<number>`count(${dailyEntries.id})`,
        sonKayit: sql<string | null>`max(${dailyEntries.entryDate})`,
      })
      .from(users)
      .leftJoin(
        dailyEntries,
        and(
          eq(dailyEntries.userId, users.id),
          gte(dailyEntries.entryDate, from),
          lte(dailyEntries.entryDate, to),
        ),
      )
      .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
      .groupBy(users.name)
      .orderBy(asc(users.name)),
  );

  return rows.map((r) => ({
    kisi: r.kisi,
    doldurulan: Number(r.doldurulan),
    eksik: Math.max(0, gunSayisi - Number(r.doldurulan)),
    sonKayit: r.sonKayit,
    oran: gunSayisi === 0 ? 0 : Math.round((Number(r.doldurulan) / gunSayisi) * 100),
  }));
}
