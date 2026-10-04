import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { saveCategoryAction } from "@/modules/muhasebe/actions";
import { listCategories } from "@/modules/muhasebe/queries";

const FIELDS: readonly FieldSpec[] = [
  { name: "name", label: "Kategori Adı", type: "text", required: true },
  {
    name: "kind",
    label: "Tür",
    type: "select",
    required: true,
    options: [
      { value: "gider", label: "Gider" },
      { value: "gelir", label: "Gelir" },
    ],
  },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function KategorilerPage() {
  const { session } = await pageContext("finans_gider:read", "muhasebe");
  const rows = await listCategories(session.tenantId);
  const canWrite = session.permissions.has("finans_gider:update");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gelir / Gider Kategorileri"
        description={`${rows.length} kategori`}
        action={
          canWrite ? (
            <EntityForm
              action={saveCategoryAction}
              fields={FIELDS}
              values={{ isActive: true, kind: "gider" }}
              openLabel="Yeni Kategori"
            />
          ) : null
        }
      />

      <Table head={["Kategori", "Tür", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={3} text="Kategori tanımlanmamış." />
        ) : (
          rows.map((c) => (
            <tr key={c.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{c.name}</Td>
              <Td>
                <Badge tone={c.kind === "gelir" ? "ok" : "bad"}>
                  {c.kind === "gelir" ? "Gelir" : "Gider"}
                </Badge>
              </Td>
              <Td>
                <Badge tone={c.isActive ? "ok" : "mute"}>{c.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
