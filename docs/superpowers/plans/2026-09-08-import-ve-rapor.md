# Import Merkezi + Rapor Motoru (Faz 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her iş modülünün ihtiyaç duyacağı iki altyapıyı çekirdeğe almak: kayıt kaydeden **import merkezi** (şablon → yükle → eşleştir → önizle → uygula → geri al) ve deklaratif **rapor motoru** (katalog + XLSX/PDF çıktı).

**Architecture:** İkisi de **kayıt defteri** desenli — modüller kendi hedeflerini/raporlarını kaydeder, çekirdek motor çalıştırır. `IMPORT_TARGETS` bir varlığın hangi kolonları kabul ettiğini ve satırı nasıl yazacağını tanımlar; `REPORT_CATALOG` bir raporun ne sorduğunu ve hangi izni gerektirdiğini. Modül eklemek = kayıt eklemek, motor değişmez.

**Tech Stack:** Next.js 16 · TypeScript strict · PostgreSQL 16 · Drizzle · Zod · ExcelJS · pdf-lib · Vitest · Playwright

## Global Constraints

- Node 22 LTS, TypeScript `strict: true`, `any` yasak.
- Kullanıcıya dönen metin **Türkçe**; kod/tablo/dosya adı **İngilizce**; log İngilizce.
- Kiracı verisi yalnızca `withTenant()` içinden; yeni tablolar `tenant_id` + indeks taşır.
- Şema değişince **`npm run db:sync`** (çıplak `db:push` RLS'i kapatır).
- İzinler `kaynak:eylem`; yeni anahtar `PERMISSION_CATALOG`'a eklenir.
- Para `numeric`, zaman İstanbul günü (`istanbulDayKey`).
- Her task sonunda commit, Conventional Commits.

---

## Kapsam

**Bu plan:** import şeması + motoru + UI, rapor kataloğu + motoru (XLSX/PDF) + UI.
**Bu plan değil:** iş modüllerinin kendi import hedefleri ve raporları (Plan 4+, her modül kendi kaydını ekler).

---

## File Structure

```
src/
├─ db/schema/imports.ts        NEW  — import_jobs, import_job_rows
├─ lib/import/
│  ├─ targets.ts               NEW  — IMPORT_TARGETS kayıt defteri
│  ├─ parse.ts                 NEW  — CSV/XLSX ayrıştırma + kolon eşleştirme
│  └─ run.ts                   NEW  — önizleme, uygulama, geri alma
├─ lib/reports/
│  ├─ catalog.ts               NEW  — ReportDef + REPORT_CATALOG
│  ├─ engine.ts                NEW  — runReport dispatcher
│  └─ export.ts                NEW  — XLSX + PDF üretimi
├─ modules/imports/{queries,actions}.ts   NEW
├─ modules/reports/queries.ts             NEW
└─ app/(app)/
   ├─ import/page.tsx          NEW
   └─ raporlar/page.tsx        NEW
tests/
├─ import.test.ts              NEW
└─ reports.test.ts             NEW
```

---

### Task 1: Import şeması

**Files:** Create `src/db/schema/imports.ts`; Modify `src/db/schema/index.ts`, `tests/setup.ts`

**Interfaces:**
- Produces: `importJobs` (id, tenantId, targetKey, fileName, status, totalRows, validRows, errorRows, createdBy, appliedAt, rolledBackAt), `importJobRows` (id, tenantId, jobId, rowNumber, raw jsonb, errors jsonb, insertedId), tipler `ImportJob`, `ImportJobRow`

- [ ] **Step 1: `src/db/schema/imports.ts` yaz**

```typescript
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
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
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
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").notNull().references(() => importJobs.id, { onDelete: "cascade" }),
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
```

- [ ] **Step 2: `src/db/schema/index.ts`'e ekle**

```typescript
export * from "./imports";
```

- [ ] **Step 3: `tests/setup.ts` TRUNCATE listesine ekle**

`audit_logs,` yerine:
```typescript
    TRUNCATE TABLE import_job_rows, import_jobs, audit_logs,
```

- [ ] **Step 4: Şema + RLS uygula**

Run:
```bash
npm run db:sync && npm run db:sync:test
```
Expected: her ikisinde "Şema + RLS uygulandı — 17 politika, 0 korumasız tablo"

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: import işi şeması — satır bazlı hata takibi ve geri alma desteği

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Import hedef kayıt defteri + ayrıştırma

**Files:** Create `src/lib/import/targets.ts`, `src/lib/import/parse.ts`; Test `tests/import.test.ts`

**Interfaces:**
- Produces:
  - `ImportColumn = { key: string; label: string; required: boolean; type: "text" | "number" | "date" }`
  - `ImportTarget = { key; label; permission; columns: readonly ImportColumn[]; insert: (tx, tenantId, values) => Promise<string> }`
  - `IMPORT_TARGETS: Record<string, ImportTarget>`
  - `registerImportTarget(target: ImportTarget): void` — modüller kendi hedefini kaydeder
  - `parseDelimited(content: string): { headers: string[]; rows: string[][] }`
  - `mapRows(headers, rows, mapping): Array<Record<string, string>>`
  - `validateRow(target, row): string[]` — hata mesajları

- [ ] **Step 1: Testi yaz — `tests/import.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { mapRows, parseDelimited, validateRow } from "@/lib/import/parse";
import type { ImportTarget } from "@/lib/import/targets";

const TARGET: ImportTarget = {
  key: "test",
  label: "Test",
  permission: "yolcular:import",
  columns: [
    { key: "ad", label: "Ad", required: true, type: "text" },
    { key: "yas", label: "Yaş", required: false, type: "number" },
    { key: "tarih", label: "Tarih", required: false, type: "date" },
  ],
  insert: async () => "x",
};

describe("import ayrıştırma", () => {
  it("noktalı virgül ve virgül ayracını tanır", () => {
    expect(parseDelimited("a;b\n1;2").headers).toEqual(["a", "b"]);
    expect(parseDelimited("a,b\n1,2").headers).toEqual(["a", "b"]);
  });

  it("tırnaklı alanları ve içindeki ayracı korur", () => {
    const r = parseDelimited('ad,not\n"Ali, Veli",xyz');
    expect(r.rows[0]).toEqual(["Ali, Veli", "xyz"]);
  });

  it("BOM ve CRLF temizler", () => {
    const r = parseDelimited("﻿a,b\r\n1,2\r\n");
    expect(r.headers).toEqual(["a", "b"]);
    expect(r.rows).toEqual([["1", "2"]]);
  });

  it("boş satırları atar", () => {
    expect(parseDelimited("a,b\n1,2\n\n3,4\n").rows).toHaveLength(2);
  });
});

describe("kolon eşleştirme", () => {
  it("başlıkları hedef kolonlara eşler", () => {
    const mapped = mapRows(["Ad", "Yaş"], [["Ali", "30"]], { Ad: "ad", "Yaş": "yas" });
    expect(mapped[0]).toEqual({ ad: "Ali", yas: "30" });
  });

  it("eşlenmemiş başlığı yok sayar", () => {
    const mapped = mapRows(["Ad", "Fazla"], [["Ali", "x"]], { Ad: "ad" });
    expect(mapped[0]).toEqual({ ad: "Ali" });
  });
});

describe("satır doğrulama", () => {
  it("zorunlu alan boşsa hata verir", () => {
    expect(validateRow(TARGET, { ad: "" })).toContain("Ad zorunlu.");
  });

  it("sayı olmayan değeri reddeder", () => {
    expect(validateRow(TARGET, { ad: "Ali", yas: "abc" })).toContain("Yaş sayı olmalı.");
  });

  it("geçersiz tarihi reddeder", () => {
    expect(validateRow(TARGET, { ad: "Ali", tarih: "32.13.2026" })).toContain(
      "Tarih GG.AA.YYYY veya YYYY-AA-GG olmalı.",
    );
  });

  it("geçerli satırda hata yoktur", () => {
    expect(validateRow(TARGET, { ad: "Ali", yas: "30", tarih: "2026-09-08" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/import.test.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: `src/lib/import/targets.ts` yaz**

```typescript
import type { TenantTx } from "@/db/tenant";

export type ImportColumn = {
  key: string;
  label: string;
  required: boolean;
  type: "text" | "number" | "date";
};

export type ImportTarget = {
  /** Benzersiz anahtar — import_jobs.target_key */
  key: string;
  label: string;
  /** Bu hedefe import için gereken izin — örn. "yolcular:import" */
  permission: string;
  columns: readonly ImportColumn[];
  /** Doğrulanmış satırı yazar, oluşturulan kaydın kimliğini döner. */
  insert: (tx: TenantTx, tenantId: string, values: Record<string, string>) => Promise<string>;
};

/**
 * Import hedefleri kayıt defteri.
 * Modüller kendi hedefini `registerImportTarget` ile ekler; motor değişmez.
 */
export const IMPORT_TARGETS: Record<string, ImportTarget> = {};

export function registerImportTarget(target: ImportTarget): void {
  IMPORT_TARGETS[target.key] = target;
}

export function getImportTarget(key: string): ImportTarget {
  const target = IMPORT_TARGETS[key];
  if (!target) throw new Error(`Bilinmeyen import hedefi: ${key}`);
  return target;
}
```

- [ ] **Step 4: `src/lib/import/parse.ts` yaz**

```typescript
import type { ImportTarget } from "./targets";

/** Ayraçlı metin ayrıştırıcı: tırnak içi ayraçları korur, BOM/CRLF temizler. */
export function parseDelimited(content: string): { headers: string[]; rows: string[][] } {
  const clean = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const firstLine = clean.split("\n")[0] ?? "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  const lines = clean.split("\n").filter((l) => l.trim() !== "");
  const parsed = lines.map((line) => splitLine(line, delimiter));

  const headers = (parsed[0] ?? []).map((h) => h.trim());
  return { headers, rows: parsed.slice(1) };
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Başlık → hedef kolon eşlemesini uygular. Eşlenmemiş başlık düşer. */
export function mapRows(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): Array<Record<string, string>> {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      const targetKey = mapping[header];
      if (targetKey) record[targetKey] = row[i] ?? "";
    });
    return record;
  });
}

const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})$/;

export function validateRow(target: ImportTarget, values: Record<string, string>): string[] {
  const errors: string[] = [];

  for (const column of target.columns) {
    const raw = (values[column.key] ?? "").trim();

    if (column.required && raw === "") {
      errors.push(`${column.label} zorunlu.`);
      continue;
    }
    if (raw === "") continue;

    if (column.type === "number" && Number.isNaN(Number(raw.replace(",", ".")))) {
      errors.push(`${column.label} sayı olmalı.`);
    }
    if (column.type === "date" && !DATE_RE.test(raw)) {
      errors.push(`${column.label} GG.AA.YYYY veya YYYY-AA-GG olmalı.`);
    }
  }

  return errors;
}
```

- [ ] **Step 5: Test + commit**

Run: `npm test tests/import.test.ts`
Expected: `10 passed`

```bash
git add -A
git commit -m "feat: import hedef kayıt defteri + ayraçlı dosya ayrıştırma ve doğrulama

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Import çalıştırma — önizleme, uygulama, geri alma

**Files:** Create `src/lib/import/run.ts`; Modify `tests/import.test.ts`

**Interfaces:**
- Consumes: Task 1 şema, Task 2 hedefler/ayrıştırma
- Produces:
  - `createImportJob(tenantId, userId, input: { targetKey; fileName; headers; rows; mapping }): Promise<string>`
  - `getImportJob(tenantId, jobId): Promise<{ job: ImportJob; rows: ImportJobRow[] }>`
  - `applyImportJob(tenantId, jobId): Promise<{ inserted: number }>`
  - `rollbackImportJob(tenantId, jobId): Promise<{ deleted: number }>`

- [ ] **Step 1: Testleri `tests/import.test.ts` sonuna ekle**

```typescript
import { beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { importJobs, tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { hashPassword } from "@/lib/auth";
import { applyImportJob, createImportJob, getImportJob, rollbackImportJob } from "@/lib/import/run";
import { registerImportTarget } from "@/lib/import/targets";
import { resetDatabase } from "./setup";

// Test hedefi: users tablosuna yazar (mevcut şema, ek tablo gerekmez)
registerImportTarget({
  key: "test_users",
  label: "Test Kullanıcı",
  permission: "users:create",
  columns: [
    { key: "email", label: "E-posta", required: true, type: "text" },
    { key: "name", label: "İsim", required: true, type: "text" },
  ],
  insert: async (tx, tenantId, values) => {
    const [row] = await tx
      .insert(users)
      .values({
        tenantId,
        email: values["email"]!,
        name: values["name"]!,
        passwordHash: "imported",
      })
      .returning({ id: users.id });
    return row!.id;
  },
});

async function seed() {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "imp", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [u] = await dbAdmin
    .insert(users)
    .values({
      tenantId: t!.id,
      email: "owner@imp.com",
      name: "Owner",
      passwordHash: await hashPassword("Gizli1234!"),
    })
    .returning();
  return { tenantId: t!.id, userId: u!.id };
}

describe("import çalıştırma", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("iş oluşturur, geçerli/hatalı satırı sayar", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "test.csv",
      headers: ["E-posta", "İsim"],
      rows: [
        ["a@x.com", "Ali"],
        ["", "Eksik"],
      ],
      mapping: { "E-posta": "email", "İsim": "name" },
    });

    const { job, rows } = await getImportJob(tenantId, jobId);
    expect(job.totalRows).toBe(2);
    expect(job.validRows).toBe(1);
    expect(job.errorRows).toBe(1);
    expect(job.status).toBe("validated");
    expect(rows).toHaveLength(2);
  });

  it("uygular — sadece geçerli satırları yazar", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "t.csv",
      headers: ["E-posta", "İsim"],
      rows: [
        ["b@x.com", "Veli"],
        ["", "Eksik"],
      ],
      mapping: { "E-posta": "email", "İsim": "name" },
    });

    const result = await applyImportJob(tenantId, jobId);
    expect(result.inserted).toBe(1);

    const { job } = await getImportJob(tenantId, jobId);
    expect(job.status).toBe("applied");
    expect(job.appliedAt).not.toBeNull();

    const all = await dbAdmin.select().from(users).where(eq(users.tenantId, tenantId));
    expect(all.map((u) => u.email)).toContain("b@x.com");
  });

  it("iki kez uygulanamaz", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "t.csv",
      headers: ["E-posta", "İsim"],
      rows: [["c@x.com", "Can"]],
      mapping: { "E-posta": "email", "İsim": "name" },
    });
    await applyImportJob(tenantId, jobId);
    await expect(applyImportJob(tenantId, jobId)).rejects.toThrow(/zaten uyguland/i);
  });

  it("geri alır — eklenen kayıtları siler", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "t.csv",
      headers: ["E-posta", "İsim"],
      rows: [
        ["d@x.com", "Dila"],
        ["e@x.com", "Emre"],
      ],
      mapping: { "E-posta": "email", "İsim": "name" },
    });
    await applyImportJob(tenantId, jobId);

    const result = await rollbackImportJob(tenantId, jobId);
    expect(result.deleted).toBe(2);

    const { job } = await getImportJob(tenantId, jobId);
    expect(job.status).toBe("rolled_back");

    const all = await dbAdmin.select().from(users).where(eq(users.tenantId, tenantId));
    expect(all.map((u) => u.email)).not.toContain("d@x.com");
  });

  it("uygulanmamış iş geri alınamaz", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "t.csv",
      headers: ["E-posta", "İsim"],
      rows: [["f@x.com", "Fatma"]],
      mapping: { "E-posta": "email", "İsim": "name" },
    });
    await expect(rollbackImportJob(tenantId, jobId)).rejects.toThrow(/uygulanmam/i);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/import.test.ts`
Expected: FAIL — `@/lib/import/run` yok

- [ ] **Step 3: `src/lib/import/run.ts` yaz**

```typescript
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
```

- [ ] **Step 4: `ImportTarget`'a `remove` ekle — `src/lib/import/targets.ts`**

`insert` satırının ALTINA ekle:
```typescript
  /** Geri almada bu işin eklediği kaydı siler. */
  remove: (tx: TenantTx, tenantId: string, id: string) => Promise<void>;
```

Ve `tests/import.test.ts`'teki iki `ImportTarget` tanımına da ekle:
```typescript
  remove: async () => undefined,
```
(test hedefi `test_users` için gerçek silme):
```typescript
  remove: async (tx, tenantId, id) => {
    await tx.delete(users).where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
  },
```
Test dosyasının import satırına `and` ekle: `import { and, eq } from "drizzle-orm";`

- [ ] **Step 5: Test + commit**

Run: `npm test tests/import.test.ts`
Expected: `15 passed`

```bash
git add -A
git commit -m "feat: import çalıştırma — önizleme, tek transaction uygulama, geri alma

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Rapor kataloğu + motoru

**Files:** Create `src/lib/reports/catalog.ts`, `src/lib/reports/engine.ts`; Test `tests/reports.test.ts`

**Interfaces:**
- Produces:
  - `ReportColumn = { key: string; label: string; align?: "left" | "right" }`
  - `ReportResult = { columns: ReportColumn[]; rows: Array<Record<string, string | number>>; summary?: Record<string, string> }`
  - `ReportDef = { key; name; category; description; permission; needsDateRange: boolean; run: (ctx) => Promise<ReportResult> }`
  - `ReportContext = { tenantId: string; from?: string; to?: string }`
  - `REPORT_CATALOG: Record<string, ReportDef>`, `registerReport(def)`, `listReports(permissions: Set<string>): ReportDef[]`
  - `runReport(key: string, ctx: ReportContext): Promise<ReportResult>`

- [ ] **Step 1: Testi yaz — `tests/reports.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import { listReports, registerReport, REPORT_CATALOG, runReport } from "@/lib/reports/engine";
import { resetDatabase } from "./setup";

registerReport({
  key: "test_rapor",
  name: "Test Raporu",
  category: "Test",
  description: "Deneme",
  permission: "raporlar:read",
  needsDateRange: false,
  run: async (ctx) => ({
    columns: [
      { key: "ad", label: "Ad" },
      { key: "adet", label: "Adet", align: "right" },
    ],
    rows: [{ ad: "Satır", adet: 5 }],
    summary: { Toplam: "5" },
  }),
});

describe("rapor motoru", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kayıtlı raporu çalıştırır", async () => {
    const [t] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "rap", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    const result = await runReport("test_rapor", { tenantId: t!.id });
    expect(result.rows).toHaveLength(1);
    expect(result.columns.map((c) => c.key)).toEqual(["ad", "adet"]);
    expect(result.summary).toEqual({ Toplam: "5" });
  });

  it("bilinmeyen rapor hata verir", async () => {
    await expect(runReport("yok", { tenantId: "x" })).rejects.toThrow(/Bilinmeyen rapor/);
  });

  it("izne göre süzer", () => {
    expect(listReports(new Set(["raporlar:read"])).map((r) => r.key)).toContain("test_rapor");
    expect(listReports(new Set(["dashboard:read"])).map((r) => r.key)).not.toContain("test_rapor");
  });

  it("katalog anahtarı tanımla eşleşir", () => {
    for (const [key, def] of Object.entries(REPORT_CATALOG)) {
      expect(def.key).toBe(key);
    }
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/reports.test.ts`
Expected: FAIL — modül yok

- [ ] **Step 3: `src/lib/reports/catalog.ts` yaz**

```typescript
export type ReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type ReportResult = {
  columns: ReportColumn[];
  rows: Array<Record<string, string | number>>;
  /** Alt özet satırı — örn. { "Toplam": "12.500,00 ₺" } */
  summary?: Record<string, string>;
};

export type ReportContext = {
  tenantId: string;
  /** YYYY-MM-DD */
  from?: string;
  to?: string;
};

export type ReportDef = {
  key: string;
  name: string;
  category: string;
  description: string;
  /** Görüntülemek için gereken izin — örn. "raporlar:read" */
  permission: string;
  needsDateRange: boolean;
  run: (ctx: ReportContext) => Promise<ReportResult>;
};
```

- [ ] **Step 4: `src/lib/reports/engine.ts` yaz**

```typescript
import type { ReportContext, ReportDef, ReportResult } from "./catalog";

/**
 * Rapor kayıt defteri.
 * Modüller kendi raporlarını `registerReport` ile ekler; motor değişmez.
 * (aycanops'ta 31 rapor bu desenle tek dispatcher üzerinden çalışıyordu.)
 */
export const REPORT_CATALOG: Record<string, ReportDef> = {};

export function registerReport(def: ReportDef): void {
  REPORT_CATALOG[def.key] = def;
}

export function listReports(permissions: Set<string>): ReportDef[] {
  return Object.values(REPORT_CATALOG)
    .filter((def) => permissions.has(def.permission))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function listCategories(permissions: Set<string>): string[] {
  return [...new Set(listReports(permissions).map((r) => r.category))];
}

export async function runReport(key: string, ctx: ReportContext): Promise<ReportResult> {
  const def = REPORT_CATALOG[key];
  if (!def) throw new Error(`Bilinmeyen rapor: ${key}`);
  return def.run(ctx);
}

export type { ReportColumn, ReportContext, ReportDef, ReportResult } from "./catalog";
```

- [ ] **Step 5: Test + commit**

Run: `npm test tests/reports.test.ts`
Expected: `4 passed`

```bash
git add -A
git commit -m "feat: deklaratif rapor kayıt defteri ve dispatcher

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: XLSX + CSV dışa aktarma

**Files:** Create `src/lib/reports/export.ts`; Modify `package.json` (exceljs), `tests/reports.test.ts`

**Interfaces:**
- Produces:
  - `buildCsv(result: ReportResult): string` — BOM'lu, Excel-uyumlu (`;` ayraç)
  - `buildXlsx(title: string, result: ReportResult): Promise<Buffer>`

- [ ] **Step 1: exceljs kur**

Run: `npm install exceljs`
Expected: eklenir

- [ ] **Step 2: Testleri `tests/reports.test.ts` sonuna ekle**

```typescript
import { buildCsv, buildXlsx } from "@/lib/reports/export";

describe("rapor dışa aktarma", () => {
  const result = {
    columns: [
      { key: "ad", label: "Ad" },
      { key: "tutar", label: "Tutar", align: "right" as const },
    ],
    rows: [
      { ad: "Ali", tutar: 1500 },
      { ad: 'Vel"i; Test', tutar: 2000 },
    ],
    summary: { Toplam: "3500" },
  };

  it("CSV üretir — BOM'lu, noktalı virgül ayraçlı", () => {
    const csv = buildCsv(result);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Ad;Tutar");
    expect(csv).toContain("Ali;1500");
  });

  it("CSV içindeki tırnak ve ayracı kaçırır", () => {
    const csv = buildCsv(result);
    expect(csv).toContain('"Vel""i; Test"');
  });

  it("XLSX üretir — geçerli zip başlığı", async () => {
    const buf = await buildXlsx("Test", result);
    expect(buf.length).toBeGreaterThan(1000);
    // XLSX = zip; PK imzasıyla başlar
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
```

- [ ] **Step 3: `src/lib/reports/export.ts` yaz**

```typescript
import ExcelJS from "exceljs";
import type { ReportResult } from "./catalog";

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel'in Türkçe yerelinde doğru açılması için BOM + noktalı virgül. */
export function buildCsv(result: ReportResult): string {
  const lines: string[] = [];
  lines.push(result.columns.map((c) => escapeCsv(c.label)).join(";"));

  for (const row of result.rows) {
    lines.push(result.columns.map((c) => escapeCsv(row[c.key] ?? "")).join(";"));
  }

  if (result.summary) {
    lines.push("");
    for (const [label, value] of Object.entries(result.summary)) {
      lines.push(`${escapeCsv(label)};${escapeCsv(value)}`);
    }
  }

  return `﻿${lines.join("\n")}`;
}

export async function buildXlsx(title: string, result: ReportResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agno Platform";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31) || "Rapor");

  sheet.columns = result.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 6)),
    style: { alignment: { horizontal: c.align ?? "left" } },
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F4F6" },
  };

  for (const row of result.rows) {
    sheet.addRow(row);
  }

  if (result.summary) {
    sheet.addRow({});
    for (const [label, value] of Object.entries(result.summary)) {
      const added = sheet.addRow({ [result.columns[0]!.key]: label, [result.columns[1]?.key ?? "_"]: value });
      added.font = { bold: true };
    }
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: result.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
```

- [ ] **Step 4: Test + commit**

Run: `npm test tests/reports.test.ts`
Expected: `7 passed`

```bash
git add -A
git commit -m "feat: rapor dışa aktarma — Excel uyumlu CSV ve biçimli XLSX

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Çekirdek raporlar + rapor ekranı

**Files:** Create `src/modules/reports/core-reports.ts`, `src/app/(app)/raporlar/page.tsx`, `src/app/api/reports/[key]/route.ts`; Modify `src/lib/modules/keys.ts`, `src/lib/modules/registry.ts`, `src/lib/sector/packs.ts`

**Interfaces:**
- Consumes: Task 4 `registerReport`, Task 5 `buildCsv`/`buildXlsx`
- Produces: `raporlar` modülü nav'da; 2 çekirdek rapor (kullanıcılar, denetim izi); `/api/reports/[key]?format=csv|xlsx` indirme

- [ ] **Step 1: `src/modules/reports/core-reports.ts` yaz**

```typescript
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { auditLogs, roles, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { registerReport } from "@/lib/reports/engine";

/** Çekirdek raporlar — modül gerektirmez, her kiracıda çalışır. */
export function registerCoreReports(): void {
  registerReport({
    key: "kullanicilar",
    name: "Kullanıcı Listesi",
    category: "Yönetim",
    description: "Kiracıdaki kullanıcılar, rolleri ve durumları",
    permission: "raporlar:read",
    needsDateRange: false,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) =>
        tx
          .select({
            name: users.name,
            email: users.email,
            role: roles.label,
            durum: users.isActive,
          })
          .from(users)
          .leftJoin(roles, eq(roles.id, users.roleId))
          .where(eq(users.tenantId, ctx.tenantId))
          .orderBy(users.name),
      );

      return {
        columns: [
          { key: "name", label: "İsim" },
          { key: "email", label: "E-posta" },
          { key: "role", label: "Rol" },
          { key: "durum", label: "Durum" },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          email: r.email,
          role: r.role ?? "—",
          durum: r.durum ? "Aktif" : "Pasif",
        })),
        summary: { "Toplam kullanıcı": String(rows.length) },
      };
    },
  });

  registerReport({
    key: "denetim_izi",
    name: "Denetim İzi",
    category: "Yönetim",
    description: "Sistemde yapılan işlemlerin kaydı",
    permission: "audit:read",
    needsDateRange: true,
    run: async (ctx) => {
      const rows = await withTenant(ctx.tenantId, (tx) => {
        const conditions = [eq(auditLogs.tenantId, ctx.tenantId)];
        if (ctx.from) conditions.push(gte(auditLogs.createdAt, new Date(`${ctx.from}T00:00:00`)));
        if (ctx.to) conditions.push(lte(auditLogs.createdAt, new Date(`${ctx.to}T23:59:59`)));

        return tx
          .select({
            createdAt: auditLogs.createdAt,
            event: auditLogs.event,
            entityType: auditLogs.entityType,
            userName: users.name,
          })
          .from(auditLogs)
          .leftJoin(users, eq(users.id, auditLogs.userId))
          .where(and(...conditions))
          .orderBy(desc(auditLogs.createdAt))
          .limit(1000);
      });

      return {
        columns: [
          { key: "tarih", label: "Tarih" },
          { key: "event", label: "Olay" },
          { key: "entityType", label: "Varlık" },
          { key: "userName", label: "Kullanıcı" },
        ],
        rows: rows.map((r) => ({
          tarih: r.createdAt.toLocaleString("tr-TR"),
          event: r.event,
          entityType: r.entityType ?? "—",
          userName: r.userName ?? "sistem",
        })),
        summary: { "Kayıt sayısı": String(rows.length) },
      };
    },
  });
}
```

- [ ] **Step 2: Kayıt defterini uygulama başlangıcında doldur — `src/lib/reports/engine.ts` sonuna ekle**

```typescript
/**
 * Modül raporlarını yükler. Sunucu tarafında ilk kullanımda çağrılır;
 * tekrar çağrılması zararsızdır (aynı anahtar üzerine yazılır).
 */
let bootstrapped = false;

export async function ensureReportsRegistered(): Promise<void> {
  if (bootstrapped) return;
  const { registerCoreReports } = await import("@/modules/reports/core-reports");
  registerCoreReports();
  bootstrapped = true;
}
```

- [ ] **Step 3: `src/lib/modules/keys.ts` ve `registry.ts`'e `raporlar` ekle**

`keys.ts`:
```typescript
export const MODULE_KEYS = ["dashboard", "raporlar", "muhasebe", "filo", "admin"] as const;
```

`registry.ts` — `MODULE_REGISTRY` içinde `dashboard`'dan SONRA ekle:
```typescript
  {
    key: "raporlar",
    label: "Raporlar",
    icon: "FileBarChart",
    href: "/raporlar",
    permission: "raporlar:read",
  },
```

- [ ] **Step 4: Tüm sektör paketlerine `raporlar` modülünü ekle — `src/lib/sector/packs.ts`**

Her paketin `modules` dizisine `"raporlar"` ekle:
- turizm: `["dashboard", "raporlar", "muhasebe", "filo", "admin"]`
- lojistik: `["dashboard", "raporlar", "muhasebe", "filo", "admin"]`
- pilates: `["dashboard", "raporlar", "muhasebe", "admin"]`
- oto_servis: `["dashboard", "raporlar", "muhasebe", "admin"]`

- [ ] **Step 5: `src/app/api/reports/[key]/route.ts` yaz**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildCsv, buildXlsx } from "@/lib/reports/export";
import { ensureReportsRegistered, REPORT_CATALOG, runReport } from "@/lib/reports/engine";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const session = await requireAuth();
  await ensureReportsRegistered();

  const { key } = await params;
  const def = REPORT_CATALOG[key];
  if (!def) return NextResponse.json({ error: "Rapor bulunamadı." }, { status: 404 });
  if (!session.permissions.has(def.permission)) {
    return NextResponse.json({ error: "Bu rapor için yetkiniz yok." }, { status: 403 });
  }

  const url = request.nextUrl;
  const result = await runReport(key, {
    tenantId: session.tenantId,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  const format = url.searchParams.get("format") ?? "csv";
  const safeName = def.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();

  if (format === "xlsx") {
    const buffer = await buildXlsx(def.name, result);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
      },
    });
  }

  return new NextResponse(buildCsv(result), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
}
```

- [ ] **Step 6: `src/app/(app)/raporlar/page.tsx` yaz**

```tsx
import { requirePermission } from "@/lib/auth";
import { ensureReportsRegistered, listCategories, listReports } from "@/lib/reports/engine";

export default async function ReportsPage() {
  const session = await requirePermission("raporlar:read");
  await ensureReportsRegistered();

  const reports = listReports(session.permissions);
  const categories = listCategories(session.permissions);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Raporlar</h1>
        <p className="text-sm text-neutral-500">
          {reports.length} rapor · CSV ve Excel olarak indirilebilir
        </p>
      </div>

      {categories.map((category) => (
        <div key={category} className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-700">{category}</h2>
          <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
            {reports
              .filter((r) => r.category === category)
              .map((report) => (
                <div key={report.key} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{report.name}</p>
                    <p className="truncate text-xs text-neutral-500">{report.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={`/api/reports/${report.key}?format=csv`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      CSV
                    </a>
                    <a
                      href={`/api/reports/${report.key}?format=xlsx`}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-800"
                    >
                      Excel
                    </a>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      {reports.length === 0 ? (
        <p className="text-sm text-neutral-500">Görüntüleyebileceğiniz rapor yok.</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Şema + build + test**

Run: `npm run db:sync && npm run db:sync:test && npm run build && npm test`
Expected: build `EXIT=0`, tüm testler geçer

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: raporlar modülü — çekirdek raporlar, CSV/Excel indirme, izin süzgeci

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: E2E — rapor indirme

**Files:** Create `tests/e2e/reports.spec.ts`

- [ ] **Step 1: `tests/e2e/reports.spec.ts` yaz**

```typescript
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("owner rapor listesini görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/raporlar");
  await expect(page.getByText("Kullanıcı Listesi")).toBeVisible();
  await expect(page.getByText("Denetim İzi")).toBeVisible();
});

test("CSV indirilebiliyor", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  const response = await page.request.get("/api/reports/kullanicilar?format=csv");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const body = await response.text();
  expect(body).toContain("İsim;E-posta");
});

test("Excel indirilebiliyor", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  const response = await page.request.get("/api/reports/kullanicilar?format=xlsx");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain(".xlsx");
});

test("kısıtlı kullanıcı rapor menüsünü görmez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Raporlar", exact: true })).toHaveCount(0);
});
```

- [ ] **Step 2: Seed + E2E**

Run:
```bash
npx tsx scripts/seed-e2e.ts && npm run test:e2e
```
Expected: tüm E2E testleri geçer

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: E2E — rapor listesi, CSV ve Excel indirme, izin süzgeci

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faz 3 Tamamlanma Kriterleri

- [ ] Import işi oluşturuluyor, satır bazlı hata raporlanıyor
- [ ] Uygulama tek transaction — kısmi yazma yok; iki kez uygulanamıyor
- [ ] Geri alma sadece bu işin eklediği kayıtları siliyor
- [ ] Rapor kayıt defteri izne göre süzüyor
- [ ] CSV Excel'de Türkçe karakterlerle doğru açılıyor (BOM + `;`)
- [ ] XLSX başlık biçimli, otomatik süzgeçli
- [ ] `/api/reports/[key]` izinsiz erişimde 403
- [ ] `npm test` ve `npm run test:e2e` yeşil

---

## Sonraki Plan

`plan-4-modul-operasyon.md` — aycanops'un 10 operasyon sayfası: giriş kontrol (32.668 kayıt kanıtlı), yolcular (3.730), güzergahlar, rota planlama, transferler, günlük check-in, ziyaretçi kayıt, çetele. Her biri kendi import hedefini ve raporlarını kaydeder.
