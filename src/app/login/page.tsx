"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">Agno Platform</h1>
          <p className="text-sm text-neutral-500">Hesabınıza giriş yapın</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">E-posta</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900" />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Şifre</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900" />
        </div>

        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>

        <Link href="/sifre-sifirla" className="block text-center text-xs text-neutral-500 hover:text-neutral-900">
          Şifremi unuttum
        </Link>
      </form>
    </main>
  );
}
