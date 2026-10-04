"use client";

import { useActionState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import type { FormActionState } from "@/components/ui/entity-form";
import { submitDailyAction } from "@/modules/operasyon/gunluk/actions";
import type { DailyQuestion } from "@/db/schema";

/** Cevap değeri: metin ya da checklist için dizi. */
type Answers = Record<string, unknown>;

function isChecked(answers: Answers | undefined, questionId: string, option: string): boolean {
  const value = answers?.[questionId];
  return Array.isArray(value) ? value.includes(option) : value === option;
}

export function DailyForm({
  questions,
  answers,
  note,
  alreadyFilled,
}: {
  questions: readonly DailyQuestion[];
  answers?: Answers;
  note?: string | null;
  alreadyFilled: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(submitDailyAction, null);

  if (questions.length === 0) {
    return (
      <Card className="p-6 text-sm text-neutral-500">
        Henüz soru tanımlanmamış. Yönetici sorular ekleyince burada görünür.
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <form action={formAction} className="space-y-4">
        {questions.map((q) => {
          const options = (q.options as string[]) ?? [];
          const current = answers?.[q.id];
          return (
            <div key={q.id}>
              {q.type === "evet_hayir" ? (
                <Field label={q.label}>
                  <select name={`q_${q.id}`} required={q.required} defaultValue={String(current ?? "")} className={inputClass}>
                    <option value="">—</option>
                    <option value="evet">Evet</option>
                    <option value="hayir">Hayır</option>
                  </select>
                </Field>
              ) : q.type === "secim" ? (
                <Field label={q.label}>
                  <select name={`q_${q.id}`} required={q.required} defaultValue={String(current ?? "")} className={inputClass}>
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : q.type === "checklist" ? (
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-neutral-600">{q.label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {options.map((o) => (
                      <label key={o} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name={`q_${q.id}`}
                          value={o}
                          defaultChecked={isChecked(answers, q.id, o)}
                        />
                        {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : q.type === "uzun_metin" ? (
                <Field label={q.label}>
                  <textarea name={`q_${q.id}`} rows={3} required={q.required} defaultValue={String(current ?? "")} className={inputClass} />
                </Field>
              ) : (
                <Field label={q.label}>
                  <input name={`q_${q.id}`} required={q.required} defaultValue={String(current ?? "")} className={inputClass} />
                </Field>
              )}
            </div>
          );
        })}

        <Field label="Genel Not">
          <textarea name="note" rows={2} defaultValue={note ?? ""} className={inputClass} />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : alreadyFilled ? "Güncelle" : "Gönder"}
          </Button>
          {alreadyFilled ? (
            <span className="text-xs text-neutral-500">Bugün için kayıt var, gönderdiğinde güncellenir.</span>
          ) : null}
          {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
          {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
        </div>
      </form>
    </Card>
  );
}
