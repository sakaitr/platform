import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/auth/session";
import { getTenantAccess } from "@/lib/licensing";

/**
 * Alt yetenek (örn. `satis.teklif`) kapalıysa sayfa menüden gizlenir ama URL ile açılabilir;
 * server action'lar da çalışmamalı. Modül lisansı `requireModule`'de, alt yetenek burada denetlenir.
 */
export async function requireCapability(session: SessionUser, capability: string): Promise<void> {
  const access = await getTenantAccess(session.tenantId);
  if (!access.capabilities.has(capability)) redirect("/dashboard");
}
