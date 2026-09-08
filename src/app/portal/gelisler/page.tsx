import { Badge, EmptyRow, Table, Td } from "@/components/ui";
import { requirePortal } from "@/lib/portal/guards";
import { formatDate, istanbulDayKey, shiftDay } from "@/lib/time";
import { delayMinutes } from "@/modules/operasyon/arrivals/queries";
import { portalArrivals } from "@/modules/portal/queries";

export default async function PortalGelislerPage() {
  const session = await requirePortal();
  const from = shiftDay(istanbulDayKey(), -30);
  const rows = await portalArrivals(session, from);

  const late = rows.filter((r) => (delayMinutes(r.plannedAt, r.arrivedAt) ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Servis Gelişleri</h1>
        <p className="text-sm text-neutral-500">
          Son 30 gün · {rows.length} geliş{late > 0 ? ` · ${late} gecikme` : ""}
        </p>
      </div>

      <Table head={["Tarih", "Araç", "Vardiya", "Geliş", "Planlanan", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Bu dönemde geliş kaydı yok." />
        ) : (
          rows.map((r) => {
            const delay = delayMinutes(r.plannedAt, r.arrivedAt);
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td>{formatDate(r.arrivalDate)}</Td>
                <Td className="font-medium">{r.plate}</Td>
                <Td>{r.shift}</Td>
                <Td className="font-medium">{r.arrivedAt}</Td>
                <Td className="text-neutral-500">{r.plannedAt ?? "—"}</Td>
                <Td>
                  {delay === null ? (
                    <span className="text-neutral-400">—</span>
                  ) : delay > 0 ? (
                    <Badge tone="bad">{delay} dk geç</Badge>
                  ) : (
                    <Badge tone="ok">zamanında</Badge>
                  )}
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
