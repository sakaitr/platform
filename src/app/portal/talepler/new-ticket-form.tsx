"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { portalCreateTicketAction, type PortalState } from "../actions";

export function NewTicketForm({
  companies,
}: {
  companies: readonly { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<PortalState, FormData>(
    portalCreateTicketAction,
    null,
  );

  if (!open) return <Button onClick={() => setOpen(true)}>Yeni Talep</Button>;

  return (
    <Card className="w-full p-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <Field label="Firma">
          <select name="companyId" required className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Öncelik">
          <select name="priority" defaultValue="normal" className={inputClass}>
            <option value="dusuk">Düşük</option>
            <option value="normal">Normal</option>
            <option value="yuksek">Yüksek</option>
            <option value="kritik">Kritik</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Konu">
            <input name="title" required className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Açıklama">
            <textarea name="description" rows={4} required className={inputClass} />
          </Field>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Gönderiliyor…" : "Gönder"}
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
