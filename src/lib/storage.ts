import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { files } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/** Docker biriminde tutulur; üretimde /data/uploads'a bağlanır. */
const ROOT = resolve(process.env.UPLOAD_DIR ?? "./.uploads");

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);

export class UploadError extends Error {}

/**
 * Dosyayı diske yazar, meta veriyi kaydeder.
 *
 * Ad kullanıcıdan gelir ama diskte kullanılmaz: yol rastgele üretilir,
 * uzantı MIME'dan belirlenir. Böylece "../" ya da ".php" gibi adlarla
 * dizin dışına çıkmak ya da çalıştırılabilir dosya bırakmak imkânsız.
 */
export async function storeFile(input: {
  tenantId: string;
  userId: string;
  file: File;
  entityType: string;
  entityId: string;
  slot?: string | null;
}): Promise<string> {
  const { file } = input;
  if (file.size === 0) throw new UploadError("Dosya boş.");
  if (file.size > MAX_BYTES) throw new UploadError("Dosya 8 MB'ı aşamaz.");

  const extension = ALLOWED.get(file.type);
  if (!extension) throw new UploadError("Yalnız JPG, PNG, WEBP ve PDF yüklenebilir.");

  const name = `${randomUUID()}${extension}`;
  const relative = join(input.tenantId, name);
  const absolute = join(ROOT, relative);

  await mkdir(join(ROOT, input.tenantId), { recursive: true });
  await writeFile(absolute, Buffer.from(await file.arrayBuffer()));

  const rows = await withTenant(input.tenantId, (tx) =>
    tx
      .insert(files)
      .values({
        tenantId: input.tenantId,
        storagePath: relative,
        originalName: file.name.slice(0, 255),
        mimeType: file.type,
        sizeBytes: file.size,
        entityType: input.entityType,
        entityId: input.entityId,
        slot: input.slot ?? null,
        uploadedBy: input.userId,
      })
      .returning({ id: files.id }),
  );
  return rows[0]!.id;
}

/** Dosyayı okur. Kiracı denetimi çağıranın sorumluluğunda değil — burada yapılır. */
export async function readStoredFile(
  tenantId: string,
  fileId: string,
): Promise<{ body: Buffer; mimeType: string; name: string } | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, fileId))),
  );
  const row = rows[0];
  if (!row) return null;

  // Kayıtlı yolu tekrar çözüp kökün altında kaldığını doğruluyoruz.
  const absolute = resolve(ROOT, row.storagePath);
  if (!absolute.startsWith(ROOT)) return null;

  try {
    return { body: await readFile(absolute), mimeType: row.mimeType, name: row.originalName };
  } catch {
    return null;
  }
}

export async function listFiles(tenantId: string, entityType: string, entityId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.tenantId, tenantId),
          eq(files.entityType, entityType),
          eq(files.entityId, entityId),
        ),
      ),
  );
}

export async function deleteStoredFile(tenantId: string, fileId: string): Promise<void> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .delete(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.id, fileId)))
      .returning({ storagePath: files.storagePath }),
  );
  const row = rows[0];
  if (!row) return;

  const absolute = resolve(ROOT, row.storagePath);
  if (!absolute.startsWith(ROOT)) return;
  await unlink(absolute).catch(() => {
    // Dosya zaten yoksa kayıt silindiği için sorun değil.
  });
}

/** Test ve doğrulama için: içeriğin özeti. */
export function fileDigest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

export { ROOT as UPLOAD_ROOT, ALLOWED as ALLOWED_MIME_TYPES, MAX_BYTES as MAX_UPLOAD_BYTES };
export { extname };
