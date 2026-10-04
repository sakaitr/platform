import { redirect } from "next/navigation";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { pageContext } from "@/lib/page-context";
import { savePricingFormAction } from "@/modules/muhasebe/actions";
import { listPricingForms } from "@/modules/muhasebe/queries";

const FIELDS: readonly FieldSpec[] = [
  { name: "name", label: "Form Adı", type: "text", required: true },
  { name: "groupName", label: "Grup", type: "text" },
  { name: "unitPrice", label: "Sefer Başı Ücret (₺)", type: "text" },
  { name: "vatRate", label: "KDV Oranı (%)", type: "text" },
  { name: "withholdingRate", label: "Tevkifat Oranı (%)", type: "text", hint: "KDV'nin yüzde kaçı" },
  { name: "notes", label: "Not", type: "textarea", wide: true },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function UcretlendirmePage() {
  const { session, can } = await pageContext("hakedis:read", "muhasebe");
  if (!can("muhasebe.hakedis")) redirect("/muhasebe/hareketler");

  const rows = await listPricingForms(session.tenantId);
  const canWrite = session.permissions.has("hakedis:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ücretlendirme Formları"
        description="Hakediş hesabının tarifesi"
        action={
          canWrite ? (
            <EntityForm
              action={savePricingFormAction}
              fields={FIELDS}
              values={{ isActive: true, vatRate: "20", withholdingRate: "0" }}
              openLabel="Yeni Form"
            />
          ) : null
        }
      />

      <Table head={["Form", "Grup", "Birim Ücret", "KDV", "Tevkifat", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Form tanımlanmamış." />
        ) : (
          rows.map((f) => (
            <tr key={f.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{f.name}</Td>
              <Td className="text-neutral-500">{f.groupName ?? "—"}</Td>
              <Td>{f.unitPrice ? formatTRY(f.unitPrice) : "—"}</Td>
              <Td className="text-neutral-500">%{f.vatRate}</Td>
              <Td className="text-neutral-500">%{f.withholdingRate}</Td>
              <Td>
                <Badge tone={f.isActive ? "ok" : "mute"}>{f.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
