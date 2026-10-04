import Link from "next/link";
import { Badge, Card, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDateTime } from "@/lib/time";
import { listUsers } from "@/modules/admin/queries";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { createTicketAction } from "@/modules/isbirligi/actions";
import { listTickets, ticketSummary } from "@/modules/isbirligi/queries";

export const TICKET_STATUS = [
  { value: "acik", label: "Açık" },
  { value: "islemde", label: "İşlemde" },
  { value: "bekliyor", label: "Beklemede" },
  { value: "cozuldu", label: "Çözüldü" },
  { value: "kapandi", label: "Kapandı" },
] as const;

export const TICKET_TONE: Record<string, string> = {
  acik: "warn",
  islemde: "info",
  bekliyor: "mute",
  cozuldu: "ok",
  kapandi: "mute",
};

const PRIORITY = [
  { value: "dusuk", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "yuksek", label: "Yüksek" },
  { value: "kritik", label: "Kritik" },
] as const;

export default async function DestekPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("sorunlar:read", "destek");

  const filter = {
    status: one(params, "durum"),
    priority: one(params, "oncelik"),
    source: one(params, "kaynak"),
    scope: session.scope,
  };
  const [rows, summary, firmalar, araclar, kullanicilar] = await Promise.all([
    listTickets(session.tenantId, filter),
    ticketSummary(session.tenantId),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
    listUsers(session.tenantId),
  ]);

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Konu", type: "text", required: true, wide: true },
    { name: "priority", label: "Öncelik", type: "select", options: PRIORITY },
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
    {
      name: "assignedTo",
      label: "Atanan",
      type: "select",
      options: kullanicilar.map((u) => ({ value: u.id, label: u.name })),
    },
    { name: "description", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canCreate = session.permissions.has("sorunlar:create");
  const now = Date.now();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Destek Talepleri"
        description="Portal ve iç talepler aynı kuyrukta"
        action={
          canCreate ? (
            <EntityForm
              action={createTicketAction}
              fields={fields}
              values={{ priority: "normal" }}
              openLabel="Yeni Talep"
            />
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-5">
        {TICKET_STATUS.map((s) => (
          <Card key={s.value} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold">{summary[s.value] ?? 0}</p>
          </Card>
        ))}
      </div>

      <FilterBar action="/destek">
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {TICKET_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Öncelik">
          <select name="oncelik" defaultValue={filter.priority ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {PRIORITY.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kaynak">
          <select name="kaynak" defaultValue={filter.source ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="ic">İç talep</option>
            <option value="portal">Müşteri portalı</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["No", "Konu", t("customer"), "Öncelik", "Atanan", "Kaynak", "SLA", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Talep yok." />
        ) : (
          rows.map((r) => {
            const slaLate = r.slaDueAt && new Date(r.slaDueAt).getTime() < now && r.status !== "cozuldu";
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="font-medium">
                  <Link href={`/destek/${r.id}`} className="hover:underline">
                    {r.ticketNo}
                  </Link>
                </Td>
                <Td className="max-w-xs truncate">{r.title}</Td>
                <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
                <Td>
                  <Badge tone={r.priority === "kritik" ? "bad" : r.priority === "yuksek" ? "warn" : "mute"}>
                    {PRIORITY.find((p) => p.value === r.priority)?.label}
                  </Badge>
                </Td>
                <Td className="text-neutral-500">{r.assigneeName ?? "atanmadı"}</Td>
                <Td className="text-neutral-500">{r.source === "portal" ? "Portal" : "İç"}</Td>
                <Td>
                  {r.slaDueAt ? (
                    slaLate ? (
                      <Badge tone="bad">{formatDateTime(r.slaDueAt)}</Badge>
                    ) : (
                      formatDateTime(r.slaDueAt)
                    )
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <Badge tone={TICKET_TONE[r.status]}>
                    {TICKET_STATUS.find((s) => s.value === r.status)?.label}
                  </Badge>
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
