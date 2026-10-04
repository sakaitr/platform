import Link from "next/link";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { formatTRY } from "@/lib/money";
import { pageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { listBalances } from "@/modules/muhasebe/queries";

export default async function CariPage() {
  const { session, t } = await pageContext("cari:read", "muhasebe");
  const rows = await listBalances(session.tenantId, session.scope);

  const total = rows.reduce((sum, r) => sum + Number(r.balance), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cari Hesaplar"
        description={`${rows.length} firma · net bakiye ${formatTRY(String(total))}`}
      />

      <Table head={[t("customer"), "Borç", "Alacak", "Bakiye", "Son Hareket", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Cari hareket yok." />
        ) : (
          rows.map((r) => {
            const balance = Number(r.balance);
            return (
              <tr key={r.companyId} className="hover:bg-neutral-50">
                <Td className="font-medium">
                  <Link href={`/muhasebe/cari/${r.companyId}`} className="hover:underline">
                    {r.companyName}
                  </Link>
                </Td>
                <Td className="text-neutral-500">{formatTRY(r.debit)}</Td>
                <Td className="text-neutral-500">{formatTRY(r.credit)}</Td>
                <Td>
                  <Badge tone={balance > 0 ? "ok" : balance < 0 ? "bad" : "mute"}>
                    {formatTRY(r.balance)}
                  </Badge>
                </Td>
                <Td className="text-neutral-500">{r.lastEntry ? formatDate(r.lastEntry) : "—"}</Td>
                <Td>
                  <div className="flex justify-end">
                    <Link
                      href={`/muhasebe/cari/${r.companyId}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Ekstre
                    </Link>
                  </div>
                </Td>
              </tr>
            );
          })
        )}
      </Table>

      <p className="text-xs text-neutral-500">
        Pozitif bakiye firmanın bize borcunu, negatif bakiye bizim firmaya borcumuzu gösterir.
      </p>
    </div>
  );
}
