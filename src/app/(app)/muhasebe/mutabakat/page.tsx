import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, formatDateTime, istanbulDayKey } from "@/lib/time";
import {
  createReconciliationAction,
  setReconciliationStatusAction,
} from "@/modules/muhasebe/actions";
import { listBalances, listReconciliations } from "@/modules/muhasebe/queries";

const STATUS_LABEL: Record<string, string> = {
  hazirlaniyor: "Hazırlanıyor",
  gonderildi: "Gönderildi",
  onaylandi: "Onaylandı",
  itiraz: "İtiraz",
};

const STATUS_TONE: Record<string, string> = {
  hazirlaniyor: "mute",
  gonderildi: "warn",
  onaylandi: "ok",
  itiraz: "bad",
};

export default async function MutabakatPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("mutabakat:read", "muhasebe");
  if (!can("muhasebe.mutabakat")) redirect("/muhasebe/hareketler");

  const period = one(params, "donem") ?? istanbulDayKey().slice(0, 7);
  const [rows, balances] = await Promise.all([
    listReconciliations(session.tenantId, `${period}-01`),
    listBalances(session.tenantId, session.scope),
  ]);

  const canCreate = session.permissions.has("mutabakat:create");
  const canApprove = session.permissions.has("mutabakat:approve");
  const covered = new Set(rows.map((r) => r.companyName));
  const missing = balances.filter((b) => !covered.has(b.companyName));

  return (
    <div className="space-y-6">
      <PageHeader title="Mutabakat" description={`${period} dönemi`} />

      <FilterBar action="/muhasebe/mutabakat">
        <Field label="Dönem">
          <input type="month" name="donem" defaultValue={period} className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={[t("customer"), "Dönem", "Bakiye", "Durum", "Gönderim", "Yanıt", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Bu dönemde mutabakat kaydı yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.companyName}</Td>
              <Td>{formatDate(r.period)}</Td>
              <Td>{formatTRY(r.balance)}</Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                {r.objection ? (
                  <span className="ml-2 text-xs text-neutral-500">{r.objection}</span>
                ) : null}
              </Td>
              <Td className="text-neutral-500">{r.sentAt ? formatDateTime(r.sentAt) : "—"}</Td>
              <Td className="text-neutral-500">{r.respondedAt ? formatDateTime(r.respondedAt) : "—"}</Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-2">
                  {canApprove && r.status === "hazirlaniyor" ? (
                    <form action={setReconciliationStatusAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="status" value="gonderildi" />
                      <Button type="submit" variant="ghost">
                        Gönder
                      </Button>
                    </form>
                  ) : null}
                  {canApprove && r.status === "gonderildi" ? (
                    <>
                      <form action={setReconciliationStatusAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value="onaylandi" />
                        <Button type="submit">Onaylandı</Button>
                      </form>
                      <form action={setReconciliationStatusAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="status" value="itiraz" />
                        <input
                          name="objection"
                          placeholder="İtiraz nedeni"
                          className="w-36 rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                        />
                        <Button type="submit" variant="danger">
                          İtiraz
                        </Button>
                      </form>
                    </>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>

      {canCreate && missing.length > 0 ? (
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium">Mutabakatı açılmamış firmalar</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((b) => (
              <form key={b.companyId} action={createReconciliationAction}>
                <input type="hidden" name="companyId" value={b.companyId} />
                <input type="hidden" name="period" value={period} />
                <Button type="submit" variant="ghost">
                  {b.companyName} · {formatTRY(b.balance)}
                </Button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Mutabakat açıldığında o anki bakiye dondurulur; sonraki hareketler kaydı değiştirmez.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
