"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import type { BoardRow } from "@/modules/operasyon/arrivals/board";
import {
  markArrivalAction,
  unmarkArrivalAction,
  updateArrivalDetailAction,
} from "@/modules/operasyon/arrivals/actions";

const TONE: Record<string, string> = {
  bekliyor: "mute",
  zamaninda: "ok",
  gecikmeli: "bad",
};

const LABEL: Record<string, string> = {
  bekliyor: "Bekleniyor",
  zamaninda: "Zamanında",
  gecikmeli: "Gecikmeli",
};

export function ArrivalRow({
  row,
  companyId,
  date,
  shift,
  canWrite,
}: {
  row: BoardRow;
  companyId: string;
  date: string;
  shift: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const arrived = row.arrivalId !== null;

  return (
    <tr className={arrived ? "hover:bg-neutral-50" : "bg-amber-50/40"}>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-400">{row.sortOrder + 1}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-base font-medium tracking-wide">
        {row.plate}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-500">{row.driverName ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-500">{row.plannedAt ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5 font-medium">{row.arrivedAt ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-2.5">
        <Badge tone={TONE[row.status]}>
          {LABEL[row.status]}
          {row.status === "gecikmeli" && row.delayMinutes !== null ? ` · ${row.delayMinutes} dk` : ""}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-neutral-500">
        {arrived
          ? `${row.actualPassengers ?? "—"} / ${row.expectedPassengers ?? row.capacity ?? "—"}`
          : "—"}
      </td>
      <td className="px-4 py-2.5">
        {editing && row.arrivalId ? (
          <form action={updateArrivalDetailAction} className="flex flex-wrap items-center gap-1">
            <input type="hidden" name="arrivalId" value={row.arrivalId} />
            <input
              name="arrivedAt"
              type="time"
              defaultValue={row.arrivedAt ?? ""}
              className="w-24 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
            />
            <input
              name="actualPassengers"
              type="number"
              min={0}
              placeholder="gelen"
              defaultValue={row.actualPassengers ?? ""}
              className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
            />
            <input
              name="expectedPassengers"
              type="number"
              min={0}
              placeholder="beklenen"
              defaultValue={row.expectedPassengers ?? ""}
              className="w-20 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
            />
            <input
              name="note"
              placeholder="not"
              defaultValue={row.note ?? ""}
              className="w-32 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
            />
            <Button type="submit">Kaydet</Button>
          </form>
        ) : (
          <div className="flex justify-end gap-2">
            {!arrived && canWrite ? (
              <form action={markArrivalAction}>
                <input type="hidden" name="vehicleId" value={row.vehicleId} />
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="shift" value={shift} />
                <Button type="submit">Geldi</Button>
              </form>
            ) : null}
            {arrived && canWrite ? (
              <>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Düzenle
                </Button>
                <form action={unmarkArrivalAction}>
                  <input type="hidden" name="arrivalId" value={row.arrivalId ?? ""} />
                  <Button type="submit" variant="danger">
                    Geri al
                  </Button>
                </form>
              </>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  );
}
