import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { formatDate, istanbulDayKey, shiftDay } from "@/lib/time";
import { listUsers } from "@/modules/admin/queries";
import { addResponsibleAction, removeResponsibleAction } from "@/modules/crm/actions";
import { companyDetail } from "@/modules/crm/queries";
import { saveShiftAction } from "@/modules/operasyon/guzergah/actions";
import { delayMinutes } from "@/modules/operasyon/arrivals/queries";

const RESULT_TONE: Record<string, string> = {
  bekliyor: "warn",
  gecti: "ok",
  sartli: "info",
  kaldi: "bad",
};

export default async function FirmaDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, t } = await pageContext("firmalar:read", "crm");

  const today = istanbulDayKey();
  const detail = await companyDetail(session.tenantId, id, shiftDay(today, -30));
  if (!detail) notFound();

  const kullanicilar = await listUsers(session.tenantId);
  const { company, responsibles, shifts, fleet, recentArrivals, monthlyArrivals, lastInspection } =
    detail;

  const canWrite = session.permissions.has("firmalar:update");
  const atanmamis = kullanicilar.filter((u) => !responsibles.some((r) => r.userId === u.id));

  const shiftFields: readonly FieldSpec[] = [
    { name: "name", label: "Vardiya Adı", type: "text", required: true },
    { name: "expectedAt", label: "Beklenen Saat", type: "time", required: true },
    { name: "toleranceLate", label: "Geç (dk)", type: "number" },
    { name: "toleranceEarly", label: "Erken (dk)", type: "number" },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        description={[company.code, company.taxNumber, company.phone].filter(Boolean).join(" · ")}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={company.isActive ? "ok" : "mute"}>
              {company.isActive ? "Aktif" : "Pasif"}
            </Badge>
            <Link
              href={`/crm/firmalar?duzenle=${company.id}`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
            >
              Düzenle
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: `Aktif ${t("asset")}`, value: fleet.filter((v) => v.status === "aktif").length },
          { label: "Toplam Giriş (30 gün)", value: monthlyArrivals },
          { label: "Vardiya", value: shifts.length },
          {
            label: "Son Denetim",
            value: lastInspection ? formatDate(lastInspection.date) : "Hiç denetlenmedi",
          },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-lg font-medium">{tile.value}</p>
          </Card>
        ))}
      </div>

      <PageHeader title="Sorumlular" description="Bu firmadan sorumlu ekip üyeleri" />
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {responsibles.length === 0 ? (
            <span className="text-xs text-neutral-500">Henüz sorumlu atanmamış</span>
          ) : (
            responsibles.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-1">
                <Badge tone="info">{r.name}</Badge>
                {canWrite ? (
                  <form action={removeResponsibleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="companyId" value={id} />
                    <button type="submit" className="text-xs text-neutral-400 hover:text-red-600">
                      ×
                    </button>
                  </form>
                ) : null}
              </span>
            ))
          )}
        </div>
        {canWrite && atanmamis.length > 0 ? (
          <form action={addResponsibleAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="companyId" value={id} />
            <select
              name="userId"
              required
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {atanmamis.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <Button type="submit">Sorumlu Ata</Button>
          </form>
        ) : null}
      </Card>

      <PageHeader
        title="Vardiya Saatleri"
        description="Giriş kontroldeki planlanan saatin kaynağı"
        action={
          canWrite ? (
            <EntityForm
              action={saveShiftAction}
              fields={shiftFields}
              values={{ isActive: true, toleranceLate: 10, toleranceEarly: 15 }}
              extraHidden={{ companyId: id }}
              openLabel="Vardiya Ekle"
            />
          ) : null
        }
      />
      <Table head={["Vardiya", "Beklenen", "Geç (dk)", "Erken (dk)", "Durum"]}>
        {shifts.length === 0 ? (
          <EmptyRow colSpan={5} text="Henüz vardiya tanımlanmamış" />
        ) : (
          shifts.map((s) => (
            <tr key={s.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{s.name}</Td>
              <Td>{s.expectedAt}</Td>
              <Td className="text-neutral-500">{s.toleranceLate}</Td>
              <Td className="text-neutral-500">{s.toleranceEarly}</Td>
              <Td>
                <Badge tone={s.isActive ? "ok" : "mute"}>{s.isActive ? "Aktif" : "Pasif"}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title={t("asset_plural")} description={`${fleet.length} araç`} />
      <Table head={["Plaka", "Marka / Model", "Kapasite", "Durum"]}>
        {fleet.length === 0 ? (
          <EmptyRow colSpan={4} text="Bu firmaya ait araç yok" />
        ) : (
          fleet.map((v) => (
            <tr key={v.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                <Link href={`/filo/araclar/${v.id}`} className="hover:underline">
                  {v.plate}
                </Link>
              </Td>
              <Td>{[v.brand, v.model].filter(Boolean).join(" ") || "—"}</Td>
              <Td className="text-neutral-500">{v.capacity ?? "—"}</Td>
              <Td>
                <Badge tone={v.status === "aktif" ? "ok" : v.status === "bakimda" ? "warn" : "mute"}>
                  {v.status}
                </Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Giriş Geçmişi (Son 20)" />
      <Table head={["Tarih", "Plaka", "Vardiya", "Geliş", "Planlanan", "Durum"]}>
        {recentArrivals.length === 0 ? (
          <EmptyRow colSpan={6} text="Giriş kaydı yok" />
        ) : (
          recentArrivals.map((a) => {
            const delay = delayMinutes(a.plannedAt, a.arrivedAt);
            return (
              <tr key={a.id} className="hover:bg-neutral-50">
                <Td>{formatDate(a.arrivalDate)}</Td>
                <Td className="font-medium">{a.plate}</Td>
                <Td>{a.shift}</Td>
                <Td className="font-medium">{a.arrivedAt}</Td>
                <Td className="text-neutral-500">{a.plannedAt ?? "—"}</Td>
                <Td>
                  {delay === null ? (
                    <span className="text-neutral-400">—</span>
                  ) : delay > 0 ? (
                    <Badge tone="bad">{delay} dk geç</Badge>
                  ) : (
                    <Badge tone="ok">zamanında</Badge>
                  )}
                </Td>
              </tr>
            );
          })
        )}
      </Table>

      {lastInspection ? (
        <p className="text-xs text-neutral-500">
          Son denetim: {formatDate(lastInspection.date)} ·{" "}
          <Badge tone={RESULT_TONE[lastInspection.result]}>{lastInspection.result}</Badge>
        </p>
      ) : null}
    </div>
  );
}
