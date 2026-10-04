import { EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { saveBudgetAction } from "@/modules/muhasebe/actions";
import { listBudgets, listCategories } from "@/modules/muhasebe/queries";

export default async function ButcePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("butce:read", "muhasebe");

  const period = one(params, "donem");
  const [rows, kategoriler, firmalar] = await Promise.all([
    listBudgets(session.tenantId, period),
    listCategories(session.tenantId),
    companyOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    { name: "period", label: "Dönem", type: "text", required: true, hint: "2026-09" },
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
    { name: "amount", label: "Tutar (₺)", type: "text", required: true },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("butce:create");
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bütçe"
        description={`${rows.length} kalem · toplam ${formatTRY(String(total))}`}
        action={
          canWrite ? (
            <EntityForm
              action={saveBudgetAction}
              fields={fields}
              values={{ period: istanbulDayKey().slice(0, 7) }}
              openLabel="Bütçe Kalemi"
            />
          ) : null
        }
      />

      <FilterBar action="/muhasebe/butce">
        <Field label="Dönem">
          <input type="month" name="donem" defaultValue={period ?? ""} className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={["Dönem", "Kategori", t("customer"), "Tutar", "Not"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5} text="Bütçe kalemi yok." />
        ) : (
          rows.map((b) => (
            <tr key={b.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{b.period}</Td>
              <Td>{b.categoryName ?? "—"}</Td>
              <Td className="text-neutral-500">{b.companyName ?? "—"}</Td>
              <Td>{formatTRY(b.amount)}</Td>
              <Td className="max-w-xs truncate text-neutral-500">{b.notes ?? "—"}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
