import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, EmptyRow, Field, FilterBar, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import {
  cloneRoutePlanAction,
  createRoutePlanAction,
  deleteRoutePlanAction,
} from "@/modules/operasyon/plan/actions";
import { listRoutePlans } from "@/modules/operasyon/plan/queries";

export const PLAN_STATUS: Record<string, string> = {
  taslak: "Taslak",
  yayinlandi: "Yayınlandı",
  aktif: "Aktif",
  arsiv: "Arşiv",
};

export const PLAN_TONE: Record<string, string> = {
  taslak: "mute",
  yayinlandi: "info",
  aktif: "ok",
  arsiv: "mute",
};

const DIRECTIONS = [
  { value: "gidis", label: "Gidiş" },
  { value: "donus", label: "Dönüş" },
  { value: "ikisi", label: "Gidiş-Dönüş" },
] as const;

export default async function RotaPlanlamaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t, can } = await pageContext("rota_planlama:read", "operasyon");
  if (!can("operasyon.rota_planlama")) redirect("/operasyon");

  const status = one(params, "durum");
  const [rows, firmalar] = await Promise.all([
    listRoutePlans(session.tenantId, status),
    companyOptions(session.tenantId, session.scope),
  ]);

  const fields: readonly FieldSpec[] = [
    { name: "name", label: "Plan Adı", type: "text", required: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "shiftName", label: "Vardiya", type: "text" },
    { name: "direction", label: "Yön", type: "select", options: DIRECTIONS },
  ];

  const canCreate = session.permissions.has("rota_planlama:create");
  const canDelete = session.permissions.has("rota_planlama:delete");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rota Planlama"
        description="Plan versiyonlanır; yalnız bir plan aktif olabilir"
        action={
          canCreate ? (
            <EntityForm
              action={createRoutePlanAction}
              fields={fields}
              values={{ direction: "gidis" }}
              openLabel="Yeni Plan"
            />
          ) : null
        }
      />

      <FilterBar action="/operasyon/rota-planlama">
        <Field label="Durum">
          <select name="durum" defaultValue={status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(PLAN_STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table head={["Plan", "Sürüm", t("customer"), "Vardiya", "Araç", "Yolcu", "Tarih", "Durum", ""]}>
        {rows.length === 0 ? (
          <EmptyRow colSpan={9} text="Plan yok." />
        ) : (
          rows.map((r) => {
            const metrics = (r.metrics ?? {}) as Record<string, number>;
            return (
              <tr key={r.id} className="hover:bg-neutral-50">
                <Td className="font-medium">
                  <Link href={`/operasyon/rota-planlama/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </Td>
                <Td className="text-neutral-500">v{r.versionNo}</Td>
                <Td className="text-neutral-500">{r.companyName ?? "—"}</Td>
                <Td className="text-neutral-500">{r.shiftName ?? "—"}</Td>
                <Td>{metrics.aracSayisi ?? "—"}</Td>
                <Td>{metrics.yolcuSayisi ?? "—"}</Td>
                <Td className="text-neutral-500">{formatDate(r.createdAt)}</Td>
                <Td>
                  <Badge tone={PLAN_TONE[r.status]}>{PLAN_STATUS[r.status]}</Badge>
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {canCreate ? (
                      <form action={cloneRoutePlanAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" variant="ghost">
                          Kopyala
                        </Button>
                      </form>
                    ) : null}
                    {canDelete && r.status !== "aktif" ? (
                      <form action={deleteRoutePlanAction}>
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
