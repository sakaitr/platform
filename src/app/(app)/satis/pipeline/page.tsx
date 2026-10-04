import Link from "next/link";
import { Field, FilterBar, PageHeader, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { saveDealAction } from "@/modules/satis/pipeline-actions";
import { getBoard, listCompanyOptions, listLeadOptions } from "@/modules/satis/pipeline-queries";
import { listOwnerOptions } from "@/modules/satis/queries";
import { canSeeAll } from "@/modules/satis/visibility";
import { Kanban, type KanbanColumn } from "./kanban";

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("satis_firsat:read", "satis");
  const owner = one(params, "sahip");

  const [board, owners, companies, leads] = await Promise.all([
    getBoard(session, { owner }),
    listOwnerOptions(session.tenantId),
    listCompanyOptions(session.tenantId),
    listLeadOptions(session),
  ]);

  const seeAll = canSeeAll(session);
  const canCreate = session.permissions.has("satis_firsat:create");
  const canMove = session.permissions.has("satis_firsat:update");
  const canEditStages = session.permissions.has("satis_asama:update");

  const columns: KanbanColumn[] = board.columns.map(({ stage, deals, count, value, truncated }) => ({
    id: stage.id,
    label: stage.label,
    kind: stage.kind,
    color: stage.color,
    count,
    value,
    truncated,
    deals: deals.map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value),
      currency: d.currency,
      ownerName: d.ownerName,
      who: d.companyName ?? d.leadName,
      expectedClose: d.expectedCloseAt ? formatDate(d.expectedCloseAt) : null,
    })),
  }));

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Başlık", type: "text", required: true },
    { name: "value", label: "Tutar (TL)", type: "text", placeholder: "15.000" },
    { name: "companyId", label: "Firma", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
    { name: "leadId", label: t("lead"), type: "select", options: leads.map((l) => ({ value: l.id, label: l.name })) },
    ...(seeAll ? [{ name: "ownerUserId", label: "Sahip", type: "select" as const, options: owners.map((o) => ({ value: o.id, label: o.name })) }] : []),
    { name: "expectedCloseDate", label: "Beklenen kapanış", type: "date" },
    { name: "note", label: "Not", type: "textarea", wide: true },
  ];

  const total = columns.reduce((sum, c) => sum + c.count, 0);
  const openValue = columns.filter((c) => c.kind === "open").reduce((sum, c) => sum + c.value, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pipeline"
        description={`${total} ${t("deal_plural").toLocaleLowerCase("tr")} · açık tutar ${openValue.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            {canEditStages ? (
              <Link href="/satis/pipeline/asamalar" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                Aşamaları düzenle
              </Link>
            ) : null}
            {canCreate ? (
              <EntityForm action={saveDealAction} fields={fields} values={{}} openLabel={`Yeni ${t("deal").toLocaleLowerCase("tr")}`} />
            ) : null}
          </div>
        }
      />

      <FilterBar action="/satis/pipeline">
        <Field label="Sahip">
          <select name="sahip" defaultValue={owner ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="ben">Bende olanlar</option>
            <option value="sahipsiz">Sahipsiz</option>
            {seeAll ? owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : null}
          </select>
        </Field>
      </FilterBar>

      <Kanban columns={columns} canMove={canMove} />
    </div>
  );
}
