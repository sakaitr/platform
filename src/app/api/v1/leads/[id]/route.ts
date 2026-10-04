import { NextResponse, type NextRequest } from "next/server";
import { clientIp, createRateLimiter, redisStore } from "@/lib/rate-limit";
import { authenticateApiRequest, getApiLead } from "@/modules/satis/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000, store: redisStore() });
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const limit = await limiter(`api:${clientIp(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const auth = await authenticateApiRequest(request.headers.get("authorization"), "leads:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: auth.status === 401 ? { ...headers, "WWW-Authenticate": "Bearer" } : headers });
  }
  const { id } = await params;
  const lead = await getApiLead(auth.tenantId, id);
  return lead ? NextResponse.json({ data: lead }, { headers }) : NextResponse.json({ error: "not_found" }, { status: 404, headers });
}
