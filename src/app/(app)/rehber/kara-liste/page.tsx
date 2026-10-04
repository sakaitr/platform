import { Badge, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { saveBlacklistAction } from "@/modules/isbirligi/actions";
import { listBlacklist } from "@/modules/isbirligi/queries";

const FIELDS: readonly FieldSpec[] = [
  { name: "fullName", label: "Ad Soyad", type: "text" },
  { name: "plate", label: "Plaka", type: "text" },
  { name: "idNumber", label: "TC Kimlik No", type: "text" },
  { name: "addedOn", label: "Tarih", type: "date", required: true },
  { name: "reason", label: "Gerekçe", type: "textarea", required: true, wide: true },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

export default async function KaraListePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session } = await pageContext("notlar:read", "gorevler");

  const durum = one(params, "durum");
  const active = durum === "aktif" ? true : durum === "pasif" ? false : undefined;
  const rows = await listBlacklist(session.tenantId, active);

  const canWrite = session.permissions.has("notlar:create");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kara Liste"
        description="Bir daha çalışılmayacak kişi ve araçlar"
        action={
          canWrite ? (
            <EntityForm
              action={saveBlacklistAction}
              fields={FIELDS}
              values={{ addedOn: istanbulDayKey(), isActive: true }}
              openLabel="Yeni Kayıt"
            />
          ) : null
        }
      />

      <FilterBar action="/rehber/kara-liste">
        <Field label="Durum">
          <select name="durum" defaultValue={durum ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="aktif">Aktif</option>
            <option value="pasif">Kaldırılmış</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["Ad Soyad", "Plaka", "TC", "Gerekçe", "Tarih", "Durum"]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6} text="Kayıt yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.fullName ?? "—"}</Td>
              <Td>{r.plate ?? "—"}</Td>
              <Td className="text-neutral-500">{r.idNumber ?? "—"}</Td>
              <Td className="max-w-md truncate">{r.reason}</Td>
              <Td>{formatDate(r.addedOn)}</Td>
              <Td>
                <Badge tone={r.isActive ? "bad" : "mute"}>{r.isActive ? "Aktif" : "Kaldırıldı"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
