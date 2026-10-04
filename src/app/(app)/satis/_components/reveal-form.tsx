"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useFormAction } from "@/components/ui/use-form-action";
import type { RevealState } from "@/modules/satis/integration-actions";

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-neutral-600">{label}</p>
      <div className="flex items-center gap-2">
        <code data-testid={`reveal-${label}`} className="block flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-100">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Sunucu eylemini çağırır ve dönen gizli anahtarı YALNIZ burada, bir kez gösterir. Anahtar sayfa verisinde
 * ya da veritabanında okunabilir biçimde bulunmaz; kullanıcı sayfayı yenilerse bir daha göremez.
 */
export function RevealForm({
  action,
  children,
  submitLabel,
  variant = "primary",
  className = "space-y-3",
}: {
  action: (state: RevealState, formData: FormData) => Promise<RevealState>;
  children?: ReactNode;
  submitLabel: string;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
}) {
  const { state, pending, onSubmit } = useFormAction<RevealState>(action, null);
  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "İşleniyor…" : submitLabel}
        </Button>
        {state && "error" in state ? <span role="alert" className="text-sm text-red-600">{state.error}</span> : null}
        {state && "ok" in state ? <span className="text-sm text-emerald-700">{state.ok}</span> : null}
      </div>
      {state && "ok" in state && state.url ? <CopyBox label="Adres" value={state.url} /> : null}
      {state && "ok" in state && state.secret ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">Bu anahtar yalnızca şimdi gösterilir. Kopyalayıp güvenli bir yere kaydedin.</p>
          <CopyBox label="Anahtar" value={state.secret} />
        </div>
      ) : null}
    </form>
  );
}
