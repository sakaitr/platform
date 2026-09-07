import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { mapRows, parseDelimited, validateRow } from "@/lib/import/parse";
import { applyImportJob, createImportJob, getImportJob, rollbackImportJob } from "@/lib/import/run";
import { registerImportTarget, type ImportTarget } from "@/lib/import/targets";
import { resetDatabase } from "./setup";

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
  remove: async () => undefined,
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

  it("var olmayan takvim gününü reddeder", () => {
    expect(validateRow(TARGET, { ad: "A", tarih: "31.04.2026" })).toHaveLength(1);
    expect(validateRow(TARGET, { ad: "A", tarih: "29.02.2026" })).toHaveLength(1);
    expect(validateRow(TARGET, { ad: "A", tarih: "2026-02-30" })).toHaveLength(1);
  });

  it("artık yıl 29 Şubat'ı kabul eder", () => {
    expect(validateRow(TARGET, { ad: "A", tarih: "29.02.2024" })).toEqual([]);
  });

  it("geçerli satırda hata yoktur", () => {
    expect(validateRow(TARGET, { ad: "Ali", yas: "30", tarih: "2026-09-08" })).toEqual([]);
  });
});

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
      .values({ tenantId, email: values["email"]!, name: values["name"]!, passwordHash: "imported" })
      .returning({ id: users.id });
    return row!.id;
  },
  remove: async (tx, tenantId, id) => {
    await tx.delete(users).where(and(eq(users.tenantId, tenantId), eq(users.id, id)));
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

const MAPPING = { "E-posta": "email", "İsim": "name" };
const HEADERS = ["E-posta", "İsim"];

describe("import çalıştırma", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("iş oluşturur, geçerli/hatalı satırı sayar", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users",
      fileName: "test.csv",
      headers: HEADERS,
      rows: [["a@x.com", "Ali"], ["", "Eksik"]],
      mapping: MAPPING,
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
      headers: HEADERS,
      rows: [["b@x.com", "Veli"], ["", "Eksik"]],
      mapping: MAPPING,
    });

    expect((await applyImportJob(tenantId, jobId)).inserted).toBe(1);
    const { job } = await getImportJob(tenantId, jobId);
    expect(job.status).toBe("applied");
    expect(job.appliedAt).not.toBeNull();

    const all = await dbAdmin.select().from(users).where(eq(users.tenantId, tenantId));
    expect(all.map((u) => u.email)).toContain("b@x.com");
  });

  it("iki kez uygulanamaz", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users", fileName: "t.csv", headers: HEADERS,
      rows: [["c@x.com", "Can"]], mapping: MAPPING,
    });
    await applyImportJob(tenantId, jobId);
    await expect(applyImportJob(tenantId, jobId)).rejects.toThrow(/zaten uyguland/i);
  });

  it("geri alır — eklenen kayıtları siler", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users", fileName: "t.csv", headers: HEADERS,
      rows: [["d@x.com", "Dila"], ["e@x.com", "Emre"]], mapping: MAPPING,
    });
    await applyImportJob(tenantId, jobId);

    expect((await rollbackImportJob(tenantId, jobId)).deleted).toBe(2);
    const { job } = await getImportJob(tenantId, jobId);
    expect(job.status).toBe("rolled_back");

    const all = await dbAdmin.select().from(users).where(eq(users.tenantId, tenantId));
    expect(all.map((u) => u.email)).not.toContain("d@x.com");
  });

  it("uygulanmamış iş geri alınamaz", async () => {
    const { tenantId, userId } = await seed();
    const jobId = await createImportJob(tenantId, userId, {
      targetKey: "test_users", fileName: "t.csv", headers: HEADERS,
      rows: [["f@x.com", "Fatma"]], mapping: MAPPING,
    });
    await expect(rollbackImportJob(tenantId, jobId)).rejects.toThrow(/uygulanmam/i);
  });
});
