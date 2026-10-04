import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { duplicateQuoteAction, deleteQuoteAction, quoteStatusAction } from "@/modules/satis/quote-actions";
import { QUOTE_STATUS } from "@/modules/satis/labels";
import { getQuote } from "@/modules/satis/quote-queries";
import { canTransition, computeQuote, formatAmount, formatQty, isEditable, toEditorItem } from "@/modules/satis/quotes";
import { QuoteEditor } from "../quote-editor";

export default async function TeklifDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, can } = await pageContext("satis_teklif:read", "satis");
  if (!can("satis.teklif")) redirect("/dashboard");

  const quote = await getQuote(session, id);
  if (!quote) notFound();

  const canUpdate = session.permissions.has("satis_teklif:update");
  const canCreate = session.permissions.has("satis_teklif:create");
  const canDelete = session.permissions.has("satis_teklif:delete");
  const editable = isEditable(quote.status) && canUpdate;
  const totals = computeQuote(quote.items);
  const unit = quote.currency === "TRY" ? "TL" : quote.currency;
  const status = QUOTE_STATUS[quote.status]!;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${quote.number} · ${quote.title}`}
        description={quote.dealTitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Link href={`/satis/teklifler/${quote.id}/yazdir`} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">Yazdır</Link>
            <Link href={`/satis/pipeline/${quote.dealId}`} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">Fırsata git</Link>
          </div>
        }
      />

      {editable ? (
        <QuoteEditor
          quoteId={quote.id}
          currency={quote.currency}
          initial={{
            title: quote.title,
            validUntil: quote.validUntil ? istanbulDayKey(quote.validUntil) : "",
            notes: quote.notes ?? "",
            items: quote.items.map(toEditorItem),
          }}
        />
      ) : (
        <Card className="space-y-4 p-4">
          {!isEditable(quote.status) ? (
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Bu teklif {status.label.toLocaleLowerCase("tr")} olduğu için değiştirilemez. Değişiklik için "Yeni sürüm oluştur" kullanın.
            </p>
          ) : null}
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr><th className="py-1">Kalem</th><th>Adet</th><th className="text-right">Birim fiyat</th><th className="text-right">KDV</th><th className="text-right">Tutar</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {quote.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-1.5">{item.name}</td>
                  <td>{formatQty(item.qty)}</td>
                  <td className="text-right tabular-nums">{formatAmount(item.unitPrice)}</td>
                  <td className="text-right">%{item.vatRate.replace(".", ",")}</td>
                  <td className="text-right tabular-nums">{formatAmount(totals.lines[i]!.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto max-w-sm space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-neutral-500">Ara toplam</dt><dd className="tabular-nums">{formatAmount(totals.subtotal)} {unit}</dd></div>
            {totals.vatByRate.map((g) => (
              <div key={g.rate} className="flex justify-between"><dt className="text-neutral-500">KDV %{g.rate.replace(".", ",")}</dt><dd className="tabular-nums">{formatAmount(g.vat)} {unit}</dd></div>
            ))}
            <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Genel toplam</dt><dd className="tabular-nums">{formatAmount(totals.total)} {unit}</dd></div>
          </dl>
          <p className="text-xs text-neutral-500">Geçerlilik: {formatDate(quote.validUntil)}</p>
          {quote.notes ? <p className="whitespace-pre-wrap text-sm">{quote.notes}</p> : null}
        </Card>
      )}

      <Card className="flex flex-wrap items-center gap-2 p-4">
        {canUpdate && canTransition(quote.status, "sent") ? (
          <form action={quoteStatusAction}><input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="sent" /><Button type="submit">Gönderildi olarak işaretle</Button></form>
        ) : null}
        {canUpdate && canTransition(quote.status, "accepted") ? (
          <form action={quoteStatusAction}><input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="accepted" /><Button type="submit">Kabul edildi</Button></form>
        ) : null}
        {canUpdate && canTransition(quote.status, "rejected") ? (
          <form action={quoteStatusAction}><input type="hidden" name="id" value={quote.id} /><input type="hidden" name="to" value="rejected" /><Button type="submit" variant="ghost">Reddedildi</Button></form>
        ) : null}
        {canCreate ? (
          <form action={duplicateQuoteAction}><input type="hidden" name="id" value={quote.id} /><Button type="submit" variant="ghost">Yeni sürüm oluştur</Button></form>
        ) : null}
        {canDelete && isEditable(quote.status) ? (
          <form action={deleteQuoteAction} className="ml-auto"><input type="hidden" name="id" value={quote.id} /><Button type="submit" variant="danger">Taslağı sil</Button></form>
        ) : null}
      </Card>
    </div>
  );
}
