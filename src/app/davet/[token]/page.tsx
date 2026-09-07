"use client";

import Link from "next/link";
import { use, useActionState } from "react";
import { acceptInviteAction, type InviteState } from "../actions";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, formAction, pending] = useActionState<InviteState, FormData>(acceptInviteAction, null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8">
        <h1 className="text-lg font-semibold">Hesabınızı oluşturun</h1>
        <p className="text-sm text-neutral-500">Devam etmek için bir şifre belirleyin.</p>

        <input type="hidden" name="token" value={token} />
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Şifre</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>

        {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {state && "ok" in state ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700">{state.ok}</p>
            <Link href="/login" className="block text-center text-sm font-medium text-neutral-900 underline">
              Giriş yap
            </Link>
          </div>
        ) : null}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Oluşturuluyor..." : "Hesabı oluştur"}
        </button>
      </form>
    </main>
  );
}
