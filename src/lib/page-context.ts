import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth/session";
import { getTenantAccess, type TenantAccess } from "@/lib/licensing";
import { getPack } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";

export type PageContext = {
  session: SessionUser;
  access: TenantAccess;
  /** Terim çözücü — sabit metin yerine hep bunu kullan. */
  t: (key: string) => string;
  /** Alt-yetenek açık mı (örn. "muhasebe.irsaliye"). */
  can: (capability: string) => boolean;
};

/**
 * Modül sayfalarının ortak başlangıcı: izin + modül lisansı + sektör terimleri.
 *
 * `moduleKey` verilirse lisans da kontrol edilir. Menüyü gizlemek yetmez —
 * lisanssız modülün URL'si doğrudan yazılarak açılabilmemeli.
 */
export async function pageContext(permission: string, moduleKey?: string): Promise<PageContext> {
  const session = await requirePermission(permission);
  const access = await getTenantAccess(session.tenantId);
  if (moduleKey && access.modules.get(moduleKey)?.allowed !== true) redirect("/dashboard");
  const pack = getPack(access.tenant.sectorPack);
  const terms = await getTerms(session.tenantId, pack.terminology);
  return {
    session,
    access,
    t: terms.t,
    can: (capability: string) => access.capabilities.has(capability),
  };
}

/** Sayfa arama parametreleri — Next 16'da Promise olarak gelir. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function one(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  const value = Array.isArray(v) ? v[0] : v;
  return value && value.length > 0 ? value : undefined;
}
