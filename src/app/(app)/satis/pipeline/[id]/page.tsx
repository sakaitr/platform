import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, formatDateTime, istanbulDayKey } from "@/lib/time";
import {
  completeTaskAction,
  deleteActivityAction,
  deleteDealAction,
  moveDealFormAction,
  saveDealAction,
} from "@/modules/satis/pipeline-actions";
import { getDealDetail, listCompanyOptions, listLeadOptions, listStages } from "@/modules/satis/pipeline-queries";
import { ACTIVITY_LABEL } from "@/modules/satis/labels";
import { listOwnerOptions } from "@/modules/satis/queries";
import { canSeeAll } from "@/modules/satis/visibility";
import { ActivityForm } from "../../_components/activity-form";

const STAGE_TONE = { open: "info", won: "ok", lost: "bad" } as const;
const QUOTE_LABEL: Record<string, string> = { draft: "Taslak", sent: "Gönderildi", accepted: "Kabul edildi", rejected: "Reddedildi" };

export default async function FirsatDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { session, t, can } = await pageContext("satis_firsat:read", "satis");

  const detail = await getDealDetail(session, id);
  if (!detail) notFound();
  const { deal, activities, quotes } = detail;
  const [stages, owners, companies, leads] = await Promise.all([
    listStages(session.tenantId),
    listOwnerOptions(session.tenantId),
    listCompanyOptions(session.tenantId),
    listLeadOptions(session),
  ]);

  const seeAll = canSeeAll(session);
  const canUpdate = session.permissions.has("satis_firsat:update");
  const canDelete = session.permissions.has("satis_firsat:delete");
  const canActivity = session.permissions.has("satis_aktivite:create");
  const canTaskUpdate = session.permissions.has("satis_aktivite:update");
  const canActivityDelete = session.permissions.has("satis_aktivite:delete");
  const editing = one(query, "duzenle") === "1" && canUpdate;
  const errorText = one(query, "hata");

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Başlık", type: "text", required: true },
    { name: "value", label: "Tutar (TL)", type: "text" },
    { name: "companyId", label: "Firma", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
    { name: "leadId", label: t("lead"), type: "select", options: [...leads, ...(deal.leadId && !leads.some((l) => l.id === deal.leadId) ? [{ id: deal.leadId, name: deal.leadName ?? "Aday" }] : [])].map((l) => ({ value: l.id, label: l.name })) },
    ...(seeAll ? [{ name: "ownerUserId", label: "Sahip", type: "select" as const, options: owners.map((o) => ({ value: o.id, label: o.name })) }] : []),
    { name: "expectedCloseDate", label: "Beklenen kapanış", type: "date" },
    { name: "note", label: "Not", type: "textarea", wide: true },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={deal.title}
        description={`${Number(deal.value).toLocaleString("tr-TR")} ${deal.currency === "TRY" ? "TL" : deal.currency}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STAGE_TONE[deal.stageKind]}>{deal.stageLabel}</Badge>
            <Link href="/satis/pipeline" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
              Pipeline'a dön
            </Link>
          </div>
        }
      />

      {errorText ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p> : null}

      {editing ? (
        <EntityForm
          action={saveDealAction}
          fields={fields}
          values={{
            ...deal,
            value: deal.value,
            expectedCloseDate: deal.expectedCloseAt ? istanbulDayKey(deal.expectedCloseAt) : "",
            ownerUserId: deal.ownerUserId,
          }}
          idValue={deal.id}
          openLabel="Düzenle"
          alwaysOpen
        />
      ) : (
        <Card className="p-4">
          <dl className="grid gap-4 sm:grid-cols-3 text-sm">
            <div><dt className="text-xs text-neutral-500">Firma</dt><dd className="mt-0.5">{deal.companyId ? <Link href={`/crm/firmalar/${deal.companyId}`} className="hover:underline">{deal.companyName}</Link> : "—"}</dd></div>
            <div><dt className="text-xs text-neutral-500">{t("lead")}</dt><dd className="mt-0.5">{deal.leadId ? <Link href={`/satis/adaylar/${deal.leadId}`} className="hover:underline">{deal.leadName}</Link> : "—"}</dd></div>
            <div><dt className="text-xs text-neutral-500">Sahip</dt><dd className="mt-0.5">{deal.ownerName ?? "Sahipsiz"}</dd></div>
            <div><dt className="text-xs text-neutral-500">Beklenen kapanış</dt><dd className="mt-0.5">{formatDate(deal.expectedCloseAt)}</dd></div>
            <div><dt className="text-xs text-neutral-500">Kapanış</dt><dd className="mt-0.5">{deal.closedAt ? formatDate(deal.closedAt) : "—"}</dd></div>
            <div><dt className="text-xs text-neutral-500">Oluşturma</dt><dd className="mt-0.5">{formatDateTime(deal.createdAt)}</dd></div>
          </dl>
          {deal.lostReason ? <p className="mt-3 text-sm"><span className="text-xs text-neutral-500">Kayıp nedeni: </span>{deal.lostReason}</p> : null}
          {deal.note ? <p className="mt-3 whitespace-pre-wrap text-sm">{deal.note}</p> : null}
          {canUpdate ? (
            <div className="mt-4">
              <Link href={`/satis/pipeline/${deal.id}?duzenle=1`} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">Düzenle</Link>
            </div>
          ) : null}
        </Card>
      )}

      {canUpdate ? (
        <Card className="p-4">
          <form action={moveDealFormAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="dealId" value={deal.id} />
            <label className="text-xs text-neutral-600">
              Aşama
              <select name="stageId" defaultValue={deal.stageId} className={`${inputClass} mt-1`}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-60 flex-1 text-xs text-neutral-600">
              Kaybedildiyse neden
              <input name="lostReason" placeholder="Yalnız 'kaybedildi' aşamasında gerekir" className={`${inputClass} mt-1`} />
            </label>
            <Button type="submit">Aşamayı değiştir</Button>
            {canDelete ? (
              <Button type="submit" variant="danger" formAction={deleteDealAction} name="id" value={deal.id}>Fırsatı sil</Button>
            ) : null}
          </form>
        </Card>
      ) : null}

      {can("satis.teklif") ? (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Teklifler</h2>
          {quotes.length === 0 ? (
            <p className="text-sm text-neutral-500">Bu fırsat için teklif yok.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between py-2">
                  <Link href={`/satis/teklifler/${q.id}`} className="font-medium hover:underline">{q.number} · {q.title}</Link>
                  <span className="flex items-center gap-2 text-xs text-neutral-500">
                    {Number(q.total).toLocaleString("tr-TR")} {q.currency === "TRY" ? "TL" : q.currency}
                    <Badge>{QUOTE_LABEL[q.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card className="space-y-4 p-4">
        <h2 className="text-sm font-semibold">Hareketler ve görevler</h2>
        {canActivity ? <ActivityForm dealId={deal.id} owners={owners} canAssign={seeAll} /> : null}
        {activities.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz hareket yok.</p>
        ) : (
          <ul className="space-y-2">
            {activities.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-neutral-400">{formatDateTime(a.createdAt)}</span>
                <span className="flex-1">
                  <span className="mr-2 text-xs text-neutral-500">{a.isSystem ? "Sistem" : ACTIVITY_LABEL[a.type]}</span>
                  <span className={a.type === "task" && a.doneAt ? "text-neutral-400 line-through" : ""}>{a.subject}</span>
                  {a.type === "task" ? (
                    <span className="ml-2 text-xs text-neutral-500">
                      {a.dueAt ? `vade ${formatDateTime(a.dueAt)}` : "vadesiz"}{a.assigneeName ? ` · ${a.assigneeName}` : ""}
                    </span>
                  ) : null}
                  {a.note ? <span className="block text-xs text-neutral-500">{a.note}</span> : null}
                </span>
                <span className="flex gap-1">
                  {a.type === "task" && canTaskUpdate ? (
                    <form action={completeTaskAction}>
                      <input type="hidden" name="id" value={a.id} />
                      {a.doneAt ? <input type="hidden" name="reopen" value="1" /> : null}
                      <Button type="submit" variant="ghost">{a.doneAt ? "Yeniden aç" : "Tamamla"}</Button>
                    </form>
                  ) : null}
                  {!a.isSystem && canActivityDelete ? (
                    <form action={deleteActivityAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" variant="danger">Sil</Button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
