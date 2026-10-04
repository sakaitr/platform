import { Badge, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { listDrivers, vehicleOptions } from "@/modules/filo/queries";
import { saveDriverEvaluationAction } from "@/modules/isbirligi/actions";
import { listDriverEvaluations } from "@/modules/isbirligi/queries";

const SCORES = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

export default async function DegerlendirmePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("suruculer:read", "filo");

  const driverId = one(params, "surucu");
  const [rows, suruculer, araclar, firmalar] = await Promise.all([
    listDriverEvaluations(session.tenantId, driverId),
    listDrivers(session.tenantId, { scope: session.scope }),
    vehicleOptions(session.tenantId, session.scope),
    companyOptions(session.tenantId, session.scope),
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
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "evaluationDate", label: "Tarih", type: "date", required: true },
    { name: "punctuality", label: "Dakiklik", type: "select", options: SCORES },
    { name: "driving", label: "Sürüş", type: "select", options: SCORES },
    { name: "communication", label: "İletişim", type: "select", options: SCORES },
    { name: "cleanliness", label: "Temizlik", type: "select", options: SCORES },
    { name: "routeCompliance", label: "Güzergaha Uyum", type: "select", options: SCORES },
    { name: "appearance", label: "Görünüm", type: "select", options: SCORES },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("suruculer:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Şoför Değerlendirme"
        description="Altı başlıkta 1-5 puan; ortalama otomatik hesaplanır"
        action={
          canWrite ? (
            <EntityForm
              action={saveDriverEvaluationAction}
              fields={fields}
              values={{
                evaluationDate: istanbulDayKey(),
                punctuality: 3,
                driving: 3,
                communication: 3,
                cleanliness: 3,
                routeCompliance: 3,
                appearance: 3,
              }}
              openLabel="Değerlendir"
            />
          ) : null
        }
      />

      <FilterBar action="/filo/degerlendirme">
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

      <Table
        head={["Tarih", t("staff"), t("asset"), "Dakiklik", "Sürüş", "İletişim", "Temizlik", "Uyum", "Görünüm", "Ortalama"]}
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={10} text="Değerlendirme yok." />
        ) : (
          rows.map((r) => {
            const avg = Number(r.ortalama);
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td>{formatDate(r.evaluationDate)}</Td>
                <Td className="font-medium">{r.driverName}</Td>
                <Td className="text-neutral-500">{r.plate ?? "—"}</Td>
                <Td>{r.punctuality}</Td>
                <Td>{r.driving}</Td>
                <Td>{r.communication}</Td>
                <Td>{r.cleanliness}</Td>
                <Td>{r.routeCompliance}</Td>
                <Td>{r.appearance}</Td>
                <Td>
                  <Badge tone={avg >= 4 ? "ok" : avg >= 3 ? "warn" : "bad"}>{r.ortalama}</Badge>
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
