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
import { deletePassengerAction, savePassengerAction } from "@/modules/operasyon/yolcular/actions";
import { getPassenger, listPassengers } from "@/modules/operasyon/yolcular/queries";

const TYPES = [
  { value: "yolcu", label: "Yolcu" },
  { value: "personel", label: "Personel" },
  { value: "musteri", label: "Müşteri" },
] as const;

const SERVICE = [
  { value: "aktif", label: "Aktif" },
  { value: "pasif", label: "Pasif" },
  { value: "askida", label: "Askıda" },
] as const;

const SERVICE_TONE: Record<string, string> = { aktif: "ok", askida: "warn", pasif: "mute" };

export default async function YolcularPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("yolcular:read", "operasyon");

  const filter = {
    q: one(params, "q"),
    companyId: one(params, "firma"),
    type: one(params, "tip"),
    durum: one(params, "durum"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };
  const [{ rows, total, page, pageCount }, firmalar] = await Promise.all([
    listPassengers(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
  ]);
  const editingId = one(params, "duzenle");
  const editing = editingId ? await getPassenger(session.tenantId, editingId) : null;

  const fields: readonly FieldSpec[] = [
    { name: "fullName", label: "Ad Soyad", type: "text", required: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "type", label: "Tip", type: "select", options: TYPES },
    { name: "phone", label: "Telefon", type: "tel" },
    { name: "idNumber", label: "TC / Pasaport", type: "text" },
    { name: "email", label: "E-posta", type: "email" },
    { name: "grade", label: "Sınıf", type: "text", hint: "Okul taşımacılığında kullanılır" },
    { name: "branch", label: "Şube", type: "text" },
    { name: "barcode", label: "Barkod No", type: "text" },
    { name: "serviceStatus", label: "Hizmet Durumu", type: "select", options: SERVICE },
    { name: "pickupAddress", label: "Biniş Adresi", type: "textarea", wide: true },
    { name: "dropoffAddress", label: "İniş Adresi", type: "textarea", wide: true },
    { name: "notes", label: "Not", type: "textarea", wide: true },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  const canWrite = session.permissions.has("yolcular:create");
  const canDelete = session.permissions.has("yolcular:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Yolcular"
        description={`${total} kayıt`}
        action={
          canWrite ? (
            <EntityForm
              action={savePassengerAction}
              fields={fields}
              values={editing ?? { isActive: true }}
              idValue={editing?.id}
              openLabel="Yeni Kayıt"
            />
          ) : null
        }
      />

      <FilterBar action="/operasyon/yolcular">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ad, telefon, TC, barkod" className={inputClass} />
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
        <Field label="Tip">
          <select name="tip" defaultValue={filter.type ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
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

      <Table head={["Ad Soyad", t("customer"), "Tip", "Telefon", "Sınıf/Şube", "Hizmet", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} />
        ) : (
          rows.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                {p.fullName}
                {p.isActive ? null : <span className="ml-2 text-xs text-neutral-400">pasif</span>}
              </Td>
              <Td className="text-neutral-500">{p.companyName ?? "—"}</Td>
              <Td>{TYPES.find((x) => x.value === p.type)?.label ?? p.type}</Td>
              <Td className="text-neutral-500">{p.phone ?? "—"}</Td>
              <Td className="text-neutral-500">
                {[p.grade, p.branch].filter(Boolean).join(" / ") || "—"}
              </Td>
              <Td>
                <Badge tone={SERVICE_TONE[p.serviceStatus]}>
                  {SERVICE.find((s) => s.value === p.serviceStatus)?.label ?? p.serviceStatus}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canWrite ? (
                    <a
                      href={`/operasyon/yolcular?duzenle=${p.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  ) : null}
                  {canDelete ? (
                    <form action={deletePassengerAction}>
                      <input type="hidden" name="id" value={p.id} />
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
        basePath="/operasyon/yolcular"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, firma: filter.companyId, tip: filter.type, durum: filter.durum }}
      />
    </div>
  );
}
