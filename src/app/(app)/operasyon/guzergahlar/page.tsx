import Link from "next/link";
import {
  Badge,
  Button,
  EmptyRow,
  Field,
  FilterBar,
  PageHeader,
  Pagination,
  Table,
  Td,
  inputClass,
} from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import { deleteRouteAction, saveRouteAction } from "@/modules/operasyon/guzergah/actions";
import { getRoute, listRoutes } from "@/modules/operasyon/guzergah/queries";

const DIRECTIONS = [
  { value: "gidis", label: "Gidiş" },
  { value: "donus", label: "Dönüş" },
  { value: "ikisi", label: "Gidiş-Dönüş" },
] as const;

export default async function GuzergahlarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("guzergahlar:read", "operasyon");

  const filter = {
    q: one(params, "q"),
    companyId: one(params, "firma"),
    durum: one(params, "durum"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };
  const [{ rows, total, page, pageCount }, firmalar, araclar] = await Promise.all([
    listRoutes(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getRoute(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "name", label: "Güzergah Adı", type: "text", required: true },
    { name: "code", label: "Kod", type: "text" },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "direction", label: "Yön", type: "select", options: DIRECTIONS },
    { name: "shiftName", label: "Vardiya", type: "text" },
    { name: "capacity", label: "Kapasite", type: "number" },
    { name: "morningDeparture", label: "Sabah Kalkış", type: "time" },
    { name: "morningArrival", label: "Sabah Varış", type: "time" },
    { name: "eveningDeparture", label: "Akşam Kalkış", type: "time" },
    { name: "eveningArrival", label: "Akşam Varış", type: "time" },
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    { name: "distanceKm", label: "Mesafe (km)", type: "text" },
    { name: "durationMin", label: "Süre (dk)", type: "number" },
    { name: "notes", label: "Not", type: "textarea", wide: true },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  const canWrite = session.permissions.has("guzergahlar:create");
  const canDelete = session.permissions.has("guzergahlar:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Güzergahlar"
        description={`${total} hat`}
        action={
          canWrite ? (
            <EntityForm
              action={saveRouteAction}
              fields={fields}
              values={editing ?? { isActive: true, direction: "ikisi" }}
              idValue={editing?.id}
              openLabel="Yeni Güzergah"
            />
          ) : null
        }
      />

      <FilterBar action="/operasyon/guzergahlar">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ad veya kod" className={inputClass} />
        </Field>
        <Field label={t("customer")}>
          <select name="firma" defaultValue={filter.companyId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {firmalar.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.durum ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["Güzergah", t("customer"), "Yön", "Vardiya", "Kapasite", t("asset"), t("staff"), ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                <Link href={`/operasyon/guzergahlar/${r.id}`} className="hover:underline">
                  {r.name}
                </Link>
                {r.code ? <span className="ml-2 text-xs text-neutral-400">{r.code}</span> : null}
                {r.isActive ? null : <Badge tone="mute">pasif</Badge>}
              </Td>
              <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
              <Td>{DIRECTIONS.find((d) => d.value === r.direction)?.label ?? r.direction}</Td>
              <Td className="text-neutral-500">{r.shiftName ?? "—"}</Td>
              <Td className="text-neutral-500">{r.capacity ?? "—"}</Td>
              <Td>{r.plate ?? <span className="text-neutral-400">atanmadı</span>}</Td>
              <Td className="text-neutral-500">{r.driverName ?? "—"}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/operasyon/guzergahlar?duzenle=${r.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteRouteAction}>
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

      <Pagination
        basePath="/operasyon/guzergahlar"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, firma: filter.companyId, durum: filter.durum }}
      />
    </div>
  );
}
