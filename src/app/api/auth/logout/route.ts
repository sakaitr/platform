import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, destroySessionByToken } from "@/lib/auth";

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (token) await destroySessionByToken(token);
  store.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
