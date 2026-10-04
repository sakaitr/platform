"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, inputClass } from "@/components/ui";
import { useFormAction } from "@/components/ui/use-form-action";
import { saveQuoteAction, type ActionState } from "@/modules/satis/quote-actions";
import { computeQuote, formatAmount, parseDecimal, type QuoteItem } from "@/modules/satis/quotes";

type Row = QuoteItem;

const emptyRow = (): Row => ({ name: "", qty: "1", unitPrice: "", vatRate: "20" });

/** Canlı toplam yalnız gösterim içindir; sunucu toplamı kalemlerden yeniden hesaplar. */
function previewTotals(rows: Row[]) {
  const usable = rows.map((r) => ({
    name: r.name,
    qty: parseDecimal(r.qty, 3) ?? "0",
    unitPrice: parseDecimal(r.unitPrice, 2) ?? "0",
    vatRate: parseDecimal(r.vatRate, 2) ?? "0",
  }));
  return computeQuote(usable);
}

export function QuoteEditor({
  dealId,
  quoteId,
  currency,
  initial,
}: {
  dealId?: string;
  quoteId?: string;
  currency: string;
  initial: { title: string; validUntil: string; notes: string; items: Row[] };
}) {
  const { state, pending, onSubmit } = useFormAction<ActionState>(saveQuoteAction, null);
  const [rows, setRows] = useState<Row[]>(initial.items.length > 0 ? initial.items : [emptyRow()]);
  const totals = useMemo(() => previewTotals(rows), [rows]);
  const unit = currency === "TRY" ? "TL" : currency;

  const update = (index: number, patch: Partial<Row>): void =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {quoteId ? <input type="hidden" name="id" value={quoteId} /> : null}
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      <input type="hidden" name="items" value={JSON.stringify(rows)} />

      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Teklif başlığı">
            <input name="title" required defaultValue={initial.title} className={inputClass} />
          </Field>
        </div>
        <Field label="Geçerlilik tarihi">
          <input name="validUntil" type="date" defaultValue={initial.validUntil} className={inputClass} />
        </Field>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Kalemler</h2>
        <div className="hidden grid-cols-12 gap-2 text-xs text-neutral-500 sm:grid">
          <span className="col-span-5">Ad</span>
          <span className="col-span-1">Adet</span>
          <span className="col-span-2">Birim fiyat ({unit})</span>
          <span className="col-span-1">KDV %</span>
          <span className="col-span-2 text-right">Tutar</span>
          <span className="col-span-1" />
        </div>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-12 items-center gap-2">
            <input aria-label={`Kalem ${index + 1} adı`} value={row.name} onChange={(e) => update(index, { name: e.target.value })} placeholder="Hizmet ya da ürün" className={`${inputClass} col-span-12 sm:col-span-5`} />
            <input aria-label={`Kalem ${index + 1} adedi`} inputMode="decimal" value={row.qty} onChange={(e) => update(index, { qty: e.target.value })} className={`${inputClass} col-span-3 sm:col-span-1`} />
            <input aria-label={`Kalem ${index + 1} birim fiyatı`} inputMode="decimal" value={row.unitPrice} onChange={(e) => update(index, { unitPrice: e.target.value })} placeholder="0,00" className={`${inputClass} col-span-5 sm:col-span-2`} />
            <input aria-label={`Kalem ${index + 1} KDV oranı`} inputMode="decimal" value={row.vatRate} onChange={(e) => update(index, { vatRate: e.target.value })} className={`${inputClass} col-span-2 sm:col-span-1`} />
            <span className="col-span-2 text-right text-sm tabular-nums">{formatAmount(totals.lines[index]?.net ?? "0.00")}</span>
            <span className="col-span-12 flex justify-end sm:col-span-1">
              <Button type="button" variant="danger" aria-label={`Kalem ${index + 1} sil`} disabled={rows.length === 1} onClick={() => setRows((c) => c.filter((_, i) => i !== index))}>
                Sil
              </Button>
            </span>
          </div>
        ))}
        <Button type="button" variant="ghost" onClick={() => setRows((c) => [...c, emptyRow()])}>
          Kalem ekle
        </Button>

        <dl className="ml-auto max-w-sm space-y-1 border-t border-neutral-200 pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-neutral-500">Ara toplam</dt><dd className="tabular-nums">{formatAmount(totals.subtotal)} {unit}</dd></div>
          {totals.vatByRate.map((g) => (
            <div key={g.rate} className="flex justify-between"><dt className="text-neutral-500">KDV %{g.rate.replace(".", ",")}</dt><dd className="tabular-nums">{formatAmount(g.vat)} {unit}</dd></div>
          ))}
          <div className="flex justify-between border-t border-neutral-200 pt-1 font-semibold"><dt>Genel toplam</dt><dd className="tabular-nums" data-testid="quote-total">{formatAmount(totals.total)} {unit}</dd></div>
        </dl>
      </Card>

      <Card className="p-4">
        <Field label="Notlar (teklifte görünür)">
          <textarea name="notes" rows={3} defaultValue={initial.notes} className={inputClass} />
        </Field>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Kaydediliyor…" : "Kaydet"}</Button>
        {state && "error" in state ? <span role="alert" className="text-sm text-red-600">{state.error}</span> : null}
        {state && "ok" in state ? <span className="text-sm text-emerald-600">{state.ok}</span> : null}
      </div>
    </form>
  );
}
