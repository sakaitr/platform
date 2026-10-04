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
import { formatDate, istanbulDayKey } from "@/lib/time";
import { companyOptions } from "@/modules/crm/queries";
import { routeOptions } from "@/modules/operasyon/guzergah/queries";
import {
  deletePassengerAction,
  deleteServiceChangeAction,
  savePassengerAction,
  saveServiceChangeAction,
} from "@/modules/operasyon/yolcular/actions";
import {
  getPassenger,
  listPassengers,
  listPaymentPlans,
  listServiceChanges,
} from "@/modules/operasyon/yolcular/queries";
import { BulkPassengerForm } from "./bulk-form";

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

const CONTRACT = [
  { value: "yok", label: "Yok" },
  { value: "gonderildi", label: "Gönderildi" },
  { value: "imzalandi", label: "İmzalandı" },
] as const;

const CONTRACT_TONE: Record<string, string> = { yok: "mute", gonderildi: "warn", imzalandi: "ok" };

const DIRECTIONS = [
  { value: "her_iki", label: "Her İki Yön" },
  { value: "sabah", label: "Sadece Sabah" },
  { value: "aksam", label: "Sadece Akşam" },
] as const;

const SORTS = [
  { value: "ad", label: "Ada göre" },
  { value: "firma", label: "Firmaya göre" },
  { value: "tur", label: "Türe göre" },
  { value: "durum", label: "Duruma göre" },
] as const;

export default async function YolcularPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("yolcular:read", "operasyon");

  const filter = {
    q: one(params, "q"),
    companyId: one(params, "firma"),
    routeId: one(params, "guzergah"),
    type: one(params, "tip"),
    durum: one(params, "durum"),
    sirala: one(params, "sirala"),
    page: Number(one(params, "sayfa") ?? 1),
    scope: session.scope,
  };

  const [{ rows, total, page, pageCount }, firmalar, guzergahlar, planlar] = await Promise.all([
    listPassengers(session.tenantId, filter),
    companyOptions(session.tenantId, session.scope),
    routeOptions(session.tenantId, session.scope),
    listPaymentPlans(session.tenantId),
  ]);

  const editingId = one(params, "duzenle");
  const editing = editingId ? await getPassenger(session.tenantId, editingId) : null;
  const changesFor = one(params, "servis");
  const changes = changesFor ? await listServiceChanges(session.tenantId, changesFor) : [];

  const fields: readonly FieldSpec[] = [
    { name: "fullName", label: "Ad Soyad", type: "text", required: true },
    {
      name: "companyId",
      label: t("customer"),
      type: "select",
      options: firmalar.map((f) => ({ value: f.id, label: f.name })),
    },
    { name: "type", label: "Tür", type: "select", options: TYPES },
    {
      name: "routeId",
      label: "Güzergah",
      type: "select",
      options: guzergahlar.map((r) => ({ value: r.id, label: r.name })),
    },
    { name: "direction", label: "Yön", type: "select", options: DIRECTIONS },
    { name: "phone", label: "Telefon", type: "tel" },
    { name: "idNumber", label: "TC Kimlik / Pasaport No", type: "text" },
    { name: "email", label: "E-posta", type: "email" },
    { name: "grade", label: "Sınıf", type: "text" },
    { name: "branch", label: "Şube", type: "text" },
    { name: "barcode", label: "Barkod No", type: "text" },
    { name: "serviceStatus", label: "Hizmet Durumu", type: "select", options: SERVICE },
    { name: "contractStatus", label: "Sözleşme Durumu", type: "select", options: CONTRACT },
    {
      name: "paymentPlanId",
      label: "Ödeme Planı",
      type: "select",
      options: planlar.filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name })),
    },
    { name: "pickupAddress", label: "Alış Adresi / Noktası", type: "textarea", wide: true },
    { name: "pickupLat", label: "Alış Enlem", type: "text", hint: "Rota planlaması için" },
    { name: "pickupLng", label: "Alış Boylam", type: "text" },
    { name: "dropoffAddress", label: "Bırakış Adresi / Noktası", type: "textarea", wide: true },
    { name: "notes", label: "Not", type: "textarea", wide: true },
    { name: "isActive", label: "Aktif", type: "checkbox" },
  ];

  const changeFields: readonly FieldSpec[] = [
    {
      name: "temporaryRouteId",
      label: "Geçici Güzergah",
      type: "select",
      options: guzergahlar.map((r) => ({ value: r.id, label: r.name })),
    },
    { name: "startsOn", label: "Başlangıç", type: "date", required: true },
    { name: "endsOn", label: "Bitiş", type: "date", hint: "Boş = süresiz" },
    { name: "direction", label: "Yön", type: "select", options: DIRECTIONS },
    { name: "notes", label: "Açıklama", type: "text", wide: true },
  ];

  const canWrite = session.permissions.has("yolcular:create");
  const canDelete = session.permissions.has("yolcular:delete");
  const canUpdate = session.permissions.has("yolcular:update");
  const link = (next: Record<string, string | undefined>): string => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next } as Record<string, string | undefined>;
    for (const [k, v] of Object.entries(merged)) if (typeof v === "string" && v) query.set(k, v);
    return `/operasyon/yolcular?${query.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Yolcular"
        description={`${total} kayıt`}
        action={
          canWrite ? (
            <div className="flex flex-wrap items-start gap-2">
              <Link
                href="/operasyon/yolcular/odeme-planlari"
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
              >
                Ödeme Planları
              </Link>
              <BulkPassengerForm companies={firmalar} routes={guzergahlar} />
              <EntityForm
                action={savePassengerAction}
                fields={fields}
                values={editing ?? { isActive: true, direction: "her_iki" }}
                idValue={editing?.id}
                openLabel="Yeni Kayıt"
              />
            </div>
          ) : null
        }
      />

      <FilterBar action="/operasyon/yolcular">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ad, telefon, TC, barkod" className={inputClass} />
        </Field>
        <Field label={t("customer")}>
          <select name="firma" defaultValue={filter.companyId ?? ""} className={inputClass}>
            <option value="">Tüm firmalar</option>
            {firmalar.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Güzergah">
          <select name="guzergah" defaultValue={filter.routeId ?? ""} className={inputClass}>
            <option value="">Tümü</option>
            {guzergahlar.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tür">
          <select name="tip" defaultValue={filter.type ?? ""} className={inputClass}>
            <option value="">Tüm türler</option>
            {TYPES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.durum ?? ""} className={inputClass}>
            <option value="">Tümü</option>
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
          </select>
        </Field>
        <Field label="Sırala">
          <select name="sirala" defaultValue={filter.sirala ?? "ad"} className={inputClass}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </FilterBar>

      <Table
        head={[
          "Ad Soyad",
          t("customer"),
          "Tür",
          "Güzergah",
          "Yön",
          "Telefon",
          "Sınıf/Şube",
          "Sözleşme",
          "Hizmet",
          "",
        ]}
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={10} text="Kayıt bulunamadı" />
        ) : (
          rows.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <Td className="font-medium">
                {p.fullName}
                {p.barcode ? <span className="ml-2 text-xs text-neutral-400">{p.barcode}</span> : null}
                {p.isActive ? null : <span className="ml-2 text-xs text-neutral-400">pasif</span>}
              </Td>
              <Td className="text-neutral-500">{p.companyName ?? "Firma yok"}</Td>
              <Td>{TYPES.find((x) => x.value === p.type)?.label ?? p.type}</Td>
              <Td className="text-neutral-500">{p.routeName ?? "—"}</Td>
              <Td className="text-neutral-500">
                {DIRECTIONS.find((d) => d.value === p.direction)?.label ?? "—"}
              </Td>
              <Td className="text-neutral-500">{p.phone ?? "—"}</Td>
              <Td className="text-neutral-500">
                {[p.grade, p.branch].filter(Boolean).join(" / ") || "—"}
              </Td>
              <Td>
                <Badge tone={CONTRACT_TONE[p.contractStatus]}>
                  {CONTRACT.find((c) => c.value === p.contractStatus)?.label}
                </Badge>
              </Td>
              <Td>
                <Badge tone={SERVICE_TONE[p.serviceStatus]}>
                  {SERVICE.find((s) => s.value === p.serviceStatus)?.label ?? p.serviceStatus}
                </Badge>
              </Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {canUpdate ? (
                    <Link
                      href={link({ servis: p.id, duzenle: undefined })}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Servis
                    </Link>
                  ) : null}
                  {canWrite ? (
                    <Link
                      href={link({ duzenle: p.id, servis: undefined })}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                    >
                      Düzenle
                    </Link>
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
        query={{
          q: filter.q,
          firma: filter.companyId,
          guzergah: filter.routeId,
          tip: filter.type,
          durum: filter.durum,
          sirala: filter.sirala,
        }}
      />

      {changesFor ? (
        <>
          <PageHeader
            title="Servis Değişiklikleri"
            description="Geçici güzergah atamaları"
            action={
              canUpdate ? (
                <EntityForm
                  action={saveServiceChangeAction}
                  fields={changeFields}
                  values={{ startsOn: istanbulDayKey(), direction: "her_iki" }}
                  extraHidden={{ passengerId: changesFor }}
                  openLabel="Geçici Güzergah"
                />
              ) : null
            }
          />
          <Table head={["Yolcu", "Geçici Güzergah", "Başlangıç", "Bitiş", "Yön", "Açıklama", ""]}>
            {changes.length === 0 ? (
              <EmptyRow colSpan={7} text="Servis değişikliği kaydı yok" />
            ) : (
              changes.map((c) => (
                <tr key={c.id} className="hover:bg-neutral-50">
                  <Td className="font-medium">{c.passengerName}</Td>
                  <Td>{c.temporaryRoute ?? "—"}</Td>
                  <Td>{formatDate(c.startsOn)}</Td>
                  <Td>{c.endsOn ? formatDate(c.endsOn) : <Badge tone="ok">süresiz</Badge>}</Td>
                  <Td className="text-neutral-500">
                    {DIRECTIONS.find((d) => d.value === c.direction)?.label ?? c.direction}
                  </Td>
                  <Td className="max-w-xs truncate text-neutral-500">{c.notes ?? "—"}</Td>
                  <Td>
                    {canUpdate ? (
                      <form action={deleteServiceChangeAction} className="flex justify-end">
                        <input type="hidden" name="id" value={c.id} />
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
        </>
      ) : null}
    </div>
  );
}
