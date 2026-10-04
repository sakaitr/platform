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
import { deleteVehicleAction, saveVehicleAction } from "@/modules/filo/actions";
import { getVehicle, listVehicles } from "@/modules/filo/queries";

const STATUS = [
  { value: "aktif", label: "Aktif" },
  { value: "bakimda", label: "Bakımda" },
  { value: "pasif", label: "Pasif" },
] as const;

const STATUS_TONE: Record<string, string> = { aktif: "ok", bakimda: "warn", pasif: "mute" };

export default async function AraclarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("araclar:read", "filo");

  const filter = {
    q: one(params, "q"),
    companyId: one(params, "firma"),
    status: one(params, "durum"),
    sirala: one(params, "sirala"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };
  const [{ rows, total, page, pageCount }, firmalar] = await Promise.all([
    listVehicles(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getVehicle(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "plate", label: "Plaka", type: "text", required: true, placeholder: "34ABC123" },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "brand", label: "Marka", type: "text" },
    { name: "model", label: "Model", type: "text" },
    { name: "modelYear", label: "Model Yılı", type: "number" },
    { name: "capacity", label: "Koltuk Kapasitesi", type: "number" },
    { name: "vehicleType", label: "Araç Tipi", type: "text", hint: "Otobüs, minibüs, binek…" },
    { name: "titleHolder", label: "Ruhsat Sahibi", type: "text" },
    { name: "status", label: "Durum", type: "select", options: STATUS },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("araclar:create");
  const canDelete = session.permissions.has("araclar:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("asset_plural")}
        description={`${total} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={saveVehicleAction}
              fields={fields}
              values={editing ?? undefined}
              idValue={editing?.id}
              openLabel={`Yeni ${t("asset")}`}
            />
          ) : null
        }
      />

      <FilterBar action="/filo/araclar">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Plaka, marka, model" className={inputClass} />
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
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sırala">
          <select name="sirala" defaultValue={filter.sirala ?? "plaka"} className={inputClass}>
            <option value="plaka">Plakaya göre</option>
            <option value="firma">Firmaya göre</option>
            <option value="marka">Markaya göre</option>
            <option value="kapasite">Kapasiteye göre</option>
          </select>
        </Field>
      </FilterBar>

      <Table head={["Plaka", t("customer"), "Marka / Model", "Yıl", "Kapasite", "Ruhsat Sahibi", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} />
        ) : (
          rows.map((v) => (
            <tr key={v.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                <Link href={`/filo/araclar/${v.id}`} className="hover:underline">
                  {v.plate}
                </Link>
              </Td>
              <Td className="text-neutral-500">{v.companyName ?? "—"}</Td>
              <Td>{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</Td>
              <Td className="text-neutral-500">{v.modelYear ?? "—"}</Td>
              <Td className="text-neutral-500">{v.capacity ?? "—"}</Td>
              <Td className="text-neutral-500">{v.titleHolder ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS_TONE[v.status]}>
                  {STATUS.find((s) => s.value === v.status)?.label ?? v.status}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/filo/araclar?duzenle=${v.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteVehicleAction}>
                      <input type="hidden" name="id" value={v.id} />
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
        basePath="/filo/araclar"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, firma: filter.companyId, durum: filter.status, sirala: filter.sirala }}
      />
    </div>
  );
}
