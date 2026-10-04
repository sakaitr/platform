import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDate, formatDateTime } from "@/lib/time";
import {
  addTransferPassengerAction,
  removeTransferPassengerAction,
  setTransferStatusAction,
} from "@/modules/operasyon/transfer/actions";
import { getTransfer, listTransferPassengers } from "@/modules/operasyon/transfer/queries";
import {
  TRANSFER_STATUS_LABEL,
  TRANSFER_STATUS_TONE,
  nextStatuses,
  type TransferStatus,
} from "@/modules/operasyon/transfer/state";

export default async function TransferDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, can } = await pageContext("transferler:read", "operasyon");
  if (!can("operasyon.transfer")) redirect("/operasyon");

  const transfer = await getTransfer(session.tenantId, id);
  if (!transfer) notFound();

  const pax = await listTransferPassengers(session.tenantId, id);
  const canUpdate = session.permissions.has("transferler:update");
  const status = transfer.status as TransferStatus;
  const options = nextStatuses(status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={transfer.title}
        description={[
          transfer.transferDate ? formatDate(transfer.transferDate) : null,
          transfer.transferTime,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={<Badge tone={TRANSFER_STATUS_TONE[status]}>{TRANSFER_STATUS_LABEL[status]}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Alış</p>
          <p className="mt-1 text-sm">{transfer.pickupLocation ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Bırakış</p>
          <p className="mt-1 text-sm">{transfer.dropoffLocation ?? "—"}</p>
        </Card>
      </div>

      {canUpdate && options.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Durum ilerlet</p>
          <div className="flex flex-wrap gap-2">
            {options.map((next) => (
              <form key={next} action={setTransferStatusAction} className="flex items-center gap-1">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={next} />
                {next === "iptal" ? (
                  <input
                    name="reason"
                    placeholder="İptal nedeni"
                    className="w-40 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                  />
                ) : null}
                <Button type="submit" variant={next === "iptal" ? "danger" : "primary"}>
                  {TRANSFER_STATUS_LABEL[next]}
                </Button>
              </form>
            ))}
          </div>
        </Card>
      ) : null}

      {transfer.cancellationReason ? (
        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">
          İptal nedeni: {transfer.cancellationReason}
        </Card>
      ) : null}

      <PageHeader title="Yolcular" description={`${pax.length} kişi`} />
      {canUpdate ? (
        <Card className="p-3">
          <form action={addTransferPassengerAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="transferId" value={id} />
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Ad Soyad</span>
              <input name="name" required className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Telefon</span>
              <input name="phone" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
            </label>
            <Button type="submit">Ekle</Button>
          </form>
        </Card>
      ) : null}

      <Table head={["Ad Soyad", "Telefon", ""]}>
        {pax.length === 0 ? (
          <EmptyRow colSpan={3} text="Yolcu eklenmemiş." />
        ) : (
          pax.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{p.name}</Td>
              <Td className="text-neutral-500">{p.phone ?? "—"}</Td>
              <Td>
                {canUpdate ? (
                  <form action={removeTransferPassengerAction} className="flex justify-end">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="transferId" value={id} />
                    <Button type="submit" variant="danger">
                      Çıkar
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <p className="text-xs text-neutral-400">
        Oluşturulma: {formatDateTime(transfer.createdAt)}
        {transfer.completedAt ? ` · Tamamlanma: ${formatDateTime(transfer.completedAt)}` : ""}
      </p>
    </div>
  );
}
