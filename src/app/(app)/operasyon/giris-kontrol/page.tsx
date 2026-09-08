import Link from "next/link";
import { Badge, Button, Card, EmptyRow, PageHeader, Table } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey, istanbulTime, shiftDay } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { markAllArrivalsAction } from "@/modules/operasyon/arrivals/actions";
import { arrivalBoard, boardSummary, listShifts, pickShift } from "@/modules/operasyon/arrivals/board";
import { ArrivalRow } from "./arrival-row";
import { PlateEntry } from "./plate-entry";

export default async function GirisKontrolPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("arrivals:read", "operasyon");

  const date = one(params, "tarih") ?? istanbulDayKey();
  const firmalar = await companyOptions(session.tenantId, session.scope);

  const companyId = one(params, "firma") ?? firmalar[0]?.id;
  const canWrite = session.permissions.has("arrivals:create");
  const canBulk = session.permissions.has("arrivals:bulk");

  const link = (next: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = { tarih: date, firma: companyId, vardiya: one(params, "vardiya"), ...next };
    for (const [k, v] of Object.entries(merged)) if (v) query.set(k, v);
    return `/operasyon/giris-kontrol?${query.toString()}`;
  };

  if (!companyId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Giriş Kontrol" description="Araç kabulü ve geliş kaydı" />
        <Card className="p-6 text-sm text-neutral-500">
          Önce {t("customer").toLocaleLowerCase("tr-TR")} tanımlayın.{" "}
          <Link href="/crm/firmalar" className="underline">
            {t("customer_plural")} sayfası
          </Link>
        </Card>
      </div>
    );
  }

  const shifts = await listShifts(session.tenantId, companyId);
  const nowMinutes = (() => {
    const [h, m] = istanbulTime().split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  })();
  // Vardiya seçilmediyse saate en yakın olan açılır.
  const shift = one(params, "vardiya") ?? pickShift(shifts, nowMinutes) ?? "sabah";

  const rows = await arrivalBoard(session.tenantId, { companyId, date, shift });
  const summary = boardSummary(rows);
  const pending = rows.filter((r) => r.arrivalId === null);
  const companyName = firmalar.find((f) => f.id === companyId)?.name ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Giriş Kontrol"
        description={`${companyName} · ${formatDate(date)} · ${shift}`}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Beklenen araç", value: summary.toplam },
          { label: "Gelen", value: summary.gelen },
          { label: "Bekleyen", value: summary.bekleyen, alert: summary.bekleyen > 0 },
          { label: "Geciken", value: summary.geciken, alert: summary.geciken > 0 },
        ].map((tile) => (
          <Card key={tile.label} className={`p-4 ${tile.alert ? "border-amber-300 bg-amber-50" : ""}`}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Link href={link({ tarih: shiftDay(date, -1) })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs">
          ← Önceki gün
        </Link>
        <Link href={link({ tarih: istanbulDayKey() })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs">
          Bugün
        </Link>
        <Link href={link({ tarih: shiftDay(date, 1) })} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs">
          Sonraki gün →
        </Link>

        <span className="mx-2 h-4 w-px bg-neutral-200" />

        <form method="get" action="/operasyon/giris-kontrol" className="flex items-center gap-2">
          <input type="hidden" name="tarih" value={date} />
          <select
            name="firma"
            defaultValue={companyId}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs"
          >
            {firmalar.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="ghost">
            Değiştir
          </Button>
        </form>
      </Card>

      {shifts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {shifts.map((s) => (
            <Link
              key={s.id}
              href={link({ vardiya: s.name })}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                s.name === shift
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {s.name} <span className="opacity-60">{s.expectedAt}</span>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Bu {t("customer").toLocaleLowerCase("tr-TR")} için vardiya tanımlı değil; gecikme
          hesaplanamıyor.{" "}
          <Link href="/operasyon/vardiyalar" className="underline">
            Vardiya tanımla
          </Link>
        </Card>
      )}

      {canWrite ? <PlateEntry rows={rows} companyId={companyId} date={date} shift={shift} /> : null}

      {canBulk && pending.length > 0 ? (
        <form action={markAllArrivalsAction}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="shift" value={shift} />
          {pending.map((r) => (
            <input key={r.vehicleId} type="hidden" name="vehicleIds" value={r.vehicleId} />
          ))}
          <Button type="submit" variant="ghost">
            Tümü geldi ({pending.length})
          </Button>
        </form>
      ) : null}

      <Table
        head={["Sıra", t("asset"), t("staff"), "Planlanan", "Geliş", "Durum", "Yolcu", ""]}
      >
        {rows.length === 0 ? (
          <EmptyRow
            colSpan={8}
            text={`Bu ${t("customer").toLocaleLowerCase("tr-TR")} için aktif araç yok.`}
          />
        ) : (
          rows.map((row) => (
            <ArrivalRow
              key={row.vehicleId}
              row={row}
              companyId={companyId}
              date={date}
              shift={shift}
              canWrite={canWrite}
            />
          ))
        )}
      </Table>

      {rows.length > 0 ? (
        <p className="text-xs text-neutral-500">
          Liste firmanın aktif araçlarıdır. Sarı satırlar henüz gelmemiş araçları gösterir.{" "}
          <Badge tone="ok">Zamanında</Badge> eşiği vardiyanın gecikme toleransıdır.
        </p>
      ) : null}
    </div>
  );
}
