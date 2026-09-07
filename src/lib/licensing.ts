import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  subscriptions,
  tenantCapabilities,
  tenantModules,
  tenants,
  type Subscription,
  type Tenant,
} from "@/db/schema";
import { MODULE_KEYS } from "@/lib/modules/keys";

export type ModuleAccess =
  | { allowed: true; limits: Record<string, number>; warning?: "trial_ending" | "grace" }
  | { allowed: false; reason: "not_licensed" | "expired" | "suspended" | "tenant_inactive" };

export type TenantState = "trial" | "active" | "grace" | "locked";

export type TenantAccess = {
  tenant: Tenant;
  subscription: Subscription;
  state: TenantState;
  modules: Map<string, ModuleAccess>;
  capabilities: Set<string>;
};

function resolveState(sub: Subscription, now: Date): TenantState {
  if (sub.status === "suspended" || sub.status === "expired") return "locked";
  if (sub.status === "trial") {
    return sub.trialEndsAt && sub.trialEndsAt.getTime() < now.getTime() ? "locked" : "trial";
  }
  if (!sub.currentPeriodEnd) return "active";
  if (sub.currentPeriodEnd.getTime() >= now.getTime()) return "active";

  const graceMs = Number(sub.graceDays) * 86_400_000;
  return now.getTime() <= sub.currentPeriodEnd.getTime() + graceMs ? "grace" : "locked";
}

/**
 * Kiracının tüm erişim durumunu tek seferde çözer.
 * İstek başına bir kez çağrılır; sonuç kabuk layout'unda taşınır.
 */
export async function getTenantAccess(tenantId: string): Promise<TenantAccess> {
  const now = new Date();

  const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const [subscription] = await dbAdmin
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription) throw new Error(`Subscription not found for tenant: ${tenantId}`);

  const licenses = await dbAdmin
    .select()
    .from(tenantModules)
    .where(eq(tenantModules.tenantId, tenantId));
  const caps = await dbAdmin
    .select()
    .from(tenantCapabilities)
    .where(eq(tenantCapabilities.tenantId, tenantId));

  const state = tenant.isActive ? resolveState(subscription, now) : "locked";
  const modules = new Map<string, ModuleAccess>();

  for (const license of licenses) {
    if (!tenant.isActive) {
      modules.set(license.moduleKey, { allowed: false, reason: "tenant_inactive" });
      continue;
    }
    if (license.status === "suspended") {
      modules.set(license.moduleKey, { allowed: false, reason: "suspended" });
      continue;
    }
    // Modüle özel bitiş tarihi aboneliği ezer
    if (license.endsAt && license.endsAt.getTime() < now.getTime()) {
      modules.set(license.moduleKey, { allowed: false, reason: "expired" });
      continue;
    }
    if (state === "locked") {
      modules.set(license.moduleKey, { allowed: false, reason: "expired" });
      continue;
    }

    const limits = (license.limits as Record<string, number>) ?? {};
    modules.set(
      license.moduleKey,
      state === "grace" ? { allowed: true, limits, warning: "grace" } : { allowed: true, limits },
    );
  }

  for (const moduleKey of MODULE_KEYS) {
    if (!modules.has(moduleKey)) modules.set(moduleKey, { allowed: false, reason: "not_licensed" });
  }

  return {
    tenant,
    subscription,
    state,
    modules,
    capabilities: new Set(caps.filter((c) => c.enabled).map((c) => c.capabilityKey)),
  };
}
