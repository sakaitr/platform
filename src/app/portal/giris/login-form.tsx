"use client";

import { useActionState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { portalLoginAction, type PortalState } from "../actions";

export function PortalLoginForm() {
  const [state, formAction, pending] = useActionState<PortalState, FormData>(portalLoginAction, null);

  return (
    <Card className="p-5">
      <form action={formAction} className="space-y-3">
        <Field label="E-posta">
          <input name="email" type="email" required autoComplete="username" className={inputClass} />
        </Field>
        <Field label="Şifre">
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Giriş yapılıyor…" : "Giriş Yap"}
        </Button>
        {state && "error" in state ? (
          <p className="text-xs text-red-600">{state.error}</p>
        ) : null}
      </form>
    </Card>
  );
}
