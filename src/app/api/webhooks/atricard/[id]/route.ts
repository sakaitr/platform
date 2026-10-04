import { NextResponse, type NextRequest } from "next/server";
import { clientIp, createRateLimiter, redisStore } from "@/lib/rate-limit";
import { handleAtricardWebhook, MAX_BODY_BYTES } from "@/modules/satis/inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// IP başına dakikada 120 istek: Atricard tekrar denemeleri dahil bol, tarama/kaba kuvvet için dar
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000, store: redisStore() });

/** Atricard → AtriCRM. Sözleşme ve işleme kuralları `modules/satis/inbound.ts` içinde. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  const limit = await limiter(`atricard:${id}:${clientIp(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const rawBody = await request.text();
  const result = await handleAtricardWebhook({
    integrationId: id,
    rawBody,
    event: request.headers.get("x-atricard-event"),
    deliveryId: request.headers.get("x-atricard-delivery"),
    timestamp: request.headers.get("x-atricard-timestamp"),
    signature: request.headers.get("x-atricard-signature"),
  });
  return NextResponse.json(result.body, { status: result.httpStatus, headers: { "Cache-Control": "no-store" } });
}
