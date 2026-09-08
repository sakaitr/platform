"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Card, Field, inputClass } from "./index";

export type FormActionState = { error: string } | { ok: string } | null;

export type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "time" | "email" | "tel" | "select" | "checkbox" | "textarea";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** select için */
  options?: readonly { value: string; label: string }[];
  /** İki sütunlu ızgarada tam genişlik */
  wide?: boolean;
};

type Values = Record<string, unknown>;

function Control({ spec, value }: { spec: FieldSpec; value: unknown }) {
  const common = { name: spec.name, required: spec.required, className: inputClass };
  if (spec.type === "select") {
    return (
      <select {...common} defaultValue={value == null ? "" : String(value)}>
        <option value="">—</option>
        {(spec.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (spec.type === "textarea") {
    return <textarea {...common} rows={3} defaultValue={value == null ? "" : String(value)} />;
  }
  return (
    <input
      {...common}
      type={spec.type}
      placeholder={spec.placeholder}
      defaultValue={value == null ? "" : String(value)}
    />
  );
}

/**
 * Alan tanımından form üreten ortak bileşen.
 * Modül sayfaları form işaretlemesi yazmaz, sadece alanları bildirir.
 */
export function EntityForm({
  action,
  fields,
  values,
  openLabel,
  idValue,
  extraHidden,
  alwaysOpen = false,
}: {
  action: (state: FormActionState, formData: FormData) => Promise<FormActionState>;
  fields: readonly FieldSpec[];
  values?: Values;
  openLabel: string;
  idValue?: string | null;
  extraHidden?: Record<string, string>;
  alwaysOpen?: boolean;
}) {
  const [open, setOpen] = useState(alwaysOpen || Boolean(idValue));
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Yeni kayıt başarılıysa alanları boşalt — üst üste kayıt girerken
  // önceki değerlerin kalması hem yanlış veri hem tekrar hatası üretiyor.
  useEffect(() => {
    if (state && "ok" in state && !idValue) formRef.current?.reset();
  }, [state, idValue]);

  if (!open) return <Button onClick={() => setOpen(true)}>{openLabel}</Button>;

  return (
    <Card className="w-full p-4">
      <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-2">
        {idValue ? <input type="hidden" name="id" value={idValue} /> : null}
        {Object.entries(extraHidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        {fields.map((spec) =>
          spec.type === "checkbox" ? (
            <label key={spec.name} className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name={spec.name} defaultChecked={Boolean(values?.[spec.name])} />
              {spec.label}
            </label>
          ) : (
            <div key={spec.name} className={spec.wide ? "sm:col-span-2" : undefined}>
              <Field label={spec.label} hint={spec.hint}>
                <Control spec={spec} value={values?.[spec.name]} />
              </Field>
            </div>
          ),
        )}

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          {alwaysOpen ? null : (
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          )}
          {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
          {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  );
}
