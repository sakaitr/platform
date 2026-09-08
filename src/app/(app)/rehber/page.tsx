import { Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { companyOptions } from "@/modules/crm/queries";
import { deleteContactAction, saveContactAction } from "@/modules/isbirligi/actions";
import { listContacts } from "@/modules/isbirligi/queries";

export default async function RehberPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("notlar:read", "gorevler");

  const q = one(params, "q");
  const [rows, firmalar] = await Promise.all([
    listContacts(session.tenantId, q),
    companyOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    { name: "name", label: "Ad", type: "text", required: true },
    { name: "category", label: "Kategori", type: "text", hint: "hastane, jandarma, servis…" },
    { name: "title", label: "Görev / Ünvan", type: "text" },
    { name: "phone", label: "Telefon", type: "tel" },
    { name: "email", label: "E-posta", type: "email" },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("notlar:create");
  const canDelete = session.permissions.has("notlar:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rehber"
        description={`${rows.length} kayıt`}
        action={canWrite ? <EntityForm action={saveContactAction} fields={fields} openLabel="Yeni Kayıt" /> : null}
      />

      <FilterBar action="/rehber">
        <Field label="Ara">
          <input name="q" defaultValue={q ?? ""} placeholder="Ad, telefon, kategori" className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={["Ad", "Kategori", "Görev", "Telefon", "E-posta", t("customer"), ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} text="Kayıt yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-neutral-500">{r.category ?? "—"}</Td>
              <Td className="text-neutral-500">{r.title ?? "—"}</Td>
              <Td>{r.phone ?? "—"}</Td>
              <Td className="text-neutral-500">{r.email ?? "—"}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td>
                {canDelete ? (
                  <form action={deleteContactAction} className="flex justify-end">
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" variant="danger">
                      Sil
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
