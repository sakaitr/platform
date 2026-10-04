import { and, desc, eq, sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { crmApiKeys, crmLeads, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { bearerToken, parseApiKey, verifyApiKeySecret, type ApiScope } from "@/lib/api-keys";
import { getTenantAccess } from "@/lib/licensing";

/**
 * Genel okuma API'si (`/api/v1`). Kimlik doğrulama oturumsuzdur: anahtarı bulmak için `crm_api_keys`
 * satırı önek ile okunur. Bu, gelen webhook'taki gibi belgelenmiş DAR `dbAdmin` istisnasıdır (tek satır,
 * yalnız kiracı kimliği ve özet için); sonrasında her şey `withTenant(tenantId)` içinde yürür.
 */

export type ApiAuth =
  | { ok: true; tenantId: string; keyId: string; scopes: string[] }
  | { ok: false; status: 401 | 403; error: string };

const UNAUTHORIZED: ApiAuth = { ok: false, status: 401, error: "invalid_api_key" };
const TOUCH_INTERVAL_MS = 60_000;

/** Anahtar yok, biçim bozuk, önek bilinmiyor, gizli yanlış, iptal edilmiş: hepsi AYNI yanıt (anahtar varlığı sızmaz). */
export async function authenticateApiRequest(
  authorization: string | null,
  requiredScope: ApiScope,
  now: Date = new Date(),
): Promise<ApiAuth> {
  const parsed = parseApiKey(bearerToken(authorization));
  if (!parsed) return UNAUTHORIZED;

  const [key] = await dbAdmin
    .select({
      id: crmApiKeys.id,
      tenantId: crmApiKeys.tenantId,
      keyHash: crmApiKeys.keyHash,
      scopes: crmApiKeys.scopes,
      revokedAt: crmApiKeys.revokedAt,
      lastUsedAt: crmApiKeys.lastUsedAt,
    })
    .from(crmApiKeys)
    .where(eq(crmApiKeys.prefix, parsed.prefix));

  // Bilinmeyen önekte de özet karşılaştırması yapılır: yanıt süresi anahtar varlığını belli etmesin
  const storedHash = key?.keyHash ?? "0".repeat(64);
  const secretOk = verifyApiKeySecret(parsed.secret, storedHash);
  if (!key || !secretOk || key.revokedAt) return UNAUTHORIZED;

  const access = await getTenantAccess(key.tenantId);
  if (access.modules.get("satis")?.allowed !== true || !access.capabilities.has("satis.entegrasyon")) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : [];
  if (!scopes.includes(requiredScope)) return { ok: false, status: 403, error: "insufficient_scope" };

  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await withTenant(key.tenantId, (tx) =>
      tx.update(crmApiKeys).set({ lastUsedAt: now }).where(and(eq(crmApiKeys.tenantId, key.tenantId), eq(crmApiKeys.id, key.id))),
    );
  }
  return { ok: true, tenantId: key.tenantId, keyId: key.id, scopes };
}

type LeadRow = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  sector: string | null;
  message: string | null;
  service: string | null;
  source: string;
  status: string;
  temperature: string | null;
  score: number;
  eventName: string | null;
  estimatedValue: string | null;
  followUpAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
};

/** Dışarı çıkan alanlar. Satışçının iç notu (`note`) ve dedup anahtarları bilerek yoktur. */
export function leadToApi(row: LeadRow) {
  return {
    id: row.id,
    name: row.name,
    contact_name: row.contactName,
    phone: row.phone,
    email: row.email,
    website: row.website,
    city: row.city,
    sector: row.sector,
    message: row.message,
    service: row.service,
    origin: row.source,
    status: row.status,
    temperature: row.temperature,
    score: row.score,
    event_name: row.eventName,
    estimated_value: row.estimatedValue,
    follow_up_at: row.followUpAt?.toISOString() ?? null,
    owner: row.ownerName && row.ownerEmail ? { name: row.ownerName, email: row.ownerEmail } : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

const columns = {
  id: crmLeads.id,
  name: crmLeads.name,
  contactName: crmLeads.contactName,
  phone: crmLeads.phone,
  email: crmLeads.email,
  website: crmLeads.website,
  city: crmLeads.city,
  sector: crmLeads.sector,
  message: crmLeads.message,
  service: crmLeads.service,
  source: crmLeads.source,
  status: crmLeads.status,
  temperature: crmLeads.temperature,
  score: crmLeads.score,
  eventName: crmLeads.eventName,
  estimatedValue: crmLeads.estimatedValue,
  followUpAt: crmLeads.followUpAt,
  createdAt: crmLeads.createdAt,
  updatedAt: crmLeads.updatedAt,
  ownerName: users.name,
  ownerEmail: users.email,
};

export const API_STATUSES = ["new", "contacted", "qualified", "disqualified", "converted"] as const;
export const API_SOURCES = ["atricard", "webform", "csv", "manual", "api"] as const;

export type ApiListQuery = { limit?: string | null; page?: string | null; status?: string | null; source?: string | null };

export type ApiListParams =
  | { ok: true; limit: number; page: number; status?: (typeof API_STATUSES)[number]; source?: (typeof API_SOURCES)[number] }
  | { ok: false; error: string };

/** Sayfalama: `limit` 1-100 (varsayılan 50), `page` ≥ 1. Geçersiz sayı varsayılana düşer, geçersiz süzgeç 400. */
export function parseListParams(query: ApiListQuery): ApiListParams {
  const intOr = (raw: string | null | undefined, fallback: number, min: number, max: number): number => {
    const n = Number(raw);
    return raw && Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const limit = intOr(query.limit, 50, 1, 100);
  const page = intOr(query.page, 1, 1, 100_000);
  const status = query.status ?? undefined;
  if (status && !(API_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "invalid_status" };
  const source = query.source ?? undefined;
  if (source && !(API_SOURCES as readonly string[]).includes(source)) return { ok: false, error: "invalid_source" };
  return { ok: true, limit, page, status: status as (typeof API_STATUSES)[number] | undefined, source: source as (typeof API_SOURCES)[number] | undefined };
}

export async function listApiLeads(tenantId: string, params: Extract<ApiListParams, { ok: true }>) {
  const where = and(
    eq(crmLeads.tenantId, tenantId),
    params.status ? eq(crmLeads.status, params.status) : undefined,
    params.source ? eq(crmLeads.source, params.source) : undefined,
  );
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select(columns)
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(where)
      .orderBy(desc(crmLeads.createdAt), desc(crmLeads.id))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit);
    const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(crmLeads).where(where);
    return { data: rows.map(leadToApi), total: total?.n ?? 0, page: params.page, page_size: params.limit };
  });
}

export async function getApiLead(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select(columns)
      .from(crmLeads)
      .leftJoin(users, eq(users.id, crmLeads.ownerUserId))
      .where(and(eq(crmLeads.tenantId, tenantId), eq(crmLeads.id, id))),
  );
  return row ? leadToApi(row) : null;
}
