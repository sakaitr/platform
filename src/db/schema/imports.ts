import { index, integer, jsonb, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const importStatusEnum = pgEnum("import_status", [
  "draft",
  "validated",
  "applied",
  "rolled_back",
  "failed",
]);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** IMPORT_TARGETS anahtarı — örn. "yolcular", "araclar" */
    targetKey: varchar("target_key", { length: 50 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    status: importStatusEnum("status").notNull().default("draft"),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    createdBy: uuid("created_by"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("import_jobs_tenant_idx").on(t.tenantId) }),
);

export const importJobRows = pgTable(
  "import_job_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    /** Ayrıştırılmış ham satır: { "Ad Soyad": "Ali", ... } */
    raw: jsonb("raw").notNull(),
    /** Doğrulama hataları; boş dizi = geçerli */
    errors: jsonb("errors").notNull().default([]),
    /** Uygulandıysa oluşturulan kaydın kimliği — geri alma bunu siler */
    insertedId: uuid("inserted_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("import_job_rows_tenant_idx").on(t.tenantId),
    jobIdx: index("import_job_rows_job_idx").on(t.jobId),
  }),
);

export type ImportJob = typeof importJobs.$inferSelect;
export type ImportJobRow = typeof importJobRows.$inferSelect;
