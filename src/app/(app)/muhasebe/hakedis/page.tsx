import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey, shiftDay } from "@/lib/time";
import { vehicleOptions } from "@/modules/filo/queries";
import {
  createEarningAction,
  deleteEarningAction,
  setEarningStatusAction,
} from "@/modules/muhasebe/actions";
import { listEarnings, listOperators, listPricingForms } from "@/modules/muhasebe/queries";

const STATUS_LABEL: Record<string, string> = {
  taslak: "Taslak",
  tahakkuk: "Tahakkuk",
  onaylandi: "Onaylandı",
  odendi: "Ödendi",
  iptal: "İptal",
};

const STATUS_TONE: Record<string, string> = {
  taslak: "mute",
  tahakkuk: "warn",
  onaylandi: "info",
  odendi: "ok",
  iptal: "bad",
};

const NEXT: Record<string, readonly string[]> = {
  taslak: ["tahakkuk", "iptal"],
  tahakkuk: ["onaylandi", "iptal"],
  onaylandi: ["odendi", "iptal"],
  odendi: [],
  iptal: [],
};

export default async function HakedisPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("hakedis:read", "muhasebe");
  if (!can("muhasebe.hakedis")) redirect("/muhasebe/hareketler");

  const today = istanbulDayKey();
  const filter = {
    operatorId: one(params, "isleten"),
    status: one(params, "durum"),
    from: one(params, "baslangic"),
    to: one(params, "bitis"),
    scope: session.scope,
  };

  const [rows, operators, forms, araclar] = await Promise.all([
    listEarnings(session.tenantId, filter),
    listOperators(session.tenantId, session.scope),
    listPricingForms(session.tenantId),
    vehicleOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    {
      name: "operatorId",
      label: "İşleten",
      type: "select",
      required: true,
      options: operators.map((o) => ({ value: o.id, label: o.name })),
    },
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
      hint: "Boş bırakılırsa işletenin tüm araçları",
    },
    {
      name: "pricingFormId",
      label: "Ücretlendirme Formu",
      type: "select",
      options: forms.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "periodStart", label: "Dönem Başı", type: "date", required: true },
    { name: "periodEnd", label: "Dönem Sonu", type: "date", required: true },
    { name: "unitPrice", label: "Sefer Başı Ücret", type: "text", required: true, hint: "1234.56" },
    { name: "vatRate", label: "KDV Oranı (%)", type: "text" },
    { name: "withholdingRate", label: "Tevkifat Oranı (%)", type: "text", hint: "KDV'nin yüzde kaçı" },
    { name: "deductions", label: "Kesinti (₺)", type: "text" },
    { name: "notes", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canCreate = session.permissions.has("hakedis:create");
  const canApprove = session.permissions.has("hakedis:approve");
  const canDelete = session.permissions.has("hakedis:delete");

  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + Number(r.gross),
      net: acc.net + Number(r.net),
      trips: acc.trips + Number(r.tripCount),
    }),
    { gross: 0, net: 0, trips: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hakedişler"
        description="Onaylı çetelelerden üretilir; bir çetele yalnız bir hakedişe girer."
        action={
          canCreate ? (
            <EntityForm
              action={createEarningAction}
              fields={fields}
              values={{
                periodStart: shiftDay(today, -30),
                periodEnd: today,
                vatRate: "20",
                withholdingRate: "0",
                deductions: "0",
              }}
              openLabel="Hakediş Oluştur"
            />
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Sefer", value: totals.trips.toLocaleString("tr-TR") },
          { label: "Brüt", value: formatTRY(String(totals.gross)) },
          { label: "Net", value: formatTRY(String(totals.net)) },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold">{tile.value}</p>
          </Card>
        ))}
      </div>

      <FilterBar action="/muhasebe/hakedis">
        <Field label="İşleten">
          <select name="isleten" defaultValue={filter.operatorId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={filter.from ?? ""} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={filter.to ?? ""} className={inputClass} />
        </Field>
      </FilterBar>

      <Table
        head={["Belge", "İşleten", t("asset"), "Dönem", "Sefer", "Brüt", "KDV", "Tevkifat", "Net", "Durum", ""]}
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={11} text="Hakediş yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.documentNo ?? "—"}</Td>
              <Td>{r.operatorName}</Td>
              <Td className="text-neutral-500">{r.plate ?? "tümü"}</Td>
              <Td className="text-neutral-500">
                {formatDate(r.periodStart)} – {formatDate(r.periodEnd)}
              </Td>
              <Td>{Number(r.tripCount)}</Td>
              <Td>{formatTRY(r.gross)}</Td>
              <Td className="text-neutral-500">{formatTRY(r.vat)}</Td>
              <Td className="text-neutral-500">{formatTRY(r.withholding)}</Td>
              <Td className="font-medium">{formatTRY(r.net)}</Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-2">
                  {canApprove
                    ? (NEXT[r.status] ?? []).map((next) => (
                        <form key={next} action={setEarningStatusAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="status" value={next} />
                          <Button type="submit" variant={next === "iptal" ? "danger" : "ghost"}>
                            {STATUS_LABEL[next]}
                          </Button>
                        </form>
                      ))
                    : null}
                  {canDelete && (r.status === "taslak" || r.status === "iptal") ? (
                    <form action={deleteEarningAction}>
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
    </div>
  );
}
