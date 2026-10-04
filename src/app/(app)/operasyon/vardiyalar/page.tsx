import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { companyOptions } from "@/modules/crm/queries";
import { deleteShiftAction, saveShiftAction } from "@/modules/operasyon/guzergah/actions";
import { listAllShifts } from "@/modules/operasyon/guzergah/queries";

export default async function VardiyalarPage() {
  const { session, t } = await pageContext("arrivals:read", "operasyon");

  const [rows, firmalar] = await Promise.all([
    listAllShifts(session.tenantId, session.scope),
    companyOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      required: true,
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "name", label: "Vardiya Adı", type: "text", required: true, hint: "sabah, akşam, 08-16…" },
    { name: "expectedAt", label: "Beklenen Saat", type: "time", required: true },
    { name: "toleranceLate", label: "Gecikme Toleransı (dk)", type: "number" },
    { name: "toleranceEarly", label: "Erken Gelme Toleransı (dk)", type: "number" },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  const canWrite = session.permissions.has("arrivals:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vardiyalar"
        description="Giriş kontroldeki planlanan saat ve gecikme eşiği buradan gelir"
        action={
          canWrite ? (
            <EntityForm
              action={saveShiftAction}
              fields={fields}
              values={{ isActive: true, toleranceLate: 10, toleranceEarly: 15 }}
              openLabel="Yeni Vardiya"
            />
          ) : null
        }
      />

      <Table head={[t("customer"), "Vardiya", "Beklenen", "Gecikme Tol.", "Erken Tol.", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Vardiya tanımlanmamış." />
        ) : (
          rows.map((s) => (
            <tr key={s.id} className="hover:bg-neutral-50">
              <Td className="text-neutral-500">{s.companyName}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td>{s.expectedAt}</Td>
              <Td className="text-neutral-500">{s.toleranceLate} dk</Td>
              <Td className="text-neutral-500">{s.toleranceEarly} dk</Td>
              <Td>
                <Badge tone={s.isActive ? "ok" : "mute"}>{s.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                {canWrite ? (
                  <form action={deleteShiftAction} className="flex justify-end">
                    <input type="hidden" name="id" value={s.id} />
                    <Button type="submit" variant="danger">
                      Sil
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
