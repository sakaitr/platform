import Link from "next/link";
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
import { formatDate, istanbulDayKey, istanbulTime, shiftDay } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { deleteArrivalAction, saveArrivalAction } from "@/modules/operasyon/arrivals/actions";
import { delayMinutes, listArrivals, shiftsOnDate } from "@/modules/operasyon/arrivals/queries";

export default async function GirisKontrolPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("arrivals:read");

  const date = one(params, "tarih") ?? istanbulDayKey();
  const filter = {
    date,
    companyId: one(params, "firma"),
    shift: one(params, "vardiya"),
    scope: session.scope,
  };

  const [rows, firmalar, araclar, shifts] = await Promise.all([
    listArrivals(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
    shiftsOnDate(session.tenantId, date),
  ]);

  const late = rows.filter((r) => (delayMinutes(r.plannedAt, r.arrivedAt) ?? 0) > 0).length;

  const fields: readonly FieldSpec[] = [
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      required: true,
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "arrivalDate", label: "Tarih", type: "date", required: true },
    { name: "shift", label: "Vardiya", type: "text", required: true, hint: "sabah, akşam, 08-16…" },
    { name: "arrivedAt", label: "Geliş Saati", type: "time", required: true },
    { name: "plannedAt", label: "Planlanan Saat", type: "time", hint: "Doluysa gecikme hesaplanır" },
    { name: "note", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("arrivals:create");
  const canDelete = session.permissions.has("arrivals:delete");
  const linkFor = (d: string): string => `/operasyon/giris-kontrol?tarih=${d}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Giriş Kontrol"
        description={`${formatDate(date)} · ${rows.length} geliş${late > 0 ? ` · ${late} gecikme` : ""}`}
        action={
          canWrite ? (
            <EntityForm
              action={saveArrivalAction}
              fields={fields}
              values={{ arrivalDate: date, shift: "sabah", arrivedAt: istanbulTime() }}
              openLabel="Geliş Kaydet"
            />
          ) : null
        }
      />

      <Card className="flex flex-wrap items-center gap-2 p-3 text-xs">
        <Link href={linkFor(shiftDay(date, -1))} className="rounded-lg border border-neutral-300 px-3 py-1.5">
          ← Önceki gün
        </Link>
        <Link href={linkFor(istanbulDayKey())} className="rounded-lg border border-neutral-300 px-3 py-1.5">
          Bugün
        </Link>
        <Link href={linkFor(shiftDay(date, 1))} className="rounded-lg border border-neutral-300 px-3 py-1.5">
          Sonraki gün →
        </Link>
      </Card>

      <FilterBar action="/operasyon/giris-kontrol">
        <Field label="Tarih">
          <input type="date" name="tarih" defaultValue={date} className={inputClass} />
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
        <Field label="Vardiya">
          <select name="vardiya" defaultValue={filter.shift ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {shifts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={[t("asset"), t("customer"), "Vardiya", "Geliş", "Planlanan", "Durum", "Not", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Bu tarihte geliş kaydı yok." />
        ) : (
          rows.map((r) => {
            const delay = delayMinutes(r.plannedAt, r.arrivedAt);
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="font-medium">{r.plate}</Td>
                <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
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
                <Td className="max-w-xs truncate text-neutral-500">{r.note ?? "—"}</Td>
                <Td>
                  {canDelete ? (
                    <form action={deleteArrivalAction} className="flex justify-end">
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
