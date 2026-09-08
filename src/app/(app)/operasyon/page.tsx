import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { arrivalCount } from "@/modules/operasyon/arrivals/queries";
import { listPassengers } from "@/modules/operasyon/yolcular/queries";
import { listVisitors } from "@/modules/operasyon/ziyaretci/queries";

export default async function OperasyonPage() {
  const { session, t } = await pageContext("arrivals:read", "operasyon");
  const today = istanbulDayKey();

  const [gelisler, yolcular, ziyaretciler] = await Promise.all([
    arrivalCount(session.tenantId, today),
    listPassengers(session.tenantId, { scope: session.scope, durum: "aktif" }),
    session.permissions.has("ziyaretci:read")
      ? listVisitors(session.tenantId, today)
      : Promise.resolve([]),
  ]);

  const tiles = [
    { label: "Bugünkü geliş", value: gelisler, href: "/operasyon/giris-kontrol" },
    { label: "Aktif yolcu", value: yolcular.total, href: "/operasyon/yolcular" },
    {
      label: "İçerideki ziyaretçi",
      value: ziyaretciler.filter((v) => v.exitedAt === null).length,
      href: "/operasyon/ziyaretciler",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("module.operasyon") === "module.operasyon" ? "Operasyon" : t("module.operasyon")} description={formatDate(today)} />

      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href}>
            <Card className="p-5 transition hover:border-neutral-400">
              <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
              <p className="mt-1 text-3xl font-semibold">{tile.value}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
