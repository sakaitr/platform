import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  EmptyRow,
  Field,
  FilterBar,
  PageHeader,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey, shiftDay } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import {
  approveTripLogsAction,
  deleteTripLogAction,
  saveTripLogAction,
} from "@/modules/operasyon/cetele/actions";
import { getTripLog, listTripLogs, tripLogSummary } from "@/modules/operasyon/cetele/queries";
import { routeOptions } from "@/modules/operasyon/guzergah/queries";
import { RevertForm } from "./revert-form";

const STATUS = [
  { value: "bekliyor", label: "Bekliyor" },
  { value: "onaylandi", label: "Onaylandı" },
  { value: "iptal", label: "İptal" },
] as const;

const TONE: Record<string, string> = { bekliyor: "warn", onaylandi: "ok", iptal: "mute" };

const DIRECTIONS = [
  { value: "giris", label: "Giriş" },
  { value: "cikis", label: "Çıkış" },
] as const;

export default async function CetelePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("cetele:read", "operasyon");
  if (!can("operasyon.cetele")) redirect("/operasyon");

  const today = istanbulDayKey();
  const filter = {
    from: one(params, "baslangic") ?? shiftDay(today, -7),
    to: one(params, "bitis") ?? today,
    companyId: one(params, "firma"),
    vehicleId: one(params, "arac"),
    status: one(params, "durum"),
    scope: session.scope,
  };

  const [rows, summary, firmalar, araclar, guzergahlar] = await Promise.all([
    listTripLogs(session.tenantId, filter),
    tripLogSummary(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
    routeOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getTripLog(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      required: true,
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    {
      name: "routeId",
      label: "Güzergah",
      type: "select",
      options: guzergahlar.map((r) => ({ value: r.id, label: r.name })),
    },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "logDate", label: "Tarih", type: "date", required: true },
    { name: "tripType", label: "Hareket Tipi", type: "text", required: true, hint: "sabah, akşam, ring, transfer…" },
    { name: "direction", label: "Yön", type: "select", options: DIRECTIONS },
    { name: "passengerCount", label: "Yolcu Sayısı", type: "number" },
    { name: "notes", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("cetele:create");
  const canApprove = session.permissions.has("cetele:approve");
  const canDelete = session.permissions.has("cetele:delete");
  const pending = rows.filter((r) => r.status === "bekliyor");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Çetele"
        description={`${formatDate(filter.from)} – ${formatDate(filter.to)} · hakedişin dayanağı`}
        action={
          canWrite ? (
            <EntityForm
              action={saveTripLogAction}
              fields={fields}
              values={editing ?? { logDate: today, tripType: "sabah" }}
              idValue={editing?.id}
              openLabel="Yeni Kayıt"
            />
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Bekleyen", value: summary.bekliyor },
          { label: "Onaylı", value: summary.onaylandi },
          { label: "İptal", value: summary.iptal },
          { label: "Toplam yolcu", value: summary.toplamYolcu },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
          </Card>
        ))}
      </div>

      <FilterBar action="/operasyon/cetele">
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={filter.from} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={filter.to} className={inputClass} />
        </Field>
        <Field label={t("customer")}>
          <select name="firma" defaultValue={filter.companyId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {firmalar.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("asset")}>
          <select name="arac" defaultValue={filter.vehicleId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {araclar.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <form action={approveTripLogsAction} className="space-y-3">
        <Table
          head={[
            canApprove ? "" : " ",
            "Tarih",
            t("asset"),
            "Güzergah",
            t("customer"),
            "Hareket",
            "Yolcu",
            "Durum",
            "",
          ]}
        >
          {rows.length === 0 ? (
            <EmptyRow colSpan={9} text="Bu aralıkta kayıt yok." />
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td>
                  {canApprove && r.status === "bekliyor" ? (
                    <input type="checkbox" name="ids" value={r.id} />
                  ) : null}
                </Td>
                <Td>{formatDate(r.logDate)}</Td>
                <Td className="font-medium">{r.plate}</Td>
                <Td className="text-neutral-500">{r.routeName ?? "—"}</Td>
                <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
                <Td>
                  {r.tripType}
                  {r.direction ? <span className="ml-1 text-xs text-neutral-400">{r.direction}</span> : null}
                </Td>
                <Td>{r.passengerCount ?? "—"}</Td>
                <Td>
                  <Badge tone={TONE[r.status]}>{STATUS.find((s) => s.value === r.status)?.label}</Badge>
                  {r.revertReason ? (
                    <span className="ml-2 text-xs text-neutral-400">{r.revertReason}</span>
                  ) : null}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {r.status === "bekliyor" && canWrite ? (
                      <a
                        href={`/operasyon/cetele?duzenle=${r.id}`}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                      >
                        Düzenle
                      </a>
                    ) : null}
                    {r.status === "onaylandi" && canApprove ? <RevertForm id={r.id} /> : null}
                    {r.status === "bekliyor" && canDelete ? (
                      <button
                        type="submit"
                        formAction={deleteTripLogAction}
                        name="id"
                        value={r.id}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Sil
                      </button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </Table>

        {canApprove && pending.length > 0 ? (
          <Button type="submit">Seçilenleri Onayla</Button>
        ) : null}
      </form>
    </div>
  );
}
