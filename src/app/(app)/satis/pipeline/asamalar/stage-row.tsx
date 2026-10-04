"use client";

import { useActionState } from "react";
import { Button, inputClass } from "@/components/ui";
import {
  deleteStageAction,
  moveStageAction,
  saveStageAction,
  type ActionState,
} from "@/modules/satis/pipeline-actions";

type Stage = { id: string; label: string; kind: "open" | "won" | "lost"; color: string | null; deals: number };

const KIND_LABEL = { open: "Açık", won: "Kazanıldı", lost: "Kaybedildi" } as const;

export function StageRow({
  stage,
  sameKind,
  first,
  last,
}: {
  stage: Stage;
  /** Fırsatların taşınabileceği, aynı türdeki diğer aşamalar. */
  sameKind: { id: string; label: string }[];
  first: boolean;
  last: boolean;
}) {
  const [saved, save, saving] = useActionState<ActionState, FormData>(saveStageAction, null);
  const [removed, remove, removing] = useActionState<ActionState, FormData>(deleteStageAction, null);

  return (
    <li className="space-y-2 rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <form action={save} className="flex flex-1 flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={stage.id} />
          <label className="min-w-40 flex-1 text-xs text-neutral-600">
            Ad
            <input name="label" required defaultValue={stage.label} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-xs text-neutral-600">
            Tür
            <select name="kind" defaultValue={stage.kind} className={`${inputClass} mt-1`}>
              {Object.entries(KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Renk
            <input name="color" type="color" defaultValue={stage.color ?? "#94a3b8"} className="mt-1 h-8 w-12 rounded border border-neutral-300" />
          </label>
          <Button type="submit" disabled={saving}>Kaydet</Button>
        </form>
        <form action={moveStageAction} className="flex gap-1">
          <input type="hidden" name="id" value={stage.id} />
          <Button type="submit" variant="ghost" name="direction" value="up" disabled={first} aria-label={`${stage.label} yukarı`}>↑</Button>
          <Button type="submit" variant="ghost" name="direction" value="down" disabled={last} aria-label={`${stage.label} aşağı`}>↓</Button>
        </form>
      </div>
      <form action={remove} className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <input type="hidden" name="id" value={stage.id} />
        <span>{stage.deals} fırsat</span>
        {stage.deals > 0 ? (
          <label className="flex items-center gap-1">
            Silerken taşı:
            <select name="moveTo" defaultValue="" className="rounded border border-neutral-300 px-1 py-0.5">
              <option value="">Seçin</option>
              {sameKind.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" variant="danger" disabled={removing}>Aşamayı sil</Button>
        {saved && "error" in saved ? <span className="text-red-600">{saved.error}</span> : null}
        {saved && "ok" in saved ? <span className="text-emerald-600">{saved.ok}</span> : null}
        {removed && "error" in removed ? <span className="text-red-600">{removed.error}</span> : null}
      </form>
    </li>
  );
}
