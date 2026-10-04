import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { listUsers } from "@/modules/admin/queries";
import { closeSuggestionAction, saveSuggestionAction } from "@/modules/isbirligi/actions";
import { listSuggestions } from "@/modules/isbirligi/queries";

const KINDS = [
  { value: "oneri", label: "Öneri" },
  { value: "talep", label: "Talep" },
  { value: "sikayet", label: "Şikâyet" },
  { value: "istek", label: "İstek" },
] as const;

const TONE: Record<string, string> = { oneri: "info", talep: "mute", sikayet: "bad", istek: "warn" };

export default async function OnerilerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("oneriler:read", "destek");

  const durum = one(params, "durum");
  const open = durum === "acik" ? true : durum === "kapali" ? false : undefined;
  const [rows, kullanicilar] = await Promise.all([
    listSuggestions(session.tenantId, open),
    listUsers(session.tenantId),
  ]);

  const fields: readonly FieldSpec[] = [
    { name: "title", label: "Başlık", type: "text", required: true, wide: true },
    { name: "kind", label: "Tür", type: "select", options: KINDS },
    {
      name: "assignedTo",
      label: "Atanan",
      type: "select",
      options: kullanicilar.map((u) => ({ value: u.id, label: u.name })),
    },
    { name: "description", label: "Açıklama", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("oneriler:create");
  const canClose = session.permissions.has("oneriler:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Öneri ve Şikâyetler"
        description={`${rows.length} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={saveSuggestionAction}
              fields={fields}
              values={{ kind: "oneri" }}
              openLabel="Yeni Kayıt"
            />
          ) : null
        }
      />

      <FilterBar action="/oneriler">
        <Field label="Durum">
          <select name="durum" defaultValue={durum ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="acik">Açık</option>
            <option value="kapali">Kapalı</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["No", "Başlık", "Tür", "Atanan", "Tarih", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Kayıt yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.documentNo ?? "—"}</Td>
              <Td className="max-w-md truncate">{r.title}</Td>
              <Td>
                <Badge tone={TONE[r.kind]}>{KINDS.find((k) => k.value === r.kind)?.label}</Badge>
              </Td>
              <Td className="text-neutral-500">{r.assigneeName ?? "—"}</Td>
              <Td className="text-neutral-500">{formatDate(r.createdAt)}</Td>
              <Td>
                <Badge tone={r.isOpen ? "warn" : "ok"}>{r.isOpen ? "Açık" : "Kapalı"}</Badge>
              </Td>
              <Td>
                {r.isOpen && canClose ? (
                  <form action={closeSuggestionAction} className="flex justify-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="ghost">
                      Kapat
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
