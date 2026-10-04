import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { formatTRY } from "@/lib/money";
import { pageContext } from "@/lib/page-context";
import { formatDate, isExpiringSoon } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import {
  addVehicleCompanyAction,
  removeVehicleCompanyAction,
} from "@/modules/filo/actions";
import { vehicleCompanyNames, vehicleDetail } from "@/modules/filo/queries";
import { saveFiloRecordAction } from "@/modules/filo/records/actions";

const RESULT_TONE: Record<string, string> = {
  bekliyor: "warn",
  gecti: "ok",
  sartli: "info",
  kaldi: "bad",
};

const STATUS_LABEL: Record<string, string> = {
  aktif: "Aktif",
  bakimda: "Bakımda",
  pasif: "Pasif",
};

export default async function AracDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, t } = await pageContext("araclar:read", "filo");

  const detail = await vehicleDetail(session.tenantId, id);
  if (!detail) notFound();

  const [extraCompanies, firmalar] = await Promise.all([
    vehicleCompanyNames(session.tenantId, id),
    companyOptions(session.tenantId, session.scope),
  ]);

  const { vehicle, documents, maintenance, inspections } = detail;
  const canWrite = session.permissions.has("araclar:update");
  const expiring = documents.filter((d) => d.expiresOn && isExpiringSoon(d.expiresOn, 30));

  const docFields: readonly FieldSpec[] = [
    { name: "docType", label: "Belge Tipi", type: "text", required: true, hint: "ruhsat, muayene, K belgesi…" },
    { name: "label", label: "Açıklama", type: "text" },
    { name: "issuedOn", label: "Veriliş", type: "date" },
    { name: "expiresOn", label: "Bitiş", type: "date" },
    { name: "notes", label: "Not", type: "textarea", wide: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={vehicle.plate}
        description={[vehicle.brand, vehicle.model, vehicle.modelYear ? String(vehicle.modelYear) : null]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={vehicle.status === "aktif" ? "ok" : vehicle.status === "bakimda" ? "warn" : "mute"}>
              {STATUS_LABEL[vehicle.status]}
            </Badge>
            <Link
              href={`/filo/araclar?duzenle=${vehicle.id}`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
            >
              Düzenle
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: t("customer"), value: vehicle.companyName ?? "—" },
          { label: "Kapasite", value: vehicle.capacity ?? "—" },
          { label: "Tip", value: vehicle.vehicleType ?? "—" },
          { label: "Ruhsat Sahibi", value: vehicle.titleHolder ?? "—" },
        ].map((tile) => (
          <Card key={tile.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 truncate text-lg font-medium">{tile.value}</p>
          </Card>
        ))}
      </div>

      {expiring.length > 0 ? (
        <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {expiring.length} belgenin süresi 30 gün içinde doluyor ya da dolmuş:{" "}
          {expiring.map((d) => d.docType).join(", ")}
        </Card>
      ) : null}

      <PageHeader
        title="Firma Atamaları"
        description="Araç birden çok firmaya hizmet edebilir"
      />
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone="info">{vehicle.companyName ?? "Ana firma yok"}</Badge>
          {extraCompanies.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <Badge>{c.name}</Badge>
              {canWrite ? (
                <form action={removeVehicleCompanyAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="vehicleId" value={id} />
                  <button type="submit" className="text-xs text-neutral-400 hover:text-red-600">
                    ×
                  </button>
                </form>
              ) : null}
            </span>
          ))}
          {extraCompanies.length === 0 ? (
            <span className="text-xs text-neutral-500">Ek firma atanmamış.</span>
          ) : null}
        </div>

        {canWrite ? (
          <form action={addVehicleCompanyAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="vehicleId" value={id} />
            <select
              name="companyId"
              required
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {firmalar
                .filter(
                  (f) => f.id !== vehicle.companyId && !extraCompanies.some((e) => e.companyId === f.id),
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <Button type="submit">Firma Ekle</Button>
          </form>
        ) : null}
      </Card>

      <PageHeader
        title="Belgeler"
        description={`${documents.length} belge`}
        action={
          canWrite ? (
            <EntityForm
              action={saveFiloRecordAction}
              fields={docFields}
              extraHidden={{ kayit: "belgeler", vehicleId: id }}
              openLabel="Belge Ekle"
            />
          ) : null
        }
      />
      <Table head={["Tip", "Açıklama", "Veriliş", "Bitiş"]}>
        {documents.length === 0 ? (
          <EmptyRow colSpan={4} text="Araç belgesi henüz eklenmemiş" />
        ) : (
          documents.map((d) => (
            <tr key={d.id} className="hover:bg-neutral-50">
              <Td className="font-medium">{d.docType}</Td>
              <Td className="text-neutral-500">{d.label ?? "—"}</Td>
              <Td className="text-neutral-500">{d.issuedOn ? formatDate(d.issuedOn) : "—"}</Td>
              <Td>
                {d.expiresOn ? (
                  isExpiringSoon(d.expiresOn, 30) ? (
                    <Badge tone="bad">{formatDate(d.expiresOn)}</Badge>
                  ) : (
                    formatDate(d.expiresOn)
                  )
                ) : (
                  "—"
                )}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Son Bakımlar" />
      <Table head={["Tarih", "Tip", "KM", "Tutar", "Durum"]}>
        {maintenance.length === 0 ? (
          <EmptyRow colSpan={5} text="Bakım kaydı yok." />
        ) : (
          maintenance.map((m) => (
            <tr key={m.id} className="hover:bg-neutral-50">
              <Td>{formatDate(m.maintenanceDate)}</Td>
              <Td className="font-medium">{m.type}</Td>
              <Td className="text-neutral-500">{m.kmAtService?.toLocaleString("tr-TR") ?? "—"}</Td>
              <Td>{m.cost ? formatTRY(m.cost) : "—"}</Td>
              <Td className="text-neutral-500">{m.status}</Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Son Denetimler" />
      <Table head={["Tarih", "Tip", "Sonuç"]}>
        {inspections.length === 0 ? (
          <EmptyRow colSpan={3} text="Hiç denetlenmedi" />
        ) : (
          inspections.map((i) => (
            <tr key={i.id} className="hover:bg-neutral-50">
              <Td>{formatDate(i.inspectionDate)}</Td>
              <Td className="font-medium">{i.type}</Td>
              <Td>
                <Badge tone={RESULT_TONE[i.result]}>{i.result}</Badge>
              </Td>
            </tr>
          ))
        )}
      </Table>
    </div>
  );
}
