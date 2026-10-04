import Link from "next/link";
import { Badge, Button, Card, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { vehicleOptions } from "@/modules/filo/queries";
import {
  createTaskFromInspectionAction,
  deleteInspectionAction,
} from "@/modules/filo/denetim/actions";
import {
  listCriteria,
  listInspectionTypes,
  listInspections,
  neverInspected,
} from "@/modules/filo/denetim/queries";
import { summarize, type CriterionAnswer } from "@/modules/filo/denetim/logic";
import { InspectionWizard } from "./wizard";

const RESULT = [
  { value: "bekliyor", label: "Bekliyor" },
  { value: "gecti", label: "Geçti" },
  { value: "sartli", label: "Şartlı" },
  { value: "kaldi", label: "Kaldı" },
] as const;

const TONE: Record<string, string> = { bekliyor: "mute", gecti: "ok", sartli: "warn", kaldi: "bad" };

export default async function DenetimlerPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("denetimler:read", "filo");

  const filter = {
    vehicleId: one(params, "arac"),
    companyId: one(params, "firma"),
    typeId: one(params, "tur"),
    result: one(params, "sonuc"),
    from: one(params, "baslangic"),
    to: one(params, "bitis"),
  };

  const [rows, types, araclar, firmalar, denetlenmemis] = await Promise.all([
    listInspections(session.tenantId, filter),
    listInspectionTypes(session.tenantId),
    vehicleOptions(session.tenantId, session.scope),
    companyOptions(session.tenantId, session.scope),
    neverInspected(session.tenantId),
  ]);

  // Sihirbaz kriterleri istemcide gezdiği için hepsini önden yüklüyoruz.
  const criteriaByType: Record<string, Array<{ id: string; label: string }>> = {};
  for (const type of types.filter((x) => x.isActive)) {
    const list = await listCriteria(session.tenantId, type.id);
    criteriaByType[type.id] = list.map((c) => ({ id: c.id, label: c.label }));
  }

  const canWrite = session.permissions.has("denetimler:create");
  const canApprove = session.permissions.has("denetimler:approve");
  const canDelete = session.permissions.has("denetimler:delete");

  const gecti = rows.filter((r) => r.result === "gecti").length;
  const oran = rows.length > 0 ? Math.round((gecti / rows.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Araç Denetimleri"
        description={`${rows.length} denetim · geçme oranı %${oran}`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            <Link
              href="/filo/denetimler/turler"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
            >
              Tür ve Kriterler
            </Link>
            {canWrite && types.length > 0 ? (
              <InspectionWizard
                vehicles={araclar.map((v) => ({ value: v.id, label: v.plate }))}
                types={types.filter((x) => x.isActive).map((x) => ({ value: x.id, label: x.label }))}
                companies={firmalar.map((f) => ({ value: f.id, label: f.name }))}
                criteriaByType={criteriaByType}
                today={istanbulDayKey()}
              />
            ) : null}
          </div>
        }
      />

      {types.length === 0 ? (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Denetim türü tanımlanmamış.{" "}
          <Link href="/filo/denetimler/turler" className="underline">
            Tür ve kriter tanımlayın
          </Link>{" "}
          — denetim ancak ondan sonra yapılabilir.
        </Card>
      ) : null}

      {denetlenmemis.length > 0 ? (
        <Card className="p-3 text-sm">
          <span className="font-medium">Hiç denetlenmedi:</span>{" "}
          <span className="text-neutral-600">
            {denetlenmemis.slice(0, 12).map((v) => v.plate).join(", ")}
            {denetlenmemis.length > 12 ? ` +${denetlenmemis.length - 12}` : ""}
          </span>
        </Card>
      ) : null}

      <FilterBar action="/filo/denetimler">
        <Field label={t("asset")}>
          <select name="arac" defaultValue={filter.vehicleId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {araclar.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tür">
          <select name="tur" defaultValue={filter.typeId ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sonuç">
          <select name="sonuc" defaultValue={filter.result ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {RESULT.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Başlangıç">
          <input type="date" name="baslangic" defaultValue={filter.from ?? ""} className={inputClass} />
        </Field>
        <Field label="Bitiş">
          <input type="date" name="bitis" defaultValue={filter.to ?? ""} className={inputClass} />
        </Field>
      </FilterBar>

      <Table head={["Tarih", t("asset"), "Tür", "Denetçi", "Özet", "Termin", "Sonuç", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8} text="Denetim kaydı bulunamadı" />
        ) : (
          rows.map((r) => {
            const answers = (r.checklist ?? []) as CriterionAnswer[];
            const s = summarize(answers);
            const eksik = s.red + s.kosullu;
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td>{formatDate(r.inspectionDate)}</Td>
                <Td className="font-medium">{r.plate}</Td>
                <Td>{r.typeLabel ?? r.type}</Td>
                <Td className="text-neutral-500">{r.inspectorName ?? "—"}</Td>
                <Td className="text-neutral-500">
                  {s.toplam > 0 ? `${s.onay}/${s.toplam} · %${s.basariOrani}` : "—"}
                </Td>
                <Td className="text-neutral-500">{r.deadline ? formatDate(r.deadline) : "—"}</Td>
                <Td>
                  <Badge tone={TONE[r.result]}>
                    {RESULT.find((x) => x.value === r.result)?.label ?? r.result}
                  </Badge>
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {canApprove && eksik > 0 ? (
                      <form action={createTaskFromInspectionAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="ghost">
                          Görev Oluştur
                        </Button>
                      </form>
                    ) : null}
                    {canDelete ? (
                      <form action={deleteInspectionAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="danger">
                          Sil
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
