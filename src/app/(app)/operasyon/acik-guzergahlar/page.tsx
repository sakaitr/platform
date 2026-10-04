import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { deleteOpenRouteAction, saveOpenRouteAction } from "@/modules/operasyon/guzergah/actions";
import { getOpenRoute, listOpenRoutes } from "@/modules/operasyon/guzergah/queries";

const STATUS = [
  { value: "acik", label: "Açık" },
  { value: "fiyatlandi", label: "Fiyatlandı" },
  { value: "kapandi", label: "Kapandı" },
] as const;

const TONE: Record<string, string> = { acik: "warn", fiyatlandi: "info", kapandi: "mute" };

export default async function AcikGuzergahlarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("guzergahlar:read", "operasyon");

  const durum = one(params, "durum");
  const [rows, firmalar] = await Promise.all([
    listOpenRoutes(session.tenantId, { durum, scope: session.scope }),
    companyOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getOpenRoute(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "name", label: "Güzergah Adı", type: "text", required: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "distanceKm", label: "Mesafe (km)", type: "text" },
    { name: "durationMin", label: "Süre (dk)", type: "number" },
    { name: "price", label: "Fiyat (₺)", type: "text" },
    { name: "status", label: "Durum", type: "select", options: STATUS },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("guzergahlar:create");
  const canDelete = session.permissions.has("guzergahlar:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Açık Güzergahlar"
        description="Araç ve fiyat bağlanmamış talepler"
        action={
          canWrite ? (
            <EntityForm
              action={saveOpenRouteAction}
              fields={fields}
              values={editing ?? { status: "acik" }}
              idValue={editing?.id}
              openLabel="Yeni Talep"
            />
          ) : null
        }
      />

      <FilterBar action="/operasyon/acik-guzergahlar">
        <Field label="Durum">
          <select name="durum" defaultValue={durum ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Güzergah", t("customer"), "Mesafe", "Süre", "Fiyat", "Durum", "Açılış", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Açık talep yok." />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.distanceKm ? `${r.distanceKm} km` : "—"}</Td>
              <Td className="text-neutral-500">{r.durationMin ? `${r.durationMin} dk` : "—"}</Td>
              <Td>{r.price ? `${r.price} ₺` : "—"}</Td>
              <Td>
                <Badge tone={TONE[r.status]}>{STATUS.find((s) => s.value === r.status)?.label}</Badge>
              </Td>
              <Td className="text-neutral-500">{formatDate(r.createdAt)}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/operasyon/acik-guzergahlar?duzenle=${r.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteOpenRouteAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="danger">
                        Sil
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
