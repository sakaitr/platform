import {
  Badge,
  Button,
  Card,
  EmptyRow,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey, shiftDay } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { routeOptions } from "@/modules/operasyon/guzergah/queries";
import { deleteTransactionAction, saveTransactionAction } from "@/modules/muhasebe/actions";
import { getTransaction, listCategories, listTransactions } from "@/modules/muhasebe/queries";

export default async function HareketlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("finans_gider:read", "muhasebe");

  const today = istanbulDayKey();
  const filter = {
    kind: one(params, "tur"),
    categoryId: one(params, "kategori"),
    companyId: one(params, "firma"),
    from: one(params, "baslangic") ?? shiftDay(today, -30),
    to: one(params, "bitis") ?? today,
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };

  const [result, kategoriler, firmalar, araclar, guzergahlar] = await Promise.all([
    listTransactions(session.tenantId, filter),
    listCategories(session.tenantId),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
    routeOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getTransaction(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    {
      name: "kind",
      label: "Tür",
      type: "select",
      required: true,
      options: [
        { value: "gider", label: "Gider" },
        { value: "gelir", label: "Gelir" },
      ],
    },
    { name: "entryDate", label: "Tarih", type: "date", required: true },
    {
      name: "categoryId",
      label: "Kategori",
      type: "select",
      options: kategoriler.map((c) => ({ value: c.id, label: `${c.name} (${c.kind})` })),
    },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "documentNo", label: "Belge No", type: "text" },
    { name: "amount", label: "Tutar (KDV dahil)", type: "text", required: true, hint: "1234.56" },
    { name: "vatRate", label: "KDV Oranı (%)", type: "text", hint: "KDV brütten ayrılır" },
    { name: "currency", label: "Para Birimi", type: "text" },
    { name: "rate", label: "Kur", type: "text", hint: "TRY için 1" },
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    {
      name: "routeId",
      label: "Güzergah",
      type: "select",
      options: guzergahlar.map((r) => ({ value: r.id, label: r.name })),
    },
    {
      name: "status",
      label: "Durum",
      type: "select",
      options: [
        { value: "tamamlandi", label: "Tamamlandı" },
        { value: "taslak", label: "Taslak" },
      ],
    },
    { name: "description", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("finans_gider:create");
  const canDelete = session.permissions.has("finans_gider:delete");
  const net = Number(result.summary.gelir) - Number(result.summary.gider);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gelir / Gider"
        description={`${formatDate(filter.from)} – ${formatDate(filter.to)}`}
        action={
          canWrite ? (
            <EntityForm
              action={saveTransactionAction}
              fields={fields}
              values={
                editing ?? {
                  entryDate: today,
                  kind: "gider",
                  vatRate: "20",
                  currency: "TRY",
                  rate: "1",
                  status: "tamamlandi",
                }
              }
              idValue={editing?.id}
              openLabel="Yeni Hareket"
            />
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Gelir", value: formatTRY(result.summary.gelir), tone: "text-emerald-700" },
          { label: "Gider", value: formatTRY(result.summary.gider), tone: "text-red-600" },
          { label: "Fark", value: formatTRY(String(net)), tone: net >= 0 ? "text-emerald-700" : "text-red-600" },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${tile.tone}`}>{tile.value}</p>
          </Card>
        ))}
      </div>

      <FilterBar action="/muhasebe/hareketler">
        <Field label="Tür">
          <select name="tur" defaultValue={filter.kind ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="gelir">Gelir</option>
            <option value="gider">Gider</option>
          </select>
        </Field>
        <Field label="Kategori">
          <select name="kategori" defaultValue={filter.categoryId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {kategoriler.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("customer")}>
          <select name="firma" defaultValue={filter.companyId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {firmalar.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={filter.from} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={filter.to} className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={["Tarih", "Tür", "Kategori", t("customer"), "Belge", "Tutar", "KDV", "Durum", ""]}>
        {result.rows.length === 0 ? (
          <EmptyRow colSpan={9} text="Bu aralıkta hareket yok." />
        ) : (
          result.rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td>{formatDate(r.entryDate)}</Td>
              <Td>
                <Badge tone={r.kind === "gelir" ? "ok" : "bad"}>
                  {r.kind === "gelir" ? "Gelir" : "Gider"}
                </Badge>
              </Td>
              <Td className="text-neutral-500">{r.categoryName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.documentNo ?? "—"}</Td>
              <Td className="font-medium">
                {formatTRY(r.amount)}
                {r.currency !== "TRY" ? (
                  <span className="ml-1 text-xs text-neutral-400">{r.currency}</span>
                ) : null}
              </Td>
              <Td className="text-neutral-500">{formatTRY(r.vat)}</Td>
              <Td>
                <Badge tone={r.status === "tamamlandi" ? "ok" : "warn"}>
                  {r.status === "tamamlandi" ? "Tamam" : "Taslak"}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/muhasebe/hareketler?duzenle=${r.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteTransactionAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <Pagination
        basePath="/muhasebe/hareketler"
        page={result.page}
        pageCount={result.pageCount}
        query={{
          tur: filter.kind,
          kategori: filter.categoryId,
          firma: filter.companyId,
          baslangic: filter.from,
          bitis: filter.to,
        }}
      />
    </div>
  );
}
