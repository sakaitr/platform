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
import { formatDate, isExpiringSoon } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { deleteDriverAction, saveDriverAction } from "@/modules/filo/actions";
import { getDriver, listDrivers } from "@/modules/filo/queries";

const STATUS = [
  { value: "aktif", label: "Aktif" },
  { value: "izinli", label: "İzinli" },
  { value: "pasif", label: "Pasif" },
] as const;

const STATUS_TONE: Record<string, string> = { aktif: "ok", izinli: "warn", pasif: "mute" };

export default async function SurucülerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("suruculer:read", "filo");

  const filter = {
    q: one(params, "q"),
    status: one(params, "durum"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };
  const [{ rows, total, page, pageCount }, firmalar] = await Promise.all([
    listDrivers(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getDriver(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "fullName", label: "Ad Soyad", type: "text", required: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "phone", label: "Telefon", type: "tel" },
    { name: "idNumber", label: "TC Kimlik No", type: "text" },
    { name: "licenseClass", label: "Ehliyet Sınıfı", type: "text", hint: "B, D, E…" },
    { name: "licenseExpiry", label: "Ehliyet Bitiş", type: "date" },
    { name: "status", label: "Durum", type: "select", options: STATUS },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  const canWrite = session.permissions.has("suruculer:create");
  const canDelete = session.permissions.has("suruculer:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("staff_plural")}
        description={`${total} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={saveDriverAction}
              fields={fields}
              values={editing ?? undefined}
              idValue={editing?.id}
              openLabel={`Yeni ${t("staff")}`}
            />
          ) : null
        }
      />

      <FilterBar action="/filo/suruculer">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ad, telefon" className={inputClass} />
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
      </FilterBar>

      <Table head={["Ad Soyad", t("customer"), "Telefon", "Ehliyet", "Bitiş", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} />
        ) : (
          rows.map((d) => (
            <tr key={d.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{d.fullName}</Td>
              <Td className="text-neutral-500">{d.companyName ?? "—"}</Td>
              <Td className="text-neutral-500">{d.phone ?? "—"}</Td>
              <Td className="text-neutral-500">{d.licenseClass ?? "—"}</Td>
              <Td>
                {d.licenseExpiry ? (
                  isExpiringSoon(d.licenseExpiry, 30) ? (
                    <Badge tone="bad">{formatDate(d.licenseExpiry)}</Badge>
                  ) : (
                    formatDate(d.licenseExpiry)
                  )
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[d.status]}>
                  {STATUS.find((s) => s.value === d.status)?.label ?? d.status}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/filo/suruculer?duzenle=${d.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteDriverAction}>
                      <input type="hidden" name="id" value={d.id} />
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
        basePath="/filo/suruculer"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, durum: filter.status }}
      />
    </div>
  );
}
