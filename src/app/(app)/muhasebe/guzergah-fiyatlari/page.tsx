import { Badge, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { routeOptions } from "@/modules/operasyon/guzergah/queries";
import { saveRoutePriceAction } from "@/modules/muhasebe/actions";
import { listRoutePrices } from "@/modules/muhasebe/queries";

export default async function GuzergahFiyatlariPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("hakedis:read", "muhasebe");

  const routeId = one(params, "guzergah");
  const [rows, guzergahlar, firmalar] = await Promise.all([
    listRoutePrices(session.tenantId, routeId),
    routeOptions(session.tenantId, session.scope),
    companyOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: "routeId",
      label: "Güzergah",
      type: "select",
      required: true,
      options: guzergahlar.map((r) => ({ value: r.id, label: r.name })),
    },
    {
      name: "companyId",
      label: `${t("customer")} (satış)`,
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    {
      name: "supplierId",
      label: "Tedarikçi (alış)",
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "price", label: "Fiyat (₺)", type: "text", required: true },
    { name: "validFrom", label: "Geçerlilik Başlangıcı", type: "date", required: true },
  ];

  const canWrite = session.permissions.has("hakedis:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Güzergah Fiyatları"
        description="Dönemsel fiyat; yeni fiyat girilince öncekinin geçerliliği kapanır"
        action={
          canWrite ? (
            <EntityForm
              action={saveRoutePriceAction}
              fields={fields}
              values={{ validFrom: istanbulDayKey() }}
              openLabel="Yeni Fiyat"
            />
          ) : null
        }
      />

      <FilterBar action="/muhasebe/guzergah-fiyatlari">
        <Field label="Güzergah">
          <select name="guzergah" defaultValue={routeId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {guzergahlar.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Güzergah", t("customer"), "Tedarikçi", "Fiyat", "Başlangıç", "Bitiş"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Fiyat tanımlanmamış." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className={r.validTo === null ? "bg-emerald-50/40" : "hover:bg-neutral-50"}>
              <Td className="font-medium">{r.routeName}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.supplierName ?? "—"}</Td>
              <Td>{formatTRY(r.price)}</Td>
              <Td>{formatDate(r.validFrom)}</Td>
              <Td>{r.validTo ? formatDate(r.validTo) : <Badge tone="ok">güncel</Badge>}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
