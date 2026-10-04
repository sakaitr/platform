import { Badge, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { listDrivers, vehicleOptions } from "@/modules/filo/queries";
import { saveDriverRecordAction } from "@/modules/isbirligi/actions";
import { listDriverRecords } from "@/modules/isbirligi/queries";

const SEVERITY_TONE: Record<number, string> = { 1: "mute", 2: "info", 3: "warn", 4: "warn", 5: "bad" };

export default async function SicilPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("suruculer:read", "filo");

  const driverId = one(params, "surucu");
  const [rows, suruculer, araclar] = await Promise.all([
    listDriverRecords(session.tenantId, driverId),
    listDrivers(session.tenantId, { scope: session.scope }),
    vehicleOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: "driverId",
      label: t("staff"),
      type: "select",
      required: true,
      options: suruculer.rows.map((d) => ({ value: d.id, label: d.fullName })),
    },
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    { name: "incidentDate", label: "Olay Tarihi", type: "date", required: true },
    { name: "category", label: "Kategori", type: "text", hint: "kaza, disiplin, şikâyet…" },
    { name: "severity", label: "Ağırlık (1-5)", type: "number" },
    { name: "description", label: "Açıklama", type: "textarea", required: true, wide: true },
    { name: "actionTaken", label: "Alınan Aksiyon", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("suruculer:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sürücü Sicili"
        description={`${rows.length} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={saveDriverRecordAction}
              fields={fields}
              values={{ incidentDate: istanbulDayKey(), severity: 1, category: "diger" }}
              openLabel="Sicil Kaydı"
            />
          ) : null
        }
      />

      <FilterBar action="/filo/sicil">
        <Field label={t("staff")}>
          <select name="surucu" defaultValue={driverId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {suruculer.rows.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Tarih", t("staff"), t("asset"), "Kategori", "Ağırlık", "Açıklama", "Aksiyon"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Sicil kaydı yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td>{formatDate(r.incidentDate)}</Td>
              <Td className="font-medium">{r.driverName}</Td>
              <Td className="text-neutral-500">{r.plate ?? "—"}</Td>
              <Td>{r.category}</Td>
              <Td>
                <Badge tone={SEVERITY_TONE[r.severity] ?? "mute"}>{r.severity}</Badge>
              </Td>
              <Td className="max-w-md truncate">{r.description}</Td>
              <Td className="max-w-xs truncate text-neutral-500">{r.actionTaken ?? "—"}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
