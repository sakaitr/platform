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
  /** Geri almada bu işin eklediği kaydı siler. */
  remove: (tx: TenantTx, tenantId: string, id: string) => Promise<void>;
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

export function listImportTargets(permissions: Set<string>): ImportTarget[] {
  return Object.values(IMPORT_TARGETS)
    .filter((t) => permissions.has(t.permission))
    .sort((a, b) => a.label.localeCompare(b.label));
}
