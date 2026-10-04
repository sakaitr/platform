import Link from "next/link";
import { Badge, EmptyRow, Table, Td } from "@/components/ui";
import { requirePortal } from "@/lib/portal/guards";
import { formatDateTime } from "@/lib/time";
import { portalTickets } from "@/modules/portal/queries";
import { NewTicketForm } from "./new-ticket-form";

const STATUS_LABEL: Record<string, string> = {
  acik: "Açık",
  islemde: "İşlemde",
  bekliyor: "Beklemede",
  cozuldu: "Çözüldü",
  kapandi: "Kapandı",
};

const TONE: Record<string, string> = {
  acik: "warn",
  islemde: "info",
  bekliyor: "mute",
  cozuldu: "ok",
  kapandi: "mute",
};

export default async function PortalTaleplerPage() {
  const session = await requirePortal();
  const rows = await portalTickets(session);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Taleplerim</h1>
          <p className="text-sm text-neutral-500">{rows.length} kayıt</p>
        </div>
        <NewTicketForm
          companies={session.companyIds.map((id, i) => ({ id, name: session.companyNames[i]! }))}
        />
      </div>

      <Table head={["No", "Konu", "Firma", "Tarih", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5} text="Henüz talep açmadınız." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                <Link href={`/portal/talepler/${r.id}`} className="hover:underline">
                  {r.ticketNo}
                </Link>
              </Td>
              <Td className="max-w-xs truncate">{r.title}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{formatDateTime(r.createdAt)}</Td>
              <Td>
                <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
