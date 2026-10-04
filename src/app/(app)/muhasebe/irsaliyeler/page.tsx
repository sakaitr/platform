import { redirect } from "next/navigation";
import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatQuantity } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { deleteDeliveryNoteAction, saveDeliveryNoteAction } from "@/modules/muhasebe/actions";
import { getDeliveryNote, listDeliveryNotes } from "@/modules/muhasebe/queries";

const STATUS = [
  { value: "taslak", label: "Taslak" },
  { value: "sevk_edildi", label: "Sevk edildi" },
  { value: "teslim_edildi", label: "Teslim edildi" },
  { value: "iptal", label: "İptal" },
] as const;

const TONE: Record<string, string> = {
  taslak: "mute",
  sevk_edildi: "warn",
  teslim_edildi: "ok",
  iptal: "bad",
};

export default async function IrsaliyelerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("cari:read", "muhasebe");
  // İrsaliye lojistikte var, turizmde yok — sektör paketi karar verir.
  if (!can("muhasebe.irsaliye")) redirect("/muhasebe/hareketler");

  const status = one(params, "durum");
  const [rows, firmalar, araclar] = await Promise.all([
    listDeliveryNotes(session.tenantId, { status, scope: session.scope }),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getDeliveryNote(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    { name: "issueDate", label: "Düzenleme Tarihi", type: "date", required: true },
    { name: "shipDate", label: "Sevk Tarihi", type: "date" },
    { name: "fromAddress", label: "Çıkış Adresi", type: "textarea", wide: true },
    { name: "toAddress", label: "Varış Adresi", type: "textarea", wide: true },
    { name: "description", label: "Malın Cinsi", type: "textarea", wide: true },
    { name: "quantity", label: "Miktar", type: "text" },
    { name: "unit", label: "Birim", type: "text", hint: "adet, kg, koli…" },
    { name: "status", label: "Durum", type: "select", options: STATUS },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("cari:create");

  return (
    <div className="space-y-4">
      <PageHeader
        title="İrsaliyeler"
        description="Malın fiziksel sevkini belgeler; numara otomatik verilir"
        action={
          canWrite ? (
            <EntityForm
              action={saveDeliveryNoteAction}
              fields={fields}
              values={editing ?? { issueDate: istanbulDayKey(), status: "taslak" }}
              idValue={editing?.id}
              openLabel="Yeni İrsaliye"
            />
          ) : null
        }
      />

      <FilterBar action="/muhasebe/irsaliyeler">
        <Field label="Durum">
          <select name="durum" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Belge No", "Tarih", t("customer"), t("asset"), "Mal", "Miktar", "Sevk", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={9} text="İrsaliye yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.documentNo}</Td>
              <Td>{formatDate(r.issueDate)}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.plate ?? "—"}</Td>
              <Td className="max-w-xs truncate">{r.description ?? "—"}</Td>
              <Td className="text-neutral-500">
                {r.quantity ? `${formatQuantity(r.quantity)} ${r.unit ?? ""}`.trim() : "—"}
              </Td>
              <Td className="text-neutral-500">{r.shipDate ? formatDate(r.shipDate) : "—"}</Td>
              <Td>
                <Badge tone={TONE[r.status]}>{STATUS.find((s) => s.value === r.status)?.label}</Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/muhasebe/irsaliyeler?duzenle=${r.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canWrite && r.status === "taslak" ? (
                    <form action={deleteDeliveryNoteAction}>
                      <input type="hidden" name="id" value={r.id} />
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
