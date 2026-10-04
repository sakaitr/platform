import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageContext } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { QUOTE_STATUS } from "@/modules/satis/labels";
import { getQuote } from "@/modules/satis/quote-queries";
import { computeQuote, formatAmount, formatQty } from "@/modules/satis/quotes";
import { PrintButton } from "./print-button";

/**
 * Yazdırılabilir teklif. Kenar çubuğu ve üst çubuk `print:hidden` olduğu için tarayıcının
 * "yazdır" / "PDF olarak kaydet" çıktısı yalnız teklifi içerir. PDF üretimi MVP dışında.
 */
export default async function TeklifYazdirPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, can } = await pageContext("satis_teklif:read", "satis");
  if (!can("satis.teklif")) redirect("/dashboard");
  const quote = await getQuote(session, id);
  if (!quote) notFound();

  const totals = computeQuote(quote.items);
  const unit = quote.currency === "TRY" ? "TL" : quote.currency;
  const customer = quote.companyName ?? quote.leadName ?? "—";
  const contact = quote.leadContact && quote.leadContact !== customer ? quote.leadContact : null;
  const phone = quote.companyPhone ?? quote.leadPhone;
  const email = quote.companyEmail ?? quote.leadEmail;

  return (
    <article className="mx-auto max-w-3xl space-y-6 bg-white p-8 text-sm text-neutral-900 print:max-w-none print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/satis/teklifler/${quote.id}`} className="text-xs text-neutral-600 underline">Teklife dön</Link>
        <PrintButton />
      </div>

      <header className="flex items-start justify-between border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-xl font-semibold">{quote.tenantName}</h1>
          {quote.ownerName ? <p className="text-neutral-600">{quote.ownerName}{quote.ownerEmail ? ` · ${quote.ownerEmail}` : ""}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">TEKLİF</p>
          <p className="tabular-nums">{quote.number}</p>
          <p className="text-neutral-600">Tarih: {formatDate(quote.createdAt)}</p>
          {quote.validUntil ? <p className="text-neutral-600">Geçerlilik: {formatDate(quote.validUntil)}</p> : null}
          {quote.status !== "draft" ? <p className="text-xs text-neutral-500">{QUOTE_STATUS[quote.status]!.label}</p> : <p className="text-xs text-neutral-500">Taslak</p>}
        </div>
      </header>

      <section>
        <p className="text-xs uppercase tracking-wide text-neutral-500">Sayın</p>
        <p className="text-base font-medium">{customer}</p>
        {contact ? <p>{contact}</p> : null}
        {phone || email ? <p className="text-neutral-600">{[phone, email].filter(Boolean).join(" · ")}</p> : null}
        <p className="mt-3 font-medium">{quote.title}</p>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wide text-neutral-600">
            <th className="py-2">Kalem</th><th className="py-2 text-right">Adet</th><th className="py-2 text-right">Birim fiyat</th><th className="py-2 text-right">KDV</th><th className="py-2 text-right">Tutar</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-2">{item.name}</td>
              <td className="py-2 text-right tabular-nums">{formatQty(item.qty)}</td>
              <td className="py-2 text-right tabular-nums">{formatAmount(item.unitPrice)}</td>
              <td className="py-2 text-right">%{item.vatRate.replace(".", ",")}</td>
              <td className="py-2 text-right tabular-nums">{formatAmount(totals.lines[i]!.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto max-w-xs space-y-1">
        <div className="flex justify-between"><dt>Ara toplam</dt><dd className="tabular-nums">{formatAmount(totals.subtotal)} {unit}</dd></div>
        {totals.vatByRate.map((g) => (
          <div key={g.rate} className="flex justify-between"><dt>KDV %{g.rate.replace(".", ",")}</dt><dd className="tabular-nums">{formatAmount(g.vat)} {unit}</dd></div>
        ))}
        <div className="flex justify-between border-t border-neutral-400 pt-1 text-base font-semibold"><dt>Genel toplam</dt><dd className="tabular-nums">{formatAmount(totals.total)} {unit}</dd></div>
      </dl>

      {quote.notes ? (
        <section className="border-t border-neutral-200 pt-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Notlar</p>
          <p className="whitespace-pre-wrap">{quote.notes}</p>
        </section>
      ) : null}
    </article>
  );
}
