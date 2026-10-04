import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { companyOptions } from "@/modules/crm/queries";
import { deleteFuelCardAction, saveFuelCardAction } from "@/modules/filo/actions";
import { getFuelCard, listFuelCards, vehicleOptions } from "@/modules/filo/queries";

const LIMITS = [
  { value: "sinirsiz", label: "Sınırsız" },
  { value: "miktar", label: "Litre limiti" },
  { value: "tutar", label: "Tutar limiti" },
] as const;

export default async function YakitKartlariPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("yakit_kartlari:read", "filo");

  const [rows, araclar, firmalar] = await Promise.all([
    listFuelCards(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
    companyOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getFuelCard(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "cardNo", label: "Kart No", type: "text", required: true },
    { name: "provider", label: "Sağlayıcı", type: "text", hint: "OPET, Shell, BP…" },
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
    { name: "limitKind", label: "Limit Tipi", type: "select", options: LIMITS },
    { name: "limitValue", label: "Limit Değeri", type: "text" },
    { name: "notes", label: "Not", type: "textarea", wide: true },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  const canWrite = session.permissions.has("yakit_kartlari:create");
  const canDelete = session.permissions.has("yakit_kartlari:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Yakıt Kartları"
        description={`${rows.length} kart`}
        action={
          canWrite ? (
            <EntityForm
              action={saveFuelCardAction}
              fields={fields}
              values={editing ?? { isActive: true, limitKind: "sinirsiz" }}
              idValue={editing?.id}
              openLabel="Yeni Kart"
            />
          ) : null
        }
      />

      <Table head={["Kart No", "Sağlayıcı", t("asset"), t("customer"), "Limit", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} />
        ) : (
          rows.map((c) => (
            <tr key={c.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{c.cardNo}</Td>
              <Td className="text-neutral-500">{c.provider ?? "—"}</Td>
              <Td>{c.plate ?? <span className="text-neutral-400">atanmadı</span>}</Td>
              <Td className="text-neutral-500">{c.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">
                {c.limitKind === "sinirsiz"
                  ? "Sınırsız"
                  : `${c.limitValue ?? "—"} ${c.limitKind === "miktar" ? "L" : "₺"}`}
              </Td>
              <Td>
                <Badge tone={c.isActive ? "ok" : "mute"}>{c.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/filo/yakit-kartlari?duzenle=${c.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteFuelCardAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
