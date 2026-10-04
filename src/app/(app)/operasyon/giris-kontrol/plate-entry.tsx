"use client";

import { useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import type { BoardRow } from "@/modules/operasyon/arrivals/board";
import { markArrivalAction } from "@/modules/operasyon/arrivals/actions";

/**
 * Plaka ile hızlı giriş — kapıdaki görevlinin ana aracı.
 * Son ekle eşleşir: "01" yazınca 34ABC01 bulunur. Birden çok eşleşmede seçtirir.
 */
export function PlateEntry({
  rows,
  companyId,
  date,
  shift,
}: {
  rows: readonly BoardRow[];
  companyId: string;
  date: string;
  shift: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const needle = query.toLocaleUpperCase("tr-TR").replace(/[\s-]+/g, "");
  const matches = needle.length === 0 ? [] : rows.filter((r) => r.plate.endsWith(needle));
  const pending = matches.filter((r) => r.arrivalId === null);
  const alreadyMarked = matches.length > 0 && pending.length === 0;

  return (
    <Card className="p-4">
      <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Plaka ile Hızlı Giriş</p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Plakanın son hanelerini yazın"
          autoComplete="off"
          className="w-64 rounded-lg border border-neutral-300 px-3 py-2 text-lg font-medium tracking-wide outline-none focus:border-neutral-900"
        />
        {query.length > 0 ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            Temizle
          </Button>
        ) : null}
      </div>

      {needle.length > 0 ? (
        <div className="mt-3 space-y-2">
          {matches.length === 0 ? (
            <p className="text-sm text-amber-700">
              Bu firmanın bugünkü listesinde {needle} ile biten araç yok.
            </p>
          ) : alreadyMarked ? (
            <p className="text-sm text-neutral-500">
              {matches.map((m) => m.plate).join(", ")} zaten işaretli
              {matches[0]!.arrivedAt ? ` (${matches[0]!.arrivedAt})` : ""}.
            </p>
          ) : (
            <>
              {pending.length > 1 ? (
                <p className="text-xs text-neutral-500">
                  {pending.length} araç eşleşti, birini seçin:
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {pending.map((row) => (
                  <form
                    key={row.vehicleId}
                    action={markArrivalAction}
                    onSubmit={() => setQuery("")}
                  >
                    <input type="hidden" name="vehicleId" value={row.vehicleId} />
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="shift" value={shift} />
                    <Button type="submit">{row.plate} · Geldi</Button>
                  </form>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
