import { and, count, eq, gt, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmLeads, invites, users } from "@/db/schema";
import { getTenantAccess } from "./licensing";

/**
 * Modül lisansındaki sayısal sınırlar (`tenant_modules.limits`).
 * Sınır tanımsızsa "sınırsız": paketleme ve fiyat henüz karar değil, mekanizma hazır durur.
 */
export type LimitKey = "max_users" | "max_leads";

export type LimitResult =
  | { ok: true }
  | { ok: false; limit: number; current: number; message: string };

const LIMIT_LABEL: Record<LimitKey, string> = {
  max_users: "kullanıcı",
  max_leads: "aday",
};

/** Saf karar: `current` kadar kayıt varken `adding` kayıt daha eklenebilir mi. */
export function evaluateLimit(
  limits: Record<string, unknown>,
  key: LimitKey,
  current: number,
  adding = 1,
): LimitResult {
  const raw = limits[key];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return { ok: true };
  if (current + adding <= raw) return { ok: true };
  return {
    ok: false,
    limit: raw,
    current,
    message: `Lisansınız en fazla ${raw} ${LIMIT_LABEL[key]} içeriyor. Sınırı yükseltmek için yöneticinizle görüşün.`,
  };
}

export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitExceededError";
  }
}

async function currentCount(tenantId: string, key: LimitKey): Promise<number> {
  if (key === "max_leads") {
    const [row] = await dbAdmin
      .select({ value: count() })
      .from(crmLeads)
      .where(eq(crmLeads.tenantId, tenantId));
    return row?.value ?? 0;
  }
  const [userRow] = await dbAdmin
    .select({ value: count() })
    .from(users)
    .where(eq(users.tenantId, tenantId));
  // Bekleyen davetler de koltuk sayılır; yoksa sınır davet yağdırarak aşılır.
  const [inviteRow] = await dbAdmin
    .select({ value: count() })
    .from(invites)
    .where(
      and(eq(invites.tenantId, tenantId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())),
    );
  return (userRow?.value ?? 0) + (inviteRow?.value ?? 0);
}

/**
 * Yeni kayıt oluşturmadan önce çağrılan tek yardımcı.
 * Sınır `satis` modül lisansından okunur. `adding` toplu içe aktarma içindir.
 */
export async function checkLimit(
  tenantId: string,
  moduleKey: string,
  key: LimitKey,
  adding = 1,
): Promise<LimitResult> {
  const access = await getTenantAccess(tenantId);
  const module = access.modules.get(moduleKey);
  if (!module || !module.allowed) return { ok: true };
  if (typeof module.limits[key] !== "number") return { ok: true };
  return evaluateLimit(module.limits, key, await currentCount(tenantId, key), adding);
}

export async function assertWithinLimit(
  tenantId: string,
  moduleKey: string,
  key: LimitKey,
  adding = 1,
): Promise<void> {
  const result = await checkLimit(tenantId, moduleKey, key, adding);
  if (!result.ok) throw new LimitExceededError(result.message);
}
