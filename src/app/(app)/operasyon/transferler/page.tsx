import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { deleteTransferAction, saveTransferAction } from "@/modules/operasyon/transfer/actions";
import { getTransfer, listTransfers } from "@/modules/operasyon/transfer/queries";
import {
  TRANSFER_STATUS_LABEL,
  TRANSFER_STATUS_TONE,
  type TransferStatus,
} from "@/modules/operasyon/transfer/state";

export default async function TransferlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("transferler:read", "operasyon");
  if (!can("operasyon.transfer")) redirect("/operasyon");

  const status = one(params, "durum");
  const [rows, firmalar, araclar] = await Promise.all([
    listTransfers(session.tenantId, { status, scope: session.scope }),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getTransfer(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Başlık", type: "text", required: true, wide: true },
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
    { name: "transferDate", label: "Tarih", type: "date" },
    { name: "transferTime", label: "Saat", type: "time" },
    { name: "pickupLocation", label: "Alış Noktası", type: "textarea", wide: true },
    { name: "dropoffLocation", label: "Bırakış Noktası", type: "textarea", wide: true },
    { name: "passengerCount", label: "Yolcu Sayısı", type: "number" },
    { name: "price", label: "Fiyat (₺)", type: "text" },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("transferler:create");
  const canDelete = session.permissions.has("transferler:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Transferler"
        description="Tek seferlik taşımalar"
        action={
          canWrite ? (
            <EntityForm
              action={saveTransferAction}
              fields={fields}
              values={editing ?? { transferDate: istanbulDayKey() }}
              idValue={editing?.id}
              openLabel="Yeni Transfer"
            />
          ) : null
        }
      />

      <FilterBar action="/operasyon/transferler">
        <Field label="Durum">
          <select name="durum" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(TRANSFER_STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Başlık", t("customer"), "Tarih", "Saat", t("asset"), "Yolcu", "Fiyat", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={9} text="Transfer yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                <Link href={`/operasyon/transferler/${r.id}`} className="hover:underline">
                  {r.title}
                </Link>
              </Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td>{r.transferDate ? formatDate(r.transferDate) : "—"}</Td>
              <Td className="text-neutral-500">{r.transferTime ?? "—"}</Td>
              <Td>{r.plate ?? <span className="text-neutral-400">atanmadı</span>}</Td>
              <Td className="text-neutral-500">{r.passengerCount ?? "—"}</Td>
              <Td>{r.price ? `${r.price} ₺` : "—"}</Td>
              <Td>
                <Badge tone={TRANSFER_STATUS_TONE[r.status as TransferStatus]}>
                  {TRANSFER_STATUS_LABEL[r.status as TransferStatus]}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/operasyon/transferler?duzenle=${r.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteTransferAction}>
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
