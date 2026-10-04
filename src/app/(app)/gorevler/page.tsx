import {
  Badge,
  Button,
  EmptyRow,
  Field,
  FilterBar,
  PageHeader,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { listUsers } from "@/modules/admin/queries";
import { deleteTaskAction, saveTaskAction, setTaskStatusAction } from "@/modules/isbirligi/actions";
import { getTask, listTasks, taskStats } from "@/modules/isbirligi/queries";
import { TaskStatsPanel } from "./stats";

const STATUS = [
  { value: "yapilacak", label: "Yapılacak" },
  { value: "yapiliyor", label: "Yapılıyor" },
  { value: "bekliyor", label: "Beklemede" },
  { value: "bitti", label: "Bitti" },
] as const;

const STATUS_TONE: Record<string, string> = {
  yapilacak: "mute",
  yapiliyor: "info",
  bekliyor: "warn",
  bitti: "ok",
};

const PRIORITY = [
  { value: "dusuk", label: "Düşük" },
  { value: "normal", label: "Normal" },
  { value: "yuksek", label: "Yüksek" },
  { value: "kritik", label: "Kritik" },
] as const;

const PRIORITY_TONE: Record<string, string> = {
  dusuk: "mute",
  normal: "info",
  yuksek: "warn",
  kritik: "bad",
};

export default async function GorevlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("gorevler:read", "gorevler");

  const filter = {
    status: one(params, "durum"),
    assignedTo: one(params, "kisi"),
    priority: one(params, "oncelik"),
  };
  const [rows, kullanicilar, firmalar, stats] = await Promise.all([
    listTasks(session.tenantId, filter),
    listUsers(session.tenantId),
    companyOptions(session.tenantId, session.scope),
    taskStats(session.tenantId),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getTask(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Başlık", type: "text", required: true, wide: true },
    { name: "status", label: "Durum", type: "select", options: STATUS },
    { name: "priority", label: "Öncelik", type: "select", options: PRIORITY },
    {
      name: "assignedTo",
      label: "Atanan",
      type: "select",
      options: kullanicilar.map((u) => ({ value: u.id, label: u.name })),
    },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "dueDate", label: "Son Tarih", type: "date" },
    { name: "description", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("gorevler:create");
  const canDelete = session.permissions.has("gorevler:delete");
  const today = istanbulDayKey();
  const overdue = rows.filter((r) => r.dueDate && r.dueDate < today && r.status !== "bitti").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Görevler"
        description={`${rows.length} görev${overdue > 0 ? ` · ${overdue} gecikmiş` : ""}`}
        action={
          canWrite ? (
            <EntityForm
              action={saveTaskAction}
              fields={fields}
              values={editing ?? { status: "yapilacak", priority: "normal" }}
              idValue={editing?.id}
              openLabel="Yeni Görev"
            />
          ) : null
        }
      />

      <TaskStatsPanel stats={stats} />

      <FilterBar action="/gorevler">
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Atanan">
          <select name="kisi" defaultValue={filter.assignedTo ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {kullanicilar.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Öncelik">
          <select name="oncelik" defaultValue={filter.priority ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {PRIORITY.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Görev", "Atanan", t("customer"), "Öncelik", "Son Tarih", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Görev yok." />
        ) : (
          rows.map((r) => {
            const late = r.dueDate && r.dueDate < today && r.status !== "bitti";
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="font-medium">{r.title}</Td>
                <Td className="text-neutral-500">{r.assigneeName ?? "atanmadı"}</Td>
                <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
                <Td>
                  <Badge tone={PRIORITY_TONE[r.priority]}>
                    {PRIORITY.find((p) => p.value === r.priority)?.label}
                  </Badge>
                </Td>
                <Td>
                  {r.dueDate ? (
                    late ? (
                      <Badge tone="bad">{formatDate(r.dueDate)}</Badge>
                    ) : (
                      formatDate(r.dueDate)
                    )
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  {canWrite ? (
                    <form action={setTaskStatusAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <select
                        name="status"
                        defaultValue={r.status}
                        className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
                      >
                        {STATUS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="ml-1 text-xs text-neutral-500 hover:underline">
                        değiştir
                      </button>
                    </form>
                  ) : (
                    <Badge tone={STATUS_TONE[r.status]}>
                      {STATUS.find((s) => s.value === r.status)?.label}
                    </Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {canWrite ? (
                      <a
                        href={`/gorevler?duzenle=${r.id}`}
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                      >
                        Düzenle
                      </a>
                    ) : null}
                    {canDelete ? (
                      <form action={deleteTaskAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="danger">
                          Sil
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
