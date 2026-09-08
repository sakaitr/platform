import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDateTime, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { checkoutVisitorAction, saveVisitorAction } from "@/modules/operasyon/ziyaretci/actions";
import { listVisitors } from "@/modules/operasyon/ziyaretci/queries";

export default async function ZiyaretcilerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("ziyaretci:read", "operasyon");

  const day = one(params, "tarih") ?? istanbulDayKey();
  const [rows, firmalar] = await Promise.all([
    listVisitors(session.tenantId, day),
    companyOptions(session.tenantId, session.scope),
  ]);
  const inside = rows.filter((r) => r.exitedAt === null);

  const fields: readonly FieldSpec[] = [
    { name: "visitorName", label: "Ziyaretçi", type: "text", required: true },
    { name: "hostName", label: "Kime Geldi", type: "text", required: true },
    { name: "reason", label: "Geliş Sebebi", type: "text", required: true, wide: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "plate", label: "Plaka", type: "text" },
  ];

  const canWrite = session.permissions.has("ziyaretci:create");
  const canCheckout = session.permissions.has("ziyaretci:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ziyaretçiler"
        description={`${inside.length} kişi içeride`}
        action={
          canWrite ? (
            <EntityForm action={saveVisitorAction} fields={fields} openLabel="Giriş Kaydet" />
          ) : null
        }
      />

      <Table head={["Ziyaretçi", "Kime", "Sebep", t("customer"), "Plaka", "Giriş", "Çıkış", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Kayıt yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className={r.exitedAt ? "hover:bg-neutral-50" : "bg-amber-50/40"}>
              <Td className="font-medium">{r.visitorName}</Td>
              <Td>{r.hostName}</Td>
              <Td className="max-w-xs truncate text-neutral-500">{r.reason}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.plate ?? "—"}</Td>
              <Td>{formatDateTime(r.enteredAt)}</Td>
              <Td>
                {r.exitedAt ? (
                  formatDateTime(r.exitedAt)
                ) : (
                  <Badge tone="warn">içeride</Badge>
                )}
              </Td>
              <Td>
                {!r.exitedAt && canCheckout ? (
                  <form action={checkoutVisitorAction} className="flex justify-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost">
                      Çıkış Ver
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
