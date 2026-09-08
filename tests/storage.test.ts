import { rm } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants } from "@/db/schema";
import {
  deleteStoredFile,
  listFiles,
  readStoredFile,
  storeFile,
  UploadError,
  UPLOAD_ROOT,
} from "@/lib/storage";
import { contentDisposition } from "@/lib/reports/export";
import { resetDatabase } from "./setup";

async function seedTenants() {
  const rows = await dbAdmin
    .insert(tenants)
    .values([
      { name: "A", slug: "a", sectorPack: "turizm", sectorPackVersion: "1.0.0" },
      { name: "B", slug: "b", sectorPack: "lojistik", sectorPackVersion: "1.0.0" },
    ])
    .returning();
  return { a: rows[0]!, b: rows[1]! };
}

const png = (): File =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "foto.png", { type: "image/png" });

afterAll(async () => {
  await rm(UPLOAD_ROOT, { recursive: true, force: true });
});

describe("dosya saklama", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("dosya yazılır ve geri okunur", async () => {
    const { a } = await seedTenants();
    const id = await storeFile({
      tenantId: a.id,
      userId: a.id,
      file: png(),
      entityType: "inspection",
      entityId: a.id,
    });
    const back = await readStoredFile(a.id, id);
    expect(back?.mimeType).toBe("image/png");
    expect(back?.name).toBe("foto.png");
    expect(back?.body.length).toBe(4);
  });

  it("başka kiracı dosyayı okuyamaz", async () => {
    const { a, b } = await seedTenants();
    const id = await storeFile({
      tenantId: a.id,
      userId: a.id,
      file: png(),
      entityType: "inspection",
      entityId: a.id,
    });
    expect(await readStoredFile(b.id, id)).toBeNull();
  });

  it("izin verilmeyen tür reddedilir", async () => {
    const { a } = await seedTenants();
    const bad = new File(["<?php ?>"], "kotu.php", { type: "application/x-php" });
    await expect(
      storeFile({ tenantId: a.id, userId: a.id, file: bad, entityType: "x", entityId: a.id }),
    ).rejects.toThrow(UploadError);
  });

  it("boş dosya reddedilir", async () => {
    const { a } = await seedTenants();
    const empty = new File([], "bos.png", { type: "image/png" });
    await expect(
      storeFile({ tenantId: a.id, userId: a.id, file: empty, entityType: "x", entityId: a.id }),
    ).rejects.toThrow(UploadError);
  });

  it("8 MB üstü dosya reddedilir", async () => {
    const { a } = await seedTenants();
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "buyuk.png", { type: "image/png" });
    await expect(
      storeFile({ tenantId: a.id, userId: a.id, file: big, entityType: "x", entityId: a.id }),
    ).rejects.toThrow("8 MB");
  });

  it("dizin dışına çıkmaya çalışan ad zararsızlaşır", async () => {
    const { a } = await seedTenants();
    const evil = new File([new Uint8Array([1, 2, 3])], "../../../etc/passwd.png", {
      type: "image/png",
    });
    const id = await storeFile({
      tenantId: a.id,
      userId: a.id,
      file: evil,
      entityType: "x",
      entityId: a.id,
    });
    const rows = await listFiles(a.id, "x", a.id);
    // Diskteki yol rastgele; kullanıcı adı yalnız görüntülemede saklanır
    expect(rows[0]!.storagePath).not.toContain("..");
    expect(rows[0]!.storagePath.startsWith(`${a.id}/`)).toBe(true);
    expect(await readStoredFile(a.id, id)).not.toBeNull();
  });

  it("kayda göre listelenir", async () => {
    const { a } = await seedTenants();
    await storeFile({ tenantId: a.id, userId: a.id, file: png(), entityType: "inspection", entityId: a.id, slot: "0" });
    await storeFile({ tenantId: a.id, userId: a.id, file: png(), entityType: "inspection", entityId: a.id });
    expect(await listFiles(a.id, "inspection", a.id)).toHaveLength(2);
    expect(await listFiles(a.id, "vehicle_document", a.id)).toHaveLength(0);
  });

  it("silinen dosya artık okunamaz", async () => {
    const { a } = await seedTenants();
    const id = await storeFile({
      tenantId: a.id,
      userId: a.id,
      file: png(),
      entityType: "x",
      entityId: a.id,
    });
    await deleteStoredFile(a.id, id);
    expect(await readStoredFile(a.id, id)).toBeNull();
  });
});

describe("dosya başlığı", () => {
  it("uzantısız satır içi gösterim üretir", () => {
    const header = contentDisposition("Şoför Raporu.pdf", "", "inline");
    expect(header.startsWith("inline;")).toBe(true);
    for (const ch of header) expect(ch.charCodeAt(0)).toBeLessThan(256);
  });
});
