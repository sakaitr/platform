"use client";

import { useActionState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import type { FormActionState } from "@/components/ui/entity-form";
import { uploadImportAction } from "@/modules/imports/actions";

export function UploadForm({
  targets,
}: {
  targets: readonly { key: string; label: string; columns: readonly { label: string; required: boolean }[] }[];
}) {
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(uploadImportAction, null);

  return (
    <Card className="p-4">
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <Field label="Hedef">
          <select name="targetKey" required className={inputClass}>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dosya" hint="CSV — ayırıcı olarak ; veya , kullanılabilir. En fazla 5 MB.">
          <input type="file" name="file" accept=".csv,text/csv" required className={inputClass} />
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-2 text-xs text-neutral-500">
            Dosyanın ilk satırı başlık olmalı. Başlıklar aşağıdaki adlarla birebir eşleşmeli:
          </p>
          <div className="space-y-1 text-xs">
            {targets.map((t) => (
              <div key={t.key}>
                <span className="font-medium">{t.label}:</span>{" "}
                <span className="text-neutral-500">
                  {t.columns.map((c) => `${c.label}${c.required ? "*" : ""}`).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Doğrulanıyor…" : "Yükle ve Doğrula"}
          </Button>
          {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
          {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  );
}
