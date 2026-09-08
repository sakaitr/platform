import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { EntityForm } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { formatDateTime } from "@/lib/time";
import { listUsers } from "@/modules/admin/queries";
import {
  addTicketMessageAction,
  assignTicketAction,
  setTicketStatusAction,
} from "@/modules/isbirligi/actions";
import { getTicket, listTicketMessages } from "@/modules/isbirligi/queries";
import { TICKET_STATUS, TICKET_TONE } from "../page";

const FLOW: Record<string, readonly string[]> = {
  acik: ["islemde", "bekliyor", "kapandi"],
  islemde: ["bekliyor", "cozuldu", "kapandi"],
  bekliyor: ["islemde", "cozuldu", "kapandi"],
  cozuldu: ["kapandi", "islemde"],
  kapandi: [],
};

export default async function TalepDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session } = await pageContext("sorunlar:read", "destek");

  const ticket = await getTicket(session.tenantId, id);
  if (!ticket) notFound();

  const [messages, kullanicilar] = await Promise.all([
    // Personel görünümü: iç notlar dahil.
    listTicketMessages(session.tenantId, id, true),
    listUsers(session.tenantId),
  ]);

  const canUpdate = session.permissions.has("sorunlar:update");
  const canAssign = session.permissions.has("sorunlar:assign");
  const label = TICKET_STATUS.find((s) => s.value === ticket.status)?.label ?? ticket.status;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${ticket.ticketNo} · ${ticket.title}`}
        description={`${ticket.source === "portal" ? "Müşteri portalından" : "İç talep"} · ${formatDateTime(ticket.createdAt)}`}
        action={<Badge tone={TICKET_TONE[ticket.status]}>{label}</Badge>}
      />

      {ticket.description ? (
        <Card className="p-4 text-sm whitespace-pre-wrap">{ticket.description}</Card>
      ) : null}

      {canUpdate && FLOW[ticket.status]!.length > 0 ? (
        <Card className="p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Durum</p>
          <div className="flex flex-wrap gap-2">
            {FLOW[ticket.status]!.map((next) => (
              <form key={next} action={setTicketStatusAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={next} />
                <Button type="submit" variant={next === "kapandi" ? "ghost" : "primary"}>
                  {TICKET_STATUS.find((s) => s.value === next)?.label}
                </Button>
              </form>
            ))}
          </div>
        </Card>
      ) : null}

      {canAssign ? (
        <Card className="p-4">
          <form action={assignTicketAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={id} />
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-neutral-600">Atanan</span>
              <select
                name="assignedTo"
                defaultValue={ticket.assignedTo ?? ""}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
              >
                <option value="">Atanmadı</option>
                {kullanicilar.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="ghost">
              Ata
            </Button>
          </form>
        </Card>
      ) : null}

      <PageHeader title="Yazışma" description={`${messages.length} mesaj`} />

      <div className="space-y-3">
        {messages.map((m) => (
          <Card
            key={m.id}
            className={`p-4 ${m.isInternal ? "border-amber-200 bg-amber-50" : m.fromCustomer ? "bg-neutral-50" : ""}`}
          >
            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">
                {m.fromCustomer ? "Müşteri" : (m.userName ?? "Personel")}
              </span>
              <span>{formatDateTime(m.createdAt)}</span>
              {m.isInternal ? <Badge tone="warn">iç not</Badge> : null}
            </div>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </Card>
        ))}
      </div>

      {canUpdate ? (
        <EntityForm
          action={addTicketMessageAction}
          fields={[
            { name: "body", label: "Mesaj", type: "textarea", required: true, wide: true },
            { name: "isInternal", label: "İç not (müşteri görmez)", type: "checkbox" },
          ]}
          extraHidden={{ ticketId: id }}
          openLabel="Yanıtla"
          alwaysOpen
        />
      ) : null}
    </div>
  );
}
