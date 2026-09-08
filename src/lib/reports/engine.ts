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

export type { ReportColumn, ReportContext, ReportDef, ReportResult } from "./catalog";
