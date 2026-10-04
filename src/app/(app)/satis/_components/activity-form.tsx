"use client";

import { useEffect, useRef } from "react";
import { Button, inputClass } from "@/components/ui";
import { useFormAction } from "@/components/ui/use-form-action";
import { addActivityAction, type ActionState } from "@/modules/satis/pipeline-actions";

/** Aday ya da fırsat için not/arama/görüşme/e-posta kaydı ve görev ekler. */
export function ActivityForm({
  leadId,
  dealId,
  owners,
  canAssign,
}: {
  leadId?: string;
  dealId?: string;
  owners: { id: string; name: string }[];
  /** Yalnız tüm kayıtları görebilenler başkasına görev atar. */
  canAssign: boolean;
}) {
  const { state, pending, onSubmit } = useFormAction<ActionState>(addActivityAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && "ok" in state) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-6">
      <input type="hidden" name="leadId" value={leadId ?? ""} />
      <input type="hidden" name="dealId" value={dealId ?? ""} />
      <select name="type" aria-label="Tür" defaultValue="note" className={`${inputClass} sm:col-span-1`}>
        <option value="note">Not</option>
        <option value="call">Arama</option>
        <option value="meeting">Görüşme</option>
        <option value="email">E-posta</option>
        <option value="task">Görev</option>
      </select>
      <input name="subject" aria-label="Konu" required placeholder="Konu" className={`${inputClass} sm:col-span-3`} />
      <input name="due" type="datetime-local" aria-label="Vade (görev için)" className={`${inputClass} sm:col-span-2`} />
      <textarea name="note" aria-label="Ayrıntı" rows={2} placeholder="Ayrıntı (isteğe bağlı)" className={`${inputClass} sm:col-span-4`} />
      {canAssign ? (
        <select name="assigneeUserId" aria-label="Görev sahibi" defaultValue="" className={`${inputClass} sm:col-span-2`}>
          <option value="">Görev bana</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      ) : (
        <span className="sm:col-span-2" />
      )}
      <div className="flex items-center gap-3 sm:col-span-6">
        <Button type="submit" disabled={pending}>{pending ? "Ekleniyor…" : "Ekle"}</Button>
        {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
        {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        <span className="text-xs text-neutral-400">Vade yalnız görevler içindir.</span>
      </div>
    </form>
  );
}
