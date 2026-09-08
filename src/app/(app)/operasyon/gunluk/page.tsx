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
import { formatDate, formatDateTime, istanbulDayKey, shiftDay } from "@/lib/time";
import { listUsers } from "@/modules/admin/queries";
import {
  deleteQuestionAction,
  saveQuestionAction,
} from "@/modules/operasyon/gunluk/actions";
import {
  getEntry,
  listEntriesRange,
  listQuestions,
  participation,
} from "@/modules/operasyon/gunluk/queries";
import { DailyForm } from "./daily-form";

const TYPES = [
  { value: "evet_hayir", label: "Evet / Hayır" },
  { value: "metin", label: "Kısa metin" },
  { value: "uzun_metin", label: "Uzun metin" },
  { value: "secim", label: "Tek seçim" },
  { value: "checklist", label: "Çoklu seçim" },
] as const;

const QUESTION_FIELDS: readonly FieldSpec[] = [
  { name: "label", label: "Soru", type: "text", required: true, wide: true },
  { name: "type", label: "Tip", type: "select", options: TYPES },
  { name: "position", label: "Sıra", type: "number" },
  {
    name: "options",
    label: "Seçenekler",
    type: "textarea",
    wide: true,
    hint: "Yalnız tek/çoklu seçimde. Her satır bir seçenek.",
  },
  { name: "required", label: "Zorunlu", type: "checkbox" },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function GunlukPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("gunluk:read", "operasyon");

  const today = istanbulDayKey();
  const from = one(params, "baslangic") ?? shiftDay(today, -6);
  const to = one(params, "bitis") ?? today;
  const kisi = one(params, "kisi");
  const canManage = session.permissions.has("gunluk:update");

  const [questions, entry, entries, katilim, kullanicilar] = await Promise.all([
    listQuestions(session.tenantId, true),
    getEntry(session.tenantId, session.userId, today),
    canManage ? listEntriesRange(session.tenantId, { from, to, userId: kisi }) : Promise.resolve([]),
    canManage ? participation(session.tenantId, from, to) : Promise.resolve([]),
    canManage ? listUsers(session.tenantId) : Promise.resolve([]),
  ]);
  const allQuestions = canManage ? await listQuestions(session.tenantId) : [];
  const labelOf = new Map(allQuestions.map((q) => [q.id, q.label]));

  return (
    <div className="space-y-6">
      <PageHeader title="Günlük" description={`${formatDate(istanbulDayKey())} check-in`} />

      <DailyForm
        questions={questions}
        answers={(entry?.answers as Record<string, unknown>) ?? undefined}
        note={entry?.note}
        alreadyFilled={Boolean(entry)}
      />

      {canManage ? (
        <>
          <PageHeader
            title="Sorular"
            description={`${allQuestions.length} tanım`}
            action={
              <EntityForm
                action={saveQuestionAction}
                fields={QUESTION_FIELDS}
                values={{ required: true, isActive: true }}
                openLabel="Yeni Soru"
              />
            }
          />
          <Table head={["Soru", "Tip", "Sıra", "Zorunlu", "Durum", ""]}>
            {allQuestions.length === 0 ? (
              <EmptyRow colSpan={6} text="Soru tanımlanmamış." />
            ) : (
              allQuestions.map((q) => (
                <tr key={q.id} className="hover:bg-neutral-50">
                  <Td className="font-medium">{q.label}</Td>
                  <Td>{TYPES.find((x) => x.value === q.type)?.label ?? q.type}</Td>
                  <Td className="text-neutral-500">{q.position}</Td>
                  <Td>{q.required ? "Evet" : "Hayır"}</Td>
                  <Td>
                    <Badge tone={q.isActive ? "ok" : "mute"}>{q.isActive ? "Aktif" : "Pasif"}</Badge>
                  </Td>
                  <Td>
                    <form action={deleteQuestionAction} className="flex justify-end">
                      <input type="hidden" name="id" value={q.id} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))
            )}
          </Table>

          <PageHeader
            title="Katılım"
            description={`${formatDate(from)} – ${formatDate(to)}`}
          />
          <Table head={["Kişi", "Doldurulan", "Eksik", "Oran", "Son Kayıt"]}>
            {katilim.length === 0 ? (
              <EmptyRow colSpan={5} text="Kullanıcı yok." />
            ) : (
              katilim.map((k) => (
                <tr key={k.kisi} className="hover:bg-neutral-50">
                  <Td className="font-medium">{k.kisi}</Td>
                  <Td>{k.doldurulan}</Td>
                  <Td>
                    {k.eksik > 0 ? <Badge tone="warn">{k.eksik}</Badge> : <span className="text-neutral-400">0</span>}
                  </Td>
                  <Td>%{k.oran}</Td>
                  <Td className="text-neutral-500">{k.sonKayit ? formatDate(k.sonKayit) : "hiç"}</Td>
                </tr>
              ))
            )}
          </Table>

          <FilterBar action="/operasyon/gunluk">
            <Field label="Başlangıç">
              <input type="date" name="baslangic" defaultValue={from} className={inputClass} />
            </Field>
            <Field label="Bitiş">
              <input type="date" name="bitis" defaultValue={to} className={inputClass} />
            </Field>
            <Field label="Kişi">
              <select name="kisi" defaultValue={kisi ?? ""} className={inputClass}>
                <option value="">Tümü</option>
                {kullanicilar.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </FilterBar>

          <PageHeader title="Gelen Kayıtlar" description={`${entries.length} kayıt`} />
          <Table head={["Tarih", "Kişi", "Cevaplar", "Not", "Zaman"]}>
            {entries.length === 0 ? (
              <EmptyRow colSpan={5} text="Bu aralıkta kayıt bulunamadı" />
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-50">
                  <Td>{formatDate(e.entryDate)}</Td>
                  <Td className="font-medium">{e.userName}</Td>
                  <td className="px-4 py-2.5 text-xs text-neutral-600">
                    {Object.entries((e.answers as Record<string, unknown>) ?? {}).map(([qid, value]) => (
                      <div key={qid}>
                        <span className="text-neutral-400">{labelOf.get(qid) ?? qid}: </span>
                        {Array.isArray(value) ? value.join(", ") : String(value)}
                      </div>
                    ))}
                  </td>
                  <Td className="max-w-xs truncate text-neutral-500">{e.note ?? "—"}</Td>
                  <Td className="text-neutral-500">{formatDateTime(e.createdAt)}</Td>
                </tr>
              ))
            )}
          </Table>
        </>
      ) : null}
    </div>
  );
}
