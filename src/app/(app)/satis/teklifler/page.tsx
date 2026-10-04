import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { listQuotes } from "@/modules/satis/quote-queries";
import { QUOTE_STATUS } from "@/modules/satis/labels";
import { formatAmount } from "@/modules/satis/quotes";

export default async function TekliflerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, can } = await pageContext("satis_teklif:read", "satis");
  if (!can("satis.teklif")) redirect("/dashboard");

  const filter = { q: one(params, "q"), status: one(params, "durum") };
  const quotes = await listQuotes(session, filter);
  const canCreate = session.permissions.has("satis_teklif:create");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teklifler"
        description={`${quotes.length} teklif`}
        action={
          canCreate ? (
            <Link href="/satis/teklifler/yeni" className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800">
              Yeni teklif
            </Link>
          ) : null
        }
      />
      <FilterBar action="/satis/teklifler">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Numara, başlık, fırsat" className={inputClass} />
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(QUOTE_STATUS).map(([value, s]) => (
              <option key={value} value={value}>{s.label}</option>
            ))}
          </select>
        </Field>
      </FilterBar>
      <Table head={["Numara", "Başlık", "Fırsat", "Durum", "Toplam", "Geçerlilik", "Oluşturma"]}>
        {quotes.length === 0 ? (
          <EmptyRow colSpan={7} text="Teklif yok. Bir fırsattan ya da 'Yeni teklif' ile oluşturun." />
        ) : (
          quotes.map((q) => (
            <tr key={q.id} className="hover:bg-neutral-50">
              <Td className="font-medium"><Link href={`/satis/teklifler/${q.id}`} className="hover:underline">{q.number}</Link></Td>
              <Td>{q.title}</Td>
              <Td><Link href={`/satis/pipeline/${q.dealId}`} className="text-neutral-600 hover:underline">{q.dealTitle}</Link></Td>
              <Td><Badge tone={QUOTE_STATUS[q.status]!.tone}>{QUOTE_STATUS[q.status]!.label}</Badge></Td>
              <Td className="tabular-nums">{formatAmount(q.total)} {q.currency === "TRY" ? "TL" : q.currency}</Td>
              <Td className="text-neutral-500">{formatDate(q.validUntil)}</Td>
              <Td className="text-neutral-500">{formatDate(q.createdAt)}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
