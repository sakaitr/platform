"use client";

import { useActionState } from "react";
import { Button, Card } from "@/components/ui";
import { importLeadsAction, type ImportState } from "@/modules/satis/actions";

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importLeadsAction, null);
  return (
    <Card className="space-y-3 p-4">
      <form action={action} className="space-y-3">
        <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm" />
        <Button type="submit" disabled={pending}>
          {pending ? "İçe aktarılıyor…" : "İçe aktar"}
        </Button>
      </form>
      {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state && "ok" in state ? (
        <div className="space-y-2 text-sm">
          <p className="text-emerald-700">{state.ok}</p>
          {state.problems.length > 0 ? (
            <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-neutral-600">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
