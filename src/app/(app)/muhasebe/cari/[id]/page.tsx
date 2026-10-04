import { notFound } from "next/navigation";
import { Badge, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { addMoney, formatTRY, subMoney } from "@/lib/money";
import { pageContext } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { getCompany } from "@/modules/crm/queries";
import { addLedgerEntryAction } from "@/modules/muhasebe/actions";
import { listLedger } from "@/modules/muhasebe/queries";

const KIND_LABEL: Record<string, string> = {
  hakedis: "Hakediş",
  odeme: "Ödeme",
  avans: "Avans",
  kesinti: "Kesinti",
  diger: "Diğer",
};

const LEDGER_FIELDS = (companyId: string): readonly FieldSpec[] => [
  { name: "entryDate", label: "Tarih", type: "date", required: true },
  { name: "dueDate", label: "Vade", type: "date" },
  {
    name: "kind",
    label: "İşlem Türü",
    type: "select",
    options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })),
  },
  { name: "debit", label: "Borç (₺)", type: "text", hint: "Firmadan bize" },
  { name: "credit", label: "Alacak (₺)", type: "text", hint: "Bizden firmaya" },
  { name: "description", label: "Açıklama", type: "text", wide: true },
  ...(companyId ? [] : []),
];

export default async function CariEkstrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session } = await pageContext("cari:read", "muhasebe");

  const company = await getCompany(session.tenantId, id);
  if (!company) notFound();

  const entries = await listLedger(session.tenantId, id);
  const canWrite = session.permissions.has("cari:create");

  // Yürüyen bakiye: borç − alacak, satır satır.
  let running = "0.00";
  const rows = entries.map((entry) => {
    running = subMoney(addMoney(running, entry.debit), entry.credit);
    return { ...entry, running };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description="Cari ekstre"
        action={
          canWrite ? (
            <EntityForm
              action={addLedgerEntryAction}
              fields={LEDGER_FIELDS(id)}
              values={{ entryDate: istanbulDayKey(), debit: "0", credit: "0", kind: "diger" }}
              extraHidden={{ companyId: id }}
              openLabel="Hareket Ekle"
            />
          ) : null
        }
      />

      <Card className="p-4">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Bakiye</p>
        <p className="mt-1 text-3xl font-semibold">{formatTRY(running)}</p>
      </Card>

      <Table head={["Tarih", "Vade", "İşlem", "Açıklama", "Borç", "Alacak", "Bakiye"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Hareket yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td>{formatDate(r.entryDate)}</Td>
              <Td className="text-neutral-500">{r.dueDate ? formatDate(r.dueDate) : "—"}</Td>
              <Td>
                <Badge tone={r.kind === "odeme" ? "ok" : r.kind === "kesinti" ? "bad" : "mute"}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                </Badge>
              </Td>
              <Td className="max-w-xs truncate text-neutral-500">{r.description ?? "—"}</Td>
              <Td>{Number(r.debit) > 0 ? formatTRY(r.debit) : "—"}</Td>
              <Td>{Number(r.credit) > 0 ? formatTRY(r.credit) : "—"}</Td>
              <Td className="font-medium">{formatTRY(r.running)}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
