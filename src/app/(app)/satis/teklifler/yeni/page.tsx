import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { getDealTitle, listQuotableDeals } from "@/modules/satis/quote-queries";
import { QuoteEditor } from "../quote-editor";

export default async function YeniTeklifPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, can } = await pageContext("satis_teklif:create", "satis");
  if (!can("satis.teklif")) redirect("/dashboard");

  const dealId = one(params, "firsat");
  const deal = dealId ? await getDealTitle(session, dealId) : null;

  if (!deal) {
    const deals = await listQuotableDeals(session);
    return (
      <div className="space-y-4">
        <PageHeader title="Yeni teklif" description="Önce teklifin hangi fırsata ait olduğunu seçin." />
        <Card className="p-4">
          {deals.length === 0 ? (
            <p className="text-sm text-neutral-500">Teklif verebileceğiniz fırsat yok. Önce Pipeline'dan bir fırsat açın.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {deals.map((d) => (
                <li key={d.id}>
                  <Link href={`/satis/teklifler/yeni?firsat=${d.id}`} className="block py-2 hover:underline">{d.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Yeni teklif" description={deal.title} />
      <QuoteEditor dealId={deal.id} currency="TRY" initial={{ title: deal.title, validUntil: "", notes: "", items: [] }} />
    </div>
  );
}
