"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { performResetAction, requestResetAction, type ResetState } from "./actions";

function ResetForm() {
  const token = useSearchParams().get("token");
  const action = token ? performResetAction : requestResetAction;
  const [state, formAction, pending] = useActionState<ResetState, FormData>(action, null);

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8">
      <h1 className="text-lg font-semibold">{token ? "Yeni şifre belirle" : "Şifremi unuttum"}</h1>

      {token ? (
        <>
          <input type="hidden" name="token" value={token} />
          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">Yeni şifre</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">E-posta</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>
      )}

      {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state && "ok" in state ? <p className="text-sm text-green-700">{state.ok}</p> : null}

      <button type="submit" disabled={pending}
        className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? "Gönderiliyor..." : token ? "Şifreyi güncelle" : "Sıfırlama bağlantısı gönder"}
      </button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense fallback={null}>
        <ResetForm />
      </Suspense>
    </main>
  );
}
