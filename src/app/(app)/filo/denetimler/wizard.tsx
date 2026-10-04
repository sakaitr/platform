"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";
import type { FormActionState } from "@/components/ui/entity-form";
import { saveInspectionAction } from "@/modules/filo/denetim/actions";
import { resolveResult, summarize, type CriterionAnswer } from "@/modules/filo/denetim/logic";

type Criterion = { id: string; label: string };
type Option = { value: string; label: string };

const ANSWERS: Array<{ value: CriterionAnswer["answer"]; label: string; tone: string }> = [
  { value: "onay", label: "Onay", tone: "ok" },
  { value: "kosullu", label: "Koşullu", tone: "warn" },
  { value: "red", label: "Red", tone: "bad" },
  { value: "atlandi", label: "Atla", tone: "mute" },
];

/**
 * Denetim sihirbazı: kurulum → kriterler → özet.
 * Kriterler tek tek gösterilir; sahada tablet ile tek elle doldurulur.
 */
export function InspectionWizard({
  vehicles,
  types,
  companies,
  criteriaByType,
  today,
}: {
  vehicles: readonly Option[];
  types: readonly Option[];
  companies: readonly Option[];
  criteriaByType: Record<string, Criterion[]>;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"kurulum" | "kriterler" | "ozet">("kurulum");
  const [typeId, setTypeId] = useState(types[0]?.value ?? "");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, CriterionAnswer["answer"]>>({});
  const [state, formAction, pending] = useActionState<FormActionState, FormData>(
    saveInspectionAction,
    null,
  );

  const criteria = criteriaByType[typeId] ?? [];
  const current = criteria[index];

  const asAnswers = (): CriterionAnswer[] =>
    criteria.map((c) => ({
      criterionId: c.id,
      label: c.label,
      answer: answers[c.id] ?? "atlandi",
    }));

  if (!open) return <Button onClick={() => setOpen(true)}>Yeni Denetim</Button>;

  const summary = summarize(asAnswers());
  const result = resolveResult(asAnswers());
  const resultTone = result === "gecti" ? "ok" : result === "kaldi" ? "bad" : result === "sartli" ? "warn" : "mute";

  return (
    <Card className="w-full p-4">
      <form action={formAction}>
        {/* Adımlar arasında geçerken alanlar DOM'da kalsın diye gizliyoruz,
            kaldırmıyoruz: aksi halde girilen cevaplar gönderilmez. */}
        <div className="mb-3 flex items-center gap-2 text-xs">
          {(["kurulum", "kriterler", "ozet"] as const).map((s, i) => (
            <span
              key={s}
              className={`rounded-full px-2 py-0.5 ${
                step === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {i + 1}. {s === "kurulum" ? "Kurulum" : s === "kriterler" ? "Kriterler" : "Özet"}
            </span>
          ))}
        </div>

        <div hidden={step !== "kurulum"} className="grid gap-3 sm:grid-cols-2">
          <Field label="Araç">
            <select name="vehicleId" required className={inputClass}>
              {vehicles.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Denetim Türü">
            <select
              name="typeId"
              required
              value={typeId}
              onChange={(e) => {
                setTypeId(e.target.value);
                setIndex(0);
                setAnswers({});
              }}
              className={inputClass}
            >
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tarih">
            <input type="date" name="inspectionDate" required defaultValue={today} className={inputClass} />
          </Field>
          <Field label="Firma">
            <select name="companyId" className={inputClass}>
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Termin" hint="Eksiklerin giderilmesi için verilen süre">
            <input type="date" name="deadline" className={inputClass} />
          </Field>

          <div className="flex items-center gap-2 sm:col-span-2">
            <Button
              type="button"
              onClick={() => setStep("kriterler")}
              disabled={criteria.length === 0}
            >
              Kriterlere Geç ({criteria.length})
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            {criteria.length === 0 ? (
              <span className="text-xs text-amber-700">Bu türde tanımlı kriter yok.</span>
            ) : null}
          </div>
        </div>

        <div hidden={step !== "kriterler"}>
          {current ? (
            <div className="space-y-3">
              <p className="text-xs text-neutral-500">
                Kriter {index + 1} / {criteria.length}
              </p>
              <p className="text-lg font-medium">{current.label}</p>

              <div className="flex flex-wrap gap-2">
                {ANSWERS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => {
                      setAnswers((prev) => ({ ...prev, [current.id]: a.value }));
                      if (index < criteria.length - 1) setIndex(index + 1);
                      else setStep("ozet");
                    }}
                    className={`rounded-lg border px-4 py-2 text-sm ${
                      answers[current.id] === a.value
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <Field label="Not">
                <input name={`n_${current.id}`} className={inputClass} />
              </Field>
              <Field label="Fotoğraf" hint="JPG, PNG veya WEBP · en fazla 8 MB">
                <input type="file" name={`foto_${current.id}`} accept="image/*" className={inputClass} />
              </Field>

              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => setIndex(Math.max(0, index - 1))}>
                  ← Önceki
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    index < criteria.length - 1 ? setIndex(index + 1) : setStep("ozet")
                  }
                >
                  Sonraki →
                </Button>
                <Button type="button" onClick={() => setStep("ozet")}>
                  Özete Geç
                </Button>
              </div>
            </div>
          ) : null}

          {/* Cevaplar gizli alanlarda taşınır — adım değişse de kaybolmaz. */}
          {criteria.map((c) => (
            <input key={c.id} type="hidden" name={`k_${c.id}`} value={answers[c.id] ?? "atlandi"} />
          ))}
        </div>

        <div hidden={step !== "ozet"} className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={resultTone}>
              {result === "gecti"
                ? "Geçti"
                : result === "kaldi"
                  ? "Kaldı"
                  : result === "sartli"
                    ? "Şartlı"
                    : "Değerlendirme bekleniyor"}
            </Badge>
            <span className="text-sm text-neutral-600">
              {summary.onay} onay · {summary.kosullu} koşullu · {summary.red} red ·{" "}
              {summary.atlandi} atlandı · başarı %{summary.basariOrani}
            </span>
          </div>

          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-3 text-sm">
            {criteria.map((c) => {
              const value = answers[c.id] ?? "atlandi";
              const meta = ANSWERS.find((a) => a.value === value)!;
              return (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{c.label}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
              );
            })}
          </div>

          <Field label="Genel Not">
            <textarea name="notes" rows={2} className={inputClass} />
          </Field>
          <Field label="Genel Fotoğraflar">
            <input type="file" name="foto" accept="image/*" multiple className={inputClass} />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Denetimi Kaydet"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("kriterler")}>
              ← Kriterlere dön
            </Button>
            {state && "error" in state ? <span className="text-xs text-red-600">{state.error}</span> : null}
            {state && "ok" in state ? <span className="text-xs text-emerald-600">{state.ok}</span> : null}
          </div>
        </div>
      </form>
    </Card>
  );
}
