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
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { deleteCompanyAction, saveCompanyAction } from "@/modules/crm/actions";
import { getCompany, listCompanies } from "@/modules/crm/queries";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";

const TYPE_OPTIONS = [
  { value: "musteri", label: "Müşteri" },
  { value: "tedarikci", label: "Tedarikçi" },
  { value: "isleten", label: "İşleten" },
  { value: "diger", label: "Diğer" },
] as const;

const COMPANY_FIELDS: readonly FieldSpec[] = [
  { name: "name", label: "Ünvan", type: "text", required: true },
  { name: "code", label: "Kod", type: "text" },
  { name: "type", label: "Tip", type: "select", options: TYPE_OPTIONS },
  { name: "taxNumber", label: "Vergi No", type: "text" },
  { name: "taxOffice", label: "Vergi Dairesi", type: "text" },
  { name: "phone", label: "Telefon", type: "tel" },
  { name: "email", label: "E-posta", type: "email" },
  { name: "address", label: "Adres", type: "text", wide: true },
  { name: "isActive", label: "Aktif", type: "checkbox" },
];

const TYPE_LABEL: Record<string, string> = {
  musteri: "Müşteri",
  tedarikci: "Tedarikçi",
  isleten: "İşleten",
  diger: "Diğer",
};

export default async function FirmalarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("firmalar:read", "crm");

  const label = t("customer");
  const filter = {
    q: one(params, "q"),
    type: one(params, "tip"),
    durum: one(params, "durum"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };
  const { rows, total, page, pageCount } = await listCompanies(session.tenantId, filter);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getCompany(session.tenantId, editingId) : null;

  const canWrite = session.permissions.has("firmalar:create");
  const canDelete = session.permissions.has("firmalar:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("customer_plural")}
        description={`${total} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={saveCompanyAction}
              fields={COMPANY_FIELDS}
              values={editing ?? { isActive: true }}
              idValue={editing?.id}
              openLabel={`Yeni ${label}`}
            />
          ) : null
        }
      />

      <FilterBar action="/crm/firmalar">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ünvan, kod, vergi no" className={inputClass} />
        </Field>
        <Field label="Tip">
          <select name="tip" defaultValue={filter.type ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
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

      <Table head={["Ünvan", "Kod", "Tip", "Telefon", "Vergi No", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} />
        ) : (
          rows.map((c) => (
            <tr key={c.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{c.name}</Td>
              <Td className="text-neutral-500">{c.code ?? "—"}</Td>
              <Td>{TYPE_LABEL[c.type] ?? c.type}</Td>
              <Td className="text-neutral-500">{c.phone ?? "—"}</Td>
              <Td className="text-neutral-500">{c.taxNumber ?? "—"}</Td>
              <Td>
                <Badge tone={c.isActive ? "ok" : "mute"}>{c.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/crm/firmalar?duzenle=${c.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deleteCompanyAction}>
                      <input type="hidden" name="id" value={c.id} />
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
        basePath="/crm/firmalar"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, tip: filter.type, durum: filter.durum }}
      />
    </div>
  );
}
