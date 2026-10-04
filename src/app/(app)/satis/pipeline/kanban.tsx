"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, inputClass } from "@/components/ui";
import { moveDealAction } from "@/modules/satis/pipeline-actions";

export type KanbanDeal = {
  id: string;
  title: string;
  value: number;
  currency: string;
  ownerName: string | null;
  who: string | null;
  expectedClose: string | null;
};

export type KanbanColumn = {
  id: string;
  label: string;
  kind: "open" | "won" | "lost";
  color: string | null;
  count: number;
  value: number;
  truncated: boolean;
  deals: KanbanDeal[];
};

const money = (value: number, currency: string): string =>
  `${value.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} ${currency === "TRY" ? "TL" : currency}`;

/**
 * Sürükle-bırak kanban. Her kartta aynı işi yapan bir aşama seçici de var: klavye ve dokunmatik
 * kullanım için sürüklemeye bağımlı kalmaz. `lost` aşamasına bırakınca neden sorulur.
 */
export function Kanban({ columns, canMove }: { columns: KanbanColumn[]; canMove: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ dealId: string; stageId: string; stageLabel: string } | null>(null);
  const [reason, setReason] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const kindOf = (stageId: string) => columns.find((c) => c.id === stageId)!;

  const move = (dealId: string, stageId: string, lostReason?: string): void => {
    setError(null);
    startTransition(async () => {
      const result = await moveDealAction(dealId, stageId, lostReason);
      if ("error" in result) setError(result.error);
    });
  };

  const request = (dealId: string, stageId: string): void => {
    const target = kindOf(stageId);
    if (target.kind === "lost") {
      setReason("");
      setPendingLost({ dealId, stageId, stageLabel: target.label });
      return;
    }
    move(dealId, stageId);
  };

  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {pendingLost ? (
        <form
          className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) {
              setError("Kaybedilen fırsat için neden yazın.");
              return;
            }
            move(pendingLost.dealId, pendingLost.stageId, reason);
            setPendingLost(null);
          }}
        >
          <label className="block text-sm font-medium">
            "{pendingLost.stageLabel}" aşamasına taşınıyor. Neden kaybedildi?
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              name="lostReason"
              className={`${inputClass} mt-1`}
              placeholder="Örn. bütçe yetersiz, rakibi seçti"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit">Kaydet</Button>
            <Button type="button" variant="ghost" onClick={() => setPendingLost(null)}>Vazgeç</Button>
          </div>
        </form>
      ) : null}

      <div className={`grid gap-3 overflow-x-auto pb-2 ${busy ? "opacity-70" : ""}`} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(240px, 1fr))` }}>
        {columns.map((column) => (
          <section
            key={column.id}
            aria-label={column.label}
            data-stage-id={column.id}
            onDragOver={(e) => {
              if (canMove) {
                e.preventDefault();
                setOver(column.id);
              }
            }}
            onDragLeave={() => setOver((cur) => (cur === column.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const dealId = e.dataTransfer.getData("text/plain");
              if (canMove && dealId) request(dealId, column.id);
            }}
            className={`flex min-h-40 flex-col rounded-xl border bg-neutral-50 ${over === column.id ? "border-neutral-900 bg-neutral-100" : "border-neutral-200"}`}
          >
            <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: column.color ?? "#94a3b8" }} aria-hidden />
                {column.label}
              </span>
              <span className="text-xs text-neutral-500">{column.count} · {money(column.value, "TRY")}</span>
            </header>
            <ul className="flex-1 space-y-2 p-2">
              {column.deals.map((deal) => (
                <li
                  key={deal.id}
                  draggable={canMove}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
                  className="space-y-1 rounded-lg border border-neutral-200 bg-white p-3 text-sm shadow-sm"
                >
                  <Link href={`/satis/pipeline/${deal.id}`} className="block font-medium hover:underline">{deal.title}</Link>
                  <p className="text-xs text-neutral-500">{money(deal.value, deal.currency)}{deal.who ? ` · ${deal.who}` : ""}</p>
                  <p className="text-xs text-neutral-400">{deal.ownerName ?? "Sahipsiz"}{deal.expectedClose ? ` · ${deal.expectedClose}` : ""}</p>
                  {canMove ? (
                    <select
                      aria-label={`${deal.title} aşaması`}
                      value={column.id}
                      onChange={(e) => request(deal.id, e.target.value)}
                      className="mt-1 w-full rounded border border-neutral-200 px-1 py-0.5 text-xs"
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  ) : null}
                </li>
              ))}
              {column.deals.length === 0 ? <li className="px-1 py-6 text-center text-xs text-neutral-400">Fırsat yok</li> : null}
              {column.truncated ? <li className="px-1 text-center text-xs text-neutral-400">İlk {column.deals.length} fırsat gösteriliyor.</li> : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
