import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, isExpiringSoon } from "@/lib/time";
import { listDrivers, vehicleOptions } from "@/modules/filo/queries";
import { completeWarningAction, saveWarningAction } from "@/modules/isbirligi/actions";
import { listWarnings } from "@/modules/isbirligi/queries";

export default async function UyarilarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("suruculer:read", "filo");

  const durum = one(params, "durum");
  const done = durum === "tamam" ? true : durum === "acik" ? false : undefined;
  const [rows, araclar, suruculer] = await Promise.all([
    listWarnings(session.tenantId, done),
    vehicleOptions(session.tenantId, session.scope),
    listDrivers(session.tenantId, { scope: session.scope, status: "aktif" }),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    {
      name: "driverId",
      label: t("staff"),
      type: "select",
      options: suruculer.rows.map((d) => ({ value: d.id, label: d.fullName })),
    },
    { name: "deadline", label: "Son Tarih", type: "date" },
    { name: "reason", label: "Gerekçe", type: "textarea", required: true, wide: true },
  ];

  const canWrite = session.permissions.has("suruculer:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Uyarı Tutanakları"
        description={`${rows.filter((r) => !r.isDone).length} açık uyarı`}
        action={
          canWrite ? (
            <EntityForm action={saveWarningAction} fields={fields} openLabel="Yeni Uyarı" />
          ) : null
        }
      />

      <FilterBar action="/filo/uyarilar">
        <Field label="Durum">
          <select name="durum" defaultValue={durum ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="acik">Açık</option>
            <option value="tamam">Kapanmış</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["No", t("asset"), t("staff"), "Gerekçe", "Son Tarih", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Uyarı yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.documentNo ?? "—"}</Td>
              <Td>{r.plate ?? "—"}</Td>
              <Td className="text-neutral-500">{r.driverName ?? "—"}</Td>
              <Td className="max-w-md truncate">{r.reason}</Td>
              <Td>
                {r.deadline ? (
                  !r.isDone && isExpiringSoon(r.deadline, 0) ? (
                    <Badge tone="bad">{formatDate(r.deadline)}</Badge>
                  ) : (
                    formatDate(r.deadline)
                  )
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Badge tone={r.isDone ? "ok" : "warn"}>{r.isDone ? "Kapandı" : "Açık"}</Badge>
              </Td>
              <Td>
                {!r.isDone && canWrite ? (
                  <form action={completeWarningAction} className="flex justify-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost">
                      Kapat
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
