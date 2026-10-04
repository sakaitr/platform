import { redirect } from "next/navigation";
import { EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { activePlanStops } from "@/modules/operasyon/plan/queries";
import { StopMap, type MapPoint } from "./stop-map";

export default async function OperasyonHaritasiPage() {
  const { session, can } = await pageContext("rota_planlama:read", "operasyon");
  if (!can("operasyon.rota_planlama")) redirect("/operasyon");

  const stops = await activePlanStops(session.tenantId);

  const points: MapPoint[] = stops
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => ({
      lat: Number(s.lat),
      lng: Number(s.lng),
      label: s.stopName,
      group: s.plate ?? s.routeName,
      order: s.position,
    }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Operasyon Haritası"
        description={`Aktif plandaki ${points.length} durak`}
      />

      <StopMap points={points} />

      <PageHeader title="Duraklar" />
      <Table head={["Rota", "Sıra", "Durak", "Yolcu", "Konum"]}>
        {stops.length === 0 ? (
          <EmptyRow colSpan={5} text="Aktif plan yok." />
        ) : (
          stops.map((s, i) => (
            <tr key={`${s.routeName}-${s.position}-${i}`} className="hover:bg-neutral-50">
              <Td className="font-medium">{s.plate ?? s.routeName}</Td>
              <Td>{s.position}</Td>
              <Td>{s.stopName}</Td>
              <Td className="text-neutral-500">{s.passengerCount}</Td>
              <Td>
                {s.lat && s.lng ? (
                  <a
                    href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-600 underline"
                  >
                    Haritada aç
                  </a>
                ) : (
                  "—"
                )}
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
