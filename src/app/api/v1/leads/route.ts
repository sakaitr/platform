import { NextResponse, type NextRequest } from "next/server";
import { clientIp, createRateLimiter, redisStore } from "@/lib/rate-limit";
import { authenticateApiRequest, listApiLeads, parseListParams } from "@/modules/satis/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000, store: redisStore() });
const headers = { "Cache-Control": "no-store" };

/** Aday listesi. `Authorization: Bearer atc_…`, kapsam `leads:read`. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Kimlik doğrulamadan ÖNCE IP başına sınır: anahtar tahminini yavaşlatır
  const limit = await limiter(`api:${clientIp(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const auth = await authenticateApiRequest(request.headers.get("authorization"), "leads:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: auth.status === 401 ? { ...headers, "WWW-Authenticate": "Bearer" } : headers });
  }
  const q = request.nextUrl.searchParams;
  const params = parseListParams({ limit: q.get("limit"), page: q.get("page"), status: q.get("status"), source: q.get("source") });
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: 400, headers });
  return NextResponse.json(await listApiLeads(auth.tenantId, params), { headers });
}
