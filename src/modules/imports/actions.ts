"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { parseDelimited } from "@/lib/import/parse";
import { applyImportJob, createImportJob, rollbackImportJob } from "@/lib/import/run";
import { ensureImportTargetsRegistered, getImportTarget } from "@/lib/import/targets";

export type ActionState = { error: string } | { ok: string } | null;

/**
 * Dosyayı ayrıştırır, sütunları kendi başlıklarıyla eşler ve doğrulanmış iş yaratır.
 * Yazma yapmaz — kullanıcı önizlemeyi görüp "Uygula" demeden hiçbir kayıt oluşmaz.
 */
export async function uploadImportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("imports:create");
  await ensureImportTargetsRegistered();

  const targetKey = String(formData.get("targetKey") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Dosya seçin." };
  if (file.size > 5 * 1024 * 1024) return { error: "Dosya 5 MB'ı aşamaz." };

  let target;
  try {
    target = getImportTarget(targetKey);
  } catch {
    return { error: "Geçersiz hedef." };
  }
  if (!session.permissions.has(target.permission)) {
    return { error: "Bu hedefe aktarım için yetkiniz yok." };
  }

  const text = await file.text();
  const parsed = parseDelimited(text);
  if (parsed.rows.length === 0) return { error: "Dosyada veri satırı yok." };

  // mapping: dosya başlığı → hedef alan anahtarı. Etiket birebir eşleşiyorsa otomatik bağlanır.
  const mapping: Record<string, string> = {};
  for (const column of target.columns) {
    const match = parsed.headers.find(
      (h) => h.toLocaleLowerCase("tr-TR") === column.label.toLocaleLowerCase("tr-TR"),
    );
    if (match) mapping[match] = column.key;
  }
  const mapped = new Set(Object.values(mapping));
  const missing = target.columns.filter((c) => c.required && !mapped.has(c.key));
  if (missing.length > 0) {
    return { error: `Zorunlu sütun bulunamadı: ${missing.map((c) => c.label).join(", ")}` };
  }

  const jobId = await createImportJob(session.tenantId, session.userId, {
    targetKey,
    fileName: file.name,
    headers: parsed.headers,
    rows: parsed.rows,
    mapping,
  });

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "import.created",
    entityType: "import_job",
    entityId: jobId,
    metadata: { targetKey, fileName: file.name },
  });
  revalidatePath("/veri-aktarim");
  return { ok: "Dosya doğrulandı. Önizlemeyi kontrol edip uygulayın." };
}

export async function applyImportAction(formData: FormData): Promise<void> {
  const session = await requirePermission("imports:execute");
  await ensureImportTargetsRegistered();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const { inserted } = await applyImportJob(session.tenantId, jobId);
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "import.applied",
    entityType: "import_job",
    entityId: jobId,
    metadata: { inserted },
  });
  revalidatePath("/veri-aktarim");
}

export async function rollbackImportAction(formData: FormData): Promise<void> {
  const session = await requirePermission("imports:rollback");
  await ensureImportTargetsRegistered();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  const { deleted } = await rollbackImportJob(session.tenantId, jobId);
  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "import.rolled_back",
    entityType: "import_job",
    entityId: jobId,
    metadata: { deleted },
  });
  revalidatePath("/veri-aktarim");
}
