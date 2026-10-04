import Link from "next/link";
import { Badge, Button, Card, Field, FilterBar, PageHeader, inputClass } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, formatDateTime } from "@/lib/time";
import { taskBucket, type TaskBucket } from "@/modules/satis/dates";
import { completeTaskAction } from "@/modules/satis/pipeline-actions";
import { listFollowUpLeads, listTasks } from "@/modules/satis/pipeline-queries";
import { listOwnerOptions } from "@/modules/satis/queries";
import { canSeeAll } from "@/modules/satis/visibility";

const BUCKETS: { key: TaskBucket; title: string; tone: string }[] = [
  { key: "overdue", title: "Geciken", tone: "bad" },
  { key: "today", title: "Bugün", tone: "warn" },
  { key: "upcoming", title: "Bu hafta", tone: "info" },
  { key: "later", title: "Daha sonra", tone: "mute" },
  { key: "none", title: "Vadesiz", tone: "mute" },
];

export default async function GorevlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("satis_aktivite:read", "satis");
  const seeAll = canSeeAll(session);
  const view = one(params, "gorunum") === "tamam" ? "tamam" : "acik";
  const assignee = one(params, "kisi") ?? "ben";

  const [tasks, followUps, owners] = await Promise.all([
    listTasks(session, { view, assignee }),
    view === "acik" ? listFollowUpLeads(session, assignee === "hepsi" && seeAll ? "hepsi" : "ben") : Promise.resolve([]),
    listOwnerOptions(session.tenantId),
  ]);
  const canComplete = session.permissions.has("satis_aktivite:update");

  const now = new Date();
  const grouped = new Map<TaskBucket, typeof tasks>();
  for (const task of tasks) {
    const key = view === "tamam" ? "none" : taskBucket(task.dueAt, now);
    grouped.set(key, [...(grouped.get(key) ?? []), task]);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Görevler"
        description={view === "acik" ? `${tasks.length} açık görev` : `Son 30 günde tamamlanan ${tasks.length} görev`}
      />

      <FilterBar action="/satis/gorevler">
        <Field label="Görünüm">
          <select name="gorunum" defaultValue={view} className={inputClass}>
            <option value="acik">Açık görevler</option>
            <option value="tamam">Tamamlananlar</option>
          </select>
        </Field>
        <Field label="Kişi">
          <select name="kisi" defaultValue={assignee} className={inputClass}>
            <option value="ben">Bana atananlar</option>
            <option value="sahipsiz">Sahipsiz</option>
            {seeAll ? <option value="hepsi">Hepsi</option> : null}
            {seeAll ? owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : null}
          </select>
        </Field>
      </FilterBar>

      {view === "acik" ? (
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Bugün aranacaklar</h2>
          {followUps.length === 0 ? (
            <p className="text-sm text-neutral-500">Takip tarihi bugün ya da geçmiş olan aday yok.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {followUps.map((lead) => (
                <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/satis/adaylar/${lead.id}`} className="font-medium hover:underline">{lead.name}</Link>
                    {lead.contactName ? <span className="text-neutral-500"> · {lead.contactName}</span> : null}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-neutral-500">
                    {lead.phone ? <a href={`tel:${lead.phone}`} className="hover:underline">{lead.phone}</a> : null}
                    <Badge tone={lead.followUpAt && lead.followUpAt.getTime() < Date.now() - 86_400_000 ? "bad" : "warn"}>
                      takip {formatDate(lead.followUpAt)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {BUCKETS.filter((b) => (view === "tamam" ? b.key === "none" : true)).map((bucket) => {
        const items = grouped.get(bucket.key) ?? [];
        if (items.length === 0 && view === "tamam") return null;
        return (
          <Card key={bucket.key} className="p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {view === "tamam" ? "Tamamlananlar" : bucket.title}
              <Badge tone={bucket.tone}>{items.length}</Badge>
            </h2>
            {items.length === 0 ? (
              <p className="text-sm text-neutral-500">Görev yok.</p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm">
                {items.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className={task.doneAt ? "text-neutral-400 line-through" : "font-medium"}>{task.subject}</span>
                      <span className="ml-2 text-xs text-neutral-500">
                        {task.leadId ? <Link href={`/satis/adaylar/${task.leadId}`} className="hover:underline">{task.leadName}</Link> : null}
                        {task.dealId ? <Link href={`/satis/pipeline/${task.dealId}`} className="hover:underline">{task.dealTitle}</Link> : null}
                      </span>
                      {task.note ? <span className="block text-xs text-neutral-500">{task.note}</span> : null}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-neutral-500">
                      {task.dueAt ? <span>{formatDateTime(task.dueAt)}</span> : null}
                      {task.assigneeName ? <span>{task.assigneeName}</span> : <span>Sahipsiz</span>}
                      {canComplete ? (
                        <form action={completeTaskAction}>
                          <input type="hidden" name="id" value={task.id} />
                          {task.doneAt ? <input type="hidden" name="reopen" value="1" /> : null}
                          <Button type="submit" variant="ghost">{task.doneAt ? "Yeniden aç" : "Tamamla"}</Button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
