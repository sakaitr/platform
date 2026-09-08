import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, formatDateTime, istanbulDayKey } from "@/lib/time";
import {
  deleteQuestionAction,
  saveQuestionAction,
} from "@/modules/operasyon/gunluk/actions";
import { getEntry, listEntries, listQuestions } from "@/modules/operasyon/gunluk/queries";
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

  const day = one(params, "tarih") ?? istanbulDayKey();
  const canManage = session.permissions.has("gunluk:update");

  const [questions, entry, entries] = await Promise.all([
    listQuestions(session.tenantId, true),
    getEntry(session.tenantId, session.userId, istanbulDayKey()),
    canManage ? listEntries(session.tenantId, day) : Promise.resolve([]),
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

          <PageHeader title="Gelen Kayıtlar" description={formatDate(day)} />
          <Table head={["Kişi", "Cevaplar", "Not", "Zaman"]}>
            {entries.length === 0 ? (
              <EmptyRow colSpan={4} text="Bu tarihte kayıt yok." />
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="hover:bg-neutral-50">
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
