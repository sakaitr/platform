import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import {
  generatePlanAction,
  setPlanStatusAction,
} from "@/modules/operasyon/plan/actions";
import {
  getRoutePlan,
  planRoutesWithStops,
  ungeocodedCount,
} from "@/modules/operasyon/plan/queries";
import { PLAN_STATUS, PLAN_TONE } from "../page";

const FLOW: Record<string, readonly string[]> = {
  taslak: ["yayinlandi", "arsiv"],
  yayinlandi: ["aktif", "arsiv"],
  aktif: ["arsiv"],
  arsiv: [],
};

function km(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

export default async function PlanDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, can } = await pageContext("rota_planlama:read", "operasyon");
  if (!can("operasyon.rota_planlama")) redirect("/operasyon");

  const plan = await getRoutePlan(session.tenantId, id);
  if (!plan) notFound();

  const [routes, missing] = await Promise.all([
    planRoutesWithStops(session.tenantId, id),
    ungeocodedCount(session.tenantId, plan.companyId),
  ]);

  const metrics = (plan.metrics ?? {}) as Record<string, number>;
  const canGenerate = session.permissions.has("rota_planlama:update") && plan.status === "taslak";
  const canPublish = session.permissions.has("rota_planlama:publish");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${plan.name} · v${plan.versionNo}`}
        description={[plan.shiftName, plan.direction].filter(Boolean).join(" · ")}
        action={<Badge tone={PLAN_TONE[plan.status]}>{PLAN_STATUS[plan.status]}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Araç", value: metrics.aracSayisi ?? 0 },
          { label: "Yolcu", value: metrics.yolcuSayisi ?? 0 },
          { label: "Toplam", value: metrics.toplamMetre ? km(metrics.toplamMetre) : "—" },
          { label: "Yerleşmeyen", value: metrics.yerlesmeyen ?? 0 },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
          </Card>
        ))}
      </div>

      {missing > 0 ? (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {missing} yolcunun biniş koordinatı yok; planlamaya girmezler. Yolcu kaydında
          biniş adresinin enlem/boylamı doldurulmalı.
        </Card>
      ) : null}

      {canGenerate ? (
        <Card className="p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Rotaları üret</p>
          <form action={generatePlanAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="planId" value={id} />
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Varış Enlem</span>
              <input name="depotLat" required placeholder="40.8000000" className={inputClass} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Varış Boylam</span>
              <input name="depotLng" required placeholder="29.4000000" className={inputClass} />
            </label>
            <Button type="submit">Üret</Button>
          </form>
          <p className="mt-2 text-xs text-neutral-500">
            Araçlar kapasitelerine göre doldurulur, duraklar en kısa tur olacak şekilde sıralanır.
            Üretim mevcut rotaların üzerine yazar.
          </p>
        </Card>
      ) : null}

      {canPublish && FLOW[plan.status]!.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Durum</p>
          <div className="flex flex-wrap gap-2">
            {FLOW[plan.status]!.map((next) => (
              <form key={next} action={setPlanStatusAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={next} />
                <Button type="submit" variant={next === "arsiv" ? "ghost" : "primary"}>
                  {PLAN_STATUS[next]}
                </Button>
              </form>
            ))}
          </div>
          {plan.status === "yayinlandi" ? (
            <p className="mt-2 text-xs text-neutral-500">
              Aktifleştirildiğinde önceki aktif plan arşive düşer.
            </p>
          ) : null}
        </Card>
      ) : null}

      {routes.length === 0 ? (
        <Card className="p-6 text-sm text-neutral-500">
          Henüz rota üretilmemiş.
        </Card>
      ) : (
        routes.map((route) => {
          const routeMetrics = (route.metrics ?? {}) as Record<string, number>;
          return (
            <div key={route.id} className="space-y-2">
              <PageHeader
                title={route.plate ?? route.name}
                description={`${route.stops.length} durak · ${routeMetrics.mesafeMetre ? km(routeMetrics.mesafeMetre) : "—"}${
                  route.capacity ? ` · kapasite ${route.capacity}` : ""
                }`}
              />
              <Table head={["Sıra", "Durak", "Enlem", "Boylam", "Yolcu"]}>
                {route.stops.length === 0 ? (
                  <EmptyRow colSpan={5} />
                ) : (
                  route.stops.map((stop) => (
                    <tr key={stop.id} className="hover:bg-neutral-50">
                      <Td className="font-medium">{stop.position}</Td>
                      <Td>{stop.name}</Td>
                      <Td className="text-neutral-500">{stop.lat ?? "—"}</Td>
                      <Td className="text-neutral-500">{stop.lng ?? "—"}</Td>
                      <Td>{stop.passengerCount}</Td>
                    </tr>
                  ))
                )}
              </Table>
            </div>
          );
        })
      )}
    </div>
  );
}
