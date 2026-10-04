import { Card, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { profitAndLoss } from "@/modules/muhasebe/queries";

export default async function KarZararPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("kar_zarar:read", "muhasebe");

  const today = istanbulDayKey();
  const from = one(params, "baslangic") ?? `${today.slice(0, 4)}-01-01`;
  const to = one(params, "bitis") ?? today;

  const { monthly, byCategory, budgets } = await profitAndLoss(session.tenantId, from, to);

  // Ay bazlı gelir/gider/kâr tablosu
  const months = new Map<string, { gelir: number; gider: number; butce: number }>();
  for (const row of monthly) {
    const entry = months.get(row.donem) ?? { gelir: 0, gider: 0, butce: 0 };
    entry[row.kind] = Number(row.toplam);
    months.set(row.donem, entry);
  }
  for (const b of budgets) {
    const entry = months.get(b.donem) ?? { gelir: 0, gider: 0, butce: 0 };
    entry.butce = Number(b.toplam);
    months.set(b.donem, entry);
  }
  const rows = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));

  const totals = rows.reduce(
    (acc, [, v]) => ({
      gelir: acc.gelir + v.gelir,
      gider: acc.gider + v.gider,
      butce: acc.butce + v.butce,
    }),
    { gelir: 0, gider: 0, butce: 0 },
  );
  const kar = totals.gelir - totals.gider;
  const marj = totals.gelir > 0 ? Math.round((kar / totals.gelir) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Kâr / Zarar" description={`${formatDate(from)} – ${formatDate(to)}`} />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Gelir", value: formatTRY(String(totals.gelir)), tone: "text-emerald-700" },
          { label: "Gider", value: formatTRY(String(totals.gider)), tone: "text-red-600" },
          {
            label: "Kâr",
            value: formatTRY(String(kar)),
            tone: kar >= 0 ? "text-emerald-700" : "text-red-600",
          },
          { label: "Marj", value: `%${marj}`, tone: "text-neutral-900" },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${tile.tone}`}>{tile.value}</p>
          </Card>
        ))}
      </div>

      <FilterBar action="/muhasebe/kar-zarar">
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={from} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={to} className={inputClass} />
        </Field>
      </FilterBar>

      <PageHeader title="Aylık" description="Bütçe sütunu, o ay için girilen hedeftir" />
      <Table head={["Dönem", "Gelir", "Gider", "Kâr", "Bütçe", "Sapma"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Bu aralıkta tamamlanmış hareket yok." />
        ) : (
          rows.map(([donem, v]) => {
            const aylikKar = v.gelir - v.gider;
            const sapma = v.butce > 0 ? v.gider - v.butce : null;
            return (
              <tr key={donem} className="hover:bg-neutral-50">
                <Td className="font-medium">{donem}</Td>
                <Td className="text-emerald-700">{formatTRY(String(v.gelir))}</Td>
                <Td className="text-red-600">{formatTRY(String(v.gider))}</Td>
                <Td className={aylikKar >= 0 ? "font-medium text-emerald-700" : "font-medium text-red-600"}>
                  {formatTRY(String(aylikKar))}
                </Td>
                <Td className="text-neutral-500">{v.butce > 0 ? formatTRY(String(v.butce)) : "—"}</Td>
                <Td className={sapma !== null && sapma > 0 ? "text-red-600" : "text-neutral-500"}>
                  {sapma === null ? "—" : formatTRY(String(sapma))}
                </Td>
              </tr>
            );
          })
        )}
      </Table>

      <PageHeader title="Kategori Kırılımı" />
      <Table head={["Kategori", "Tür", "Tutar"]}>
        {byCategory.length === 0 ? (
          <EmptyRow colSpan={3} />
        ) : (
          byCategory.map((c, i) => (
            <tr key={`${c.kategori}-${c.kind}-${i}`} className="hover:bg-neutral-50">
              <Td className="font-medium">{c.kategori ?? "Kategorisiz"}</Td>
              <Td className={c.kind === "gelir" ? "text-emerald-700" : "text-red-600"}>
                {c.kind === "gelir" ? "Gelir" : "Gider"}
              </Td>
              <Td>{formatTRY(c.toplam)}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
