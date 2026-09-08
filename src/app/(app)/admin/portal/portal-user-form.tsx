"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import type { FormActionState } from "@/components/ui/entity-form";
import { savePortalUserAction } from "@/modules/isbirligi/actions";

/**
 * Portal kullanıcısı formu. Çoklu firma seçimi olduğu için jenerik
 * EntityForm yerine kendi formu var.
 */
export function PortalUserForm({
  companies,
}: {
  companies: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(
    savePortalUserAction,
    null,
  );

  if (!open) return <Button onClick={() => setOpen(true)}>Yeni Portal Kullanıcısı</Button>;

  return (
    <Card className="w-full p-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <Field label="Ad Soyad">
          <input name="fullName" required className={inputClass} />
        </Field>
        <Field label="E-posta">
          <input name="email" type="email" required className={inputClass} />
        </Field>
        <Field label="Şifre" hint="En az 8 karakter">
          <input name="password" type="password" minLength={8} required className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked />
          Aktif
        </label>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-neutral-600">
            Erişebileceği firmalar
          </span>
          <div className="flex flex-wrap gap-3 rounded-lg border border-neutral-200 p-3">
            {companies.length === 0 ? (
              <span className="text-xs text-neutral-500">Önce firma tanımlayın.</span>
            ) : (
              companies.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="companyIds" value={c.id} />
                  {c.name}
                </label>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
          {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  );
}
