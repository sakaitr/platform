import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { requirePortal } from "@/lib/portal/guards";
import { formatDateTime } from "@/lib/time";
import { portalMessages, portalTicket } from "@/modules/portal/queries";
import { ReplyForm } from "./reply-form";

const STATUS_LABEL: Record<string, string> = {
  acik: "Açık",
  islemde: "İşlemde",
  bekliyor: "Beklemede",
  cozuldu: "Çözüldü",
  kapandi: "Kapandı",
};

export default async function PortalTalepDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requirePortal();

  const ticket = await portalTicket(session, id);
  if (!ticket) notFound();

  const messages = await portalMessages(session, id);
  const closed = ticket.status === "kapandi";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {ticket.ticketNo} · {ticket.title}
          </h1>
          <p className="text-sm text-neutral-500">{formatDateTime(ticket.createdAt)}</p>
        </div>
        <Badge tone={closed ? "mute" : ticket.status === "cozuldu" ? "ok" : "warn"}>
          {STATUS_LABEL[ticket.status]}
        </Badge>
      </div>

      {ticket.description ? (
        <Card className="p-4 text-sm whitespace-pre-wrap">{ticket.description}</Card>
      ) : null}

      <div className="space-y-3">
        {messages.map((m) => (
          <Card key={m.id} className={`p-4 ${m.fromCustomer ? "bg-neutral-50" : ""}`}>
            <div className="mb-1 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">{m.fromCustomer ? "Siz" : "Destek Ekibi"}</span>
              <span className="ml-2">{formatDateTime(m.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </Card>
        ))}
      </div>

      {closed ? (
        <p className="text-sm text-neutral-500">Bu talep kapatıldı. Yeni bir talep açabilirsiniz.</p>
      ) : (
        <ReplyForm ticketId={id} />
      )}
    </div>
  );
}
