import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td } from "@/components/ui";
import { EntityForm, type FieldSpec } from "@/components/ui/entity-form";
import { pageContext } from "@/lib/page-context";
import { formatDate, isExpiringSoon } from "@/lib/time";
import {
  deleteDriverDocumentAction,
  saveDriverDocumentAction,
} from "@/modules/filo/actions";
import { getDriver, listDriverDocuments } from "@/modules/filo/queries";
import { listDriverEvaluations, listDriverRecords } from "@/modules/isbirligi/queries";

const DOC_FIELDS: readonly FieldSpec[] = [
  { name: "docType", label: "Belge Tipi", type: "text", required: true, hint: "ehliyet, SRC, psikoteknik, sağlık" },
  { name: "label", label: "Açıklama", type: "text" },
  { name: "issuedOn", label: "Veriliş", type: "date" },
  { name: "expiresOn", label: "Bitiş", type: "date" },
  { name: "notes", label: "Not", type: "textarea", wide: true },
];

const SEVERITY_TONE: Record<number, string> = { 1: "mute", 2: "info", 3: "warn", 4: "warn", 5: "bad" };

export default async function SurucuDetayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, t } = await pageContext("suruculer:read", "filo");

  const driver = await getDriver(session.tenantId, id);
  if (!driver) notFound();

  const [documents, records, evaluations] = await Promise.all([
    listDriverDocuments(session.tenantId, id),
    listDriverRecords(session.tenantId, id),
    listDriverEvaluations(session.tenantId, id),
  ]);

  const canWrite = session.permissions.has("suruculer:update");
  const average =
    evaluations.length > 0
      ? (
          evaluations.reduce((sum, e) => sum + Number(e.ortalama), 0) / evaluations.length
        ).toFixed(2)
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={driver.fullName}
        description={[driver.phone, driver.licenseClass].filter(Boolean).join(" · ")}
        action={
          <Link
            href={`/filo/suruculer?duzenle=${driver.id}`}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
          >
            Düzenle
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Ehliyet Sınıfı", value: driver.licenseClass ?? "—" },
          {
            label: "Ehliyet Geçerlilik",
            value: driver.licenseExpiry ? formatDate(driver.licenseExpiry) : "—",
            alert: driver.licenseExpiry ? isExpiringSoon(driver.licenseExpiry, 30) : false,
          },
          { label: "Sicil Kaydı", value: records.length, alert: records.length > 0 },
          { label: "Ortalama Puan", value: average ?? "—" },
        ].map((tile) => (
          <Card key={tile.label} className={`p-4 ${tile.alert ? "border-amber-300 bg-amber-50" : ""}`}>
            <p className="text-xs uppercase tracking-wide text-neutral-500">{tile.label}</p>
            <p className="mt-1 text-lg font-medium">{tile.value}</p>
          </Card>
        ))}
      </div>

      <PageHeader
        title="Sürücü Belgeleri"
        description={`${documents.length} belge`}
        action={
          canWrite ? (
            <EntityForm
              action={saveDriverDocumentAction}
              fields={DOC_FIELDS}
              extraHidden={{ driverId: id }}
              openLabel="Belge Ekle"
            />
          ) : null
        }
      />
      <Table head={["Tip", "Açıklama", "Veriliş", "Bitiş", ""]}>
        {documents.length === 0 ? (
          <EmptyRow colSpan={5} text="Sürücü belgesi henüz eklenmemiş" />
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
              <Td>
                {canWrite ? (
                  <form action={deleteDriverDocumentAction} className="flex justify-end">
                    <input type="hidden" name="id" value={d.id} />
                    <input type="hidden" name="driverId" value={id} />
                    <Button type="submit" variant="danger">
                      Sil
                    </Button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Sicil" description={`${records.length} kayıt`} />
      <Table head={["Tarih", t("asset"), "Kategori", "Ağırlık", "Açıklama"]}>
        {records.length === 0 ? (
          <EmptyRow colSpan={5} text="Sicil kaydı yok." />
        ) : (
          records.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50">
              <Td>{formatDate(r.incidentDate)}</Td>
              <Td className="text-neutral-500">{r.plate ?? "—"}</Td>
              <Td>{r.category}</Td>
              <Td>
                <Badge tone={SEVERITY_TONE[r.severity] ?? "mute"}>{r.severity}</Badge>
              </Td>
              <Td className="max-w-md truncate">{r.description}</Td>
            </tr>
          ))
        )}
      </Table>

      <PageHeader title="Değerlendirmeler" />
      <Table head={["Tarih", "Dakiklik", "Sürüş", "İletişim", "Temizlik", "Uyum", "Görünüm", "Ortalama"]}>
        {evaluations.length === 0 ? (
          <EmptyRow colSpan={8} text="Değerlendirme bekleniyor" />
        ) : (
          evaluations.map((e) => {
            const avg = Number(e.ortalama);
            return (
              <tr key={e.id} className="hover:bg-neutral-50">
                <Td>{formatDate(e.evaluationDate)}</Td>
                <Td>{e.punctuality}</Td>
                <Td>{e.driving}</Td>
                <Td>{e.communication}</Td>
                <Td>{e.cleanliness}</Td>
                <Td>{e.routeCompliance}</Td>
                <Td>{e.appearance}</Td>
                <Td>
                  <Badge tone={avg >= 4 ? "ok" : avg >= 3 ? "warn" : "bad"}>{e.ortalama}</Badge>
                </Td>
              </tr>
            );
          })
        )}
      </Table>
    </div>
  );
}
