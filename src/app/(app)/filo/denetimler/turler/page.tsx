import { Badge, Button, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import {
  deleteCriterionAction,
  saveCriterionAction,
  saveInspectionTypeAction,
} from "@/modules/filo/denetim/actions";
import { listAllCriteria, listInspectionTypes } from "@/modules/filo/denetim/queries";

const TYPE_FIELDS: readonly FieldSpec[] = [
  { name: "label", label: "Tür Adı", type: "text", required: true, hint: "Günlük Araç Kontrolü" },
  { name: "code", label: "Kod", type: "text", required: true, hint: "gunluk_kontrol" },
  { name: "position", label: "Sıra", type: "number" },
];

export default async function DenetimTurleriPage() {
  const { session } = await pageContext("denetimler:read", "filo");

  const [types, criteria] = await Promise.all([
    listInspectionTypes(session.tenantId),
    listAllCriteria(session.tenantId),
  ]);

  const canWrite = session.permissions.has("denetimler:update");
  const criterionFields: readonly FieldSpec[] = [
    {
      name: "typeId",
      label: "Denetim Türü",
      type: "select",
      required: true,
      options: types.map((t) => ({ value: t.id, label: t.label })),
    },
    { name: "label", label: "Kriter", type: "text", required: true, wide: true },
    { name: "position", label: "Sıra", type: "number" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Denetim Türleri"
        description="Sihirbaz bu kriterleri sırayla sorar"
        action={
          canWrite ? (
            <EntityForm action={saveInspectionTypeAction} fields={TYPE_FIELDS} openLabel="Yeni Tür" />
          ) : null
        }
      />

      <Table head={["Tür", "Kod", "Kriter", "Sıra", "Durum"]}>
        {types.length === 0 ? (
          <EmptyRow colSpan={5} text="Tür tanımlanmamış." />
        ) : (
          types.map((t) => (
            <tr key={t.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{t.label}</Td>
              <Td className="text-neutral-500">{t.code}</Td>
              <Td>{criteria.filter((c) => c.typeId === t.id).length}</Td>
              <Td className="text-neutral-500">{t.position}</Td>
              <Td>
                <Badge tone={t.isActive ? "ok" : "mute"}>{t.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader
        title="Kriterler"
        description={`${criteria.length} kriter`}
        action={
          canWrite && types.length > 0 ? (
            <EntityForm action={saveCriterionAction} fields={criterionFields} openLabel="Yeni Kriter" />
          ) : null
        }
      />

      <Table head={["Tür", "Kriter", "Sıra", "Durum", ""]}>
        {criteria.length === 0 ? (
          <EmptyRow colSpan={5} text="Kriter tanımlanmamış." />
        ) : (
          criteria.map((c) => (
            <tr key={c.id} className="hover:bg-neutral-50">
              <Td className="text-neutral-500">{c.typeLabel}</Td>
              <Td className="font-medium">{c.label}</Td>
              <Td className="text-neutral-500">{c.position}</Td>
              <Td>
                <Badge tone={c.isActive ? "ok" : "mute"}>{c.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                {canWrite ? (
                  <form action={deleteCriterionAction} className="flex justify-end">
                    <input type="hidden" name="id" value={c.id} />
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
