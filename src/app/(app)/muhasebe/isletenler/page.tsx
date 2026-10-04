import { redirect } from "next/navigation";
import { Badge, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, isExpiringSoon, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import {
  assignVehicleOperatorAction,
  saveCompanyFinanceAction,
} from "@/modules/muhasebe/actions";
import {
  getCompanyFinance,
  listOperators,
  listVehicleOperators,
} from "@/modules/muhasebe/queries";

const POLICY_LABEL: Record<string, string> = {
  tum_araclar: "Tüm araçlar",
  sadece_ozmal: "Sadece özmal",
  uygulanmasin: "Uygulanmasın",
};

export default async function IsletenlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("isletenler:read", "muhasebe");
  if (!can("muhasebe.hakedis")) redirect("/muhasebe/hareketler");

  const [operators, assignments, firmalar, araclar] = await Promise.all([
    listOperators(session.tenantId, session.scope),
    listVehicleOperators(session.tenantId),
    companyOptions(session.tenantId, session.scope),
    vehicleOptions(session.tenantId, session.scope),
  ]);

  const editingId = one(params, "duzenle");
  const editing = editingId ? await getCompanyFinance(session.tenantId, editingId) : null;

  const financeFields: readonly FieldSpec[] = [
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      required: true,
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "accountCode", label: "Cari Kod", type: "text" },
    { name: "idNumber", label: "TC Kimlik No", type: "text" },
    { name: "bankName", label: "Banka", type: "text" },
    { name: "bankBranch", label: "Şube", type: "text" },
    { name: "iban", label: "IBAN", type: "text", wide: true },
    { name: "contractStart", label: "Sözleşme Başlangıcı", type: "date" },
    { name: "contractEnd", label: "Sözleşme Bitişi", type: "date" },
    {
      name: "withholdingPolicy",
      label: "Tevkifat",
      type: "select",
      options: Object.entries(POLICY_LABEL).map(([value, label]) => ({ value, label })),
    },
    { name: "fuelCreditRate", label: "Yakıt Kredisi (%)", type: "text" },
    { name: "notes", label: "Not", type: "textarea", wide: true },
    { name: "isPrimaryOperator", label: "Ana işleten", type: "checkbox" },
    { name: "isDriver", label: "Sürücü", type: "checkbox" },
    { name: "isTitleHolder", label: "Ruhsat sahibi", type: "checkbox" },
  ];

  const assignFields: readonly FieldSpec[] = [
    {
      name: "vehicleId",
      label: t("asset"),
      type: "select",
      required: true,
      options: araclar.map((v) => ({ value: v.id, label: v.plate })),
    },
    {
      name: "operatorId",
      label: "İşleten",
      type: "select",
      required: true,
      options: operators.map((o) => ({ value: o.id, label: o.name })),
    },
    { name: "startsOn", label: "Başlangıç", type: "date", required: true },
    { name: "notes", label: "Açıklama", type: "text", wide: true },
  ];

  const canWrite = session.permissions.has("isletenler:update");

  return (
    <div className="space-y-6">
      <PageHeader
        title="İşletenler"
        description={`${operators.length} işleten · hakediş bu kayıtlara göre hesaplanır`}
        action={
          canWrite ? (
            <EntityForm
              action={saveCompanyFinanceAction}
              fields={financeFields}
              values={editing ?? { withholdingPolicy: "tum_araclar" }}
              openLabel="Mali Bilgi Ekle"
            />
          ) : null
        }
      />

      <Table head={["İşleten", "Cari Kod", "Tevkifat", "IBAN", "Sözleşme Bitişi", "Durum", ""]}>
        {operators.length === 0 ? (
          <EmptyRow colSpan={7} text="Henüz işleten tanımlanmamış." />
        ) : (
          operators.map((o) => (
            <tr key={o.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{o.name}</Td>
              <Td className="text-neutral-500">{o.accountCode ?? "—"}</Td>
              <Td className="text-neutral-500">
                {POLICY_LABEL[o.withholdingPolicy ?? ""] ?? "—"}
              </Td>
              <Td className="text-neutral-500">{o.iban ?? "—"}</Td>
              <Td>
                {o.contractEnd ? (
                  isExpiringSoon(o.contractEnd, 60) ? (
                    <Badge tone="bad">{formatDate(o.contractEnd)}</Badge>
                  ) : (
                    formatDate(o.contractEnd)
                  )
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                <Badge tone={o.isActive ? "ok" : "mute"}>{o.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
              <Td>
                {canWrite ? (
                  <div className="flex justify-end">
                    <a
                      href={`/muhasebe/isletenler?duzenle=${o.id}`}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </a>
                  </div>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader
        title="Araç – İşleten Atamaları"
        description="Bir araç aynı anda tek işletene bağlı olur; yeni atama öncekini kapatır."
        action={
          canWrite ? (
            <EntityForm
              action={assignVehicleOperatorAction}
              fields={assignFields}
              values={{ startsOn: istanbulDayKey() }}
              openLabel="Araç Bağla"
            />
          ) : null
        }
      />

      <Table head={[t("asset"), "İşleten", "Başlangıç", "Bitiş", "İşlem"]}>
        {assignments.length === 0 ? (
          <EmptyRow colSpan={5} text="Atama yok." />
        ) : (
          assignments.map((a) => (
            <tr key={a.id} className={a.endsOn === null ? "bg-emerald-50/40" : "hover:bg-neutral-50"}>
              <Td className="font-medium">{a.plate}</Td>
              <Td>{a.operatorName}</Td>
              <Td>{formatDate(a.startsOn)}</Td>
              <Td>{a.endsOn ? formatDate(a.endsOn) : <Badge tone="ok">güncel</Badge>}</Td>
              <Td className="text-neutral-500">{a.kind}</Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
