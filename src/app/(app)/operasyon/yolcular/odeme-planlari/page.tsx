import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { pageContext } from "@/lib/page-context";
import { savePaymentPlanAction } from "@/modules/operasyon/yolcular/actions";
import { listPaymentPlans } from "@/modules/operasyon/yolcular/queries";

const FIELDS: readonly FieldSpec[] = [
  { name: "name", label: "Plan Adı", type: "text", required: true },
  { name: "totalAmount", label: "Toplam Tutar (₺)", type: "text" },
  { name: "installments", label: "Taksit Sayısı", type: "number" },
  { name: "notes", label: "Açıklama", type: "textarea", wide: true },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function OdemePlanlariPage() {
  const { session } = await pageContext("yolcular:read", "operasyon");
  const rows = await listPaymentPlans(session.tenantId);
  const canWrite = session.permissions.has("yolcular:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ödeme Planları"
        description="Yolcu kaydında seçilen taksit planları"
        action={
          canWrite ? (
            <EntityForm
              action={savePaymentPlanAction}
              fields={FIELDS}
              values={{ isActive: true }}
              openLabel="Yeni Plan"
            />
          ) : null
        }
      />

      <Table head={["Plan", "Toplam", "Taksit", "Taksit Tutarı", "Açıklama", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Plan tanımlanmamış." />
        ) : (
          rows.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{p.name}</Td>
              <Td>{p.totalAmount ? formatTRY(p.totalAmount) : "—"}</Td>
              <Td className="text-neutral-500">{p.installments ?? "—"}</Td>
              <Td className="text-neutral-500">
                {p.totalAmount && p.installments
                  ? formatTRY(String(Number(p.totalAmount) / p.installments))
                  : "—"}
              </Td>
              <Td className="max-w-xs truncate text-neutral-500">{p.notes ?? "—"}</Td>
              <Td>
                <Badge tone={p.isActive ? "ok" : "mute"}>{p.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
