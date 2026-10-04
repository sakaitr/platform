import { and, asc, eq, isNotNull } from "drizzle-orm";
import { importJobRows, importJobs, type ImportJob, type ImportJobRow } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { mapRows, validateRow } from "./parse";
import { getImportTarget } from "./targets";

export type CreateImportInput = {
  targetKey: string;
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
};

/** Satırları eşler, doğrular ve iş olarak kaydeder. Henüz hiçbir şey yazılmaz. */
export async function createImportJob(
  tenantId: string,
  userId: string,
  input: CreateImportInput,
): Promise<string> {
  const target = getImportTarget(input.targetKey);
  const mapped = mapRows(input.headers, input.rows, input.mapping);
  const validated = mapped.map((values) => ({ values, errors: validateRow(target, values) }));
  const validCount = validated.filter((r) => r.errors.length === 0).length;

  return withTenant(tenantId, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        tenantId,
        targetKey: input.targetKey,
        fileName: input.fileName,
        status: "validated",
        totalRows: validated.length,
        validRows: validCount,
        errorRows: validated.length - validCount,
        createdBy: userId,
      })
      .returning({ id: importJobs.id });

    const jobId = job!.id;
    if (validated.length > 0) {
      await tx.insert(importJobRows).values(
        validated.map((r, i) => ({
          tenantId,
          jobId,
          rowNumber: i + 1,
          raw: r.values,
          errors: r.errors,
        })),
      );
    }
    return jobId;
  });
}

export async function getImportJob(
  tenantId: string,
  jobId: string,
): Promise<{ job: ImportJob; rows: ImportJobRow[] }> {
  return withTenant(tenantId, async (tx) => {
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
      .limit(1);
    if (!job) throw new Error("Import işi bulunamadı.");

    const rows = await tx
      .select()
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.jobId, jobId)))
      .orderBy(asc(importJobRows.rowNumber));

    return { job, rows };
  });
}

/** Hatasız satırları hedefe yazar. Tek transaction — kısmi uygulama olmaz. */
export async function applyImportJob(
  tenantId: string,
  jobId: string,
): Promise<{ inserted: number }> {
  return withTenant(tenantId, async (tx) => {
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
      .limit(1);
    if (!job) throw new Error("Import işi bulunamadı.");
    if (job.status === "applied") throw new Error("Bu iş zaten uygulandı.");
    if (job.status === "rolled_back") throw new Error("Geri alınmış iş yeniden uygulanamaz.");

    const target = getImportTarget(job.targetKey);
    const rows = await tx
      .select()
      .from(importJobRows)
      .where(and(eq(importJobRows.tenantId, tenantId), eq(importJobRows.jobId, jobId)))
      .orderBy(asc(importJobRows.rowNumber));

    let inserted = 0;
    for (const row of rows) {
      const errors = row.errors as string[];
      if (errors.length > 0) continue;

      const insertedId = await target.insert(tx, tenantId, row.raw as Record<string, string>);
      await tx.update(importJobRows).set({ insertedId }).where(eq(importJobRows.id, row.id));
      inserted += 1;
    }

    await tx
      .update(importJobs)
      .set({ status: "applied", appliedAt: new Date() })
      .where(eq(importJobs.id, jobId));

    return { inserted };
  });
}

/**
 * Geri alma: SADECE bu iş tarafından eklenen kayıtları siler.
 * Sonradan güncellenen kayıtlar geri alınmaz — aycanops'taki sınırın aynısı,
 * bilinçli: import sonrası düzenlemeyi ezmemek için.
 */
export async function rollbackImportJob(
  tenantId: string,
  jobId: string,
): Promise<{ deleted: number }> {
  return withTenant(tenantId, async (tx) => {
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.id, jobId)))
      .limit(1);
    if (!job) throw new Error("Import işi bulunamadı.");
    if (job.status !== "applied") throw new Error("Uygulanmamış iş geri alınamaz.");

    const target = getImportTarget(job.targetKey);
    const rows = await tx
      .select()
      .from(importJobRows)
      .where(
        and(
          eq(importJobRows.tenantId, tenantId),
          eq(importJobRows.jobId, jobId),
          isNotNull(importJobRows.insertedId),
        ),
      );

    let deleted = 0;
    for (const row of rows) {
      await target.remove(tx, tenantId, row.insertedId!);
      await tx.update(importJobRows).set({ insertedId: null }).where(eq(importJobRows.id, row.id));
      deleted += 1;
    }

    await tx
      .update(importJobs)
      .set({ status: "rolled_back", rolledBackAt: new Date() })
      .where(eq(importJobs.id, jobId));

    return { deleted };
  });
}
