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
import { EntityForm } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate } from "@/lib/time";
import { bulkLeadAction, saveLeadAction } from "@/modules/satis/actions";
import {
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_TONE,
  TEMPERATURE_LABEL,
  TEMPERATURE_OPTIONS,
  TEMPERATURE_TONE,
} from "@/modules/satis/labels";
import { leadFormFields } from "@/modules/satis/lead-form";
import { listLeads, listOwnerOptions } from "@/modules/satis/queries";
import { canSeeAll } from "@/modules/satis/visibility";

export default async function AdaylarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { session, t } = await pageContext("satis_aday:read", "satis");

  const filter = {
    q: one(params, "q"),
    status: one(params, "durum"),
    temperature: one(params, "sicaklik"),
    source: one(params, "kaynak"),
    owner: one(params, "sahip"),
    sort: one(params, "sirala"),
    page: Number(one(params, "sayfa") ?? 1),
  };
  const [{ rows, total, page, pageCount }, owners] = await Promise.all([
    listLeads(session, filter),
    listOwnerOptions(session.tenantId),
  ]);

  const seeAll = canSeeAll(session);
  const canCreate = session.permissions.has("satis_aday:create");
  const canUpdate = session.permissions.has("satis_aday:update");
  const canDelete = session.permissions.has("satis_aday:delete");
  const canImport = session.permissions.has("satis_aday:import");
  const canExport = session.permissions.has("satis_aday:export");

  const exportQuery = new URLSearchParams(
    Object.entries({ q: filter.q, durum: filter.status, sicaklik: filter.temperature, kaynak: filter.source, sahip: filter.owner })
      .filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("lead_plural")}
        description={`${total} kayıt${seeAll ? "" : " (size atanan ve sahipsiz olanlar)"}`}
        action={
          <div className="flex flex-wrap items-start gap-2">
            {canImport ? (
              <Link href="/satis/adaylar/ice-aktar" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                CSV içe aktar
              </Link>
            ) : null}
            {canExport ? (
              <a
                href={`/api/satis/adaylar/export${exportQuery ? `?${exportQuery}` : ""}`}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
              >
                CSV dışa aktar
              </a>
            ) : null}
            {canCreate ? (
              <EntityForm
                action={saveLeadAction}
                fields={leadFormFields(owners, seeAll)}
                values={{}}
                openLabel={`Yeni ${t("lead").toLocaleLowerCase("tr")}`}
              />
            ) : null}
          </div>
        }
      />

      <FilterBar action="/satis/adaylar">
        <Field label="Ara">
          <input name="q" defaultValue={filter.q ?? ""} placeholder="Ad, telefon, e-posta, şehir" className={inputClass} />
        </Field>
        <Field label="Durum">
          <select name="durum" defaultValue={filter.status ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Sıcaklık">
          <select name="sicaklik" defaultValue={filter.temperature ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {TEMPERATURE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Kaynak">
          <select name="kaynak" defaultValue={filter.source ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            {Object.entries(SOURCE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Sahip">
          <select name="sahip" defaultValue={filter.owner ?? ""} className={inputClass}>
            <option value="">Hepsi</option>
            <option value="ben">Bende olanlar</option>
            <option value="sahipsiz">Sahipsiz</option>
            {seeAll
              ? owners.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))
              : null}
          </select>
        </Field>
        <Field label="Sırala">
          <select name="sirala" defaultValue={filter.sort ?? "yeni"} className={inputClass}>
            <option value="yeni">En yeni</option>
            <option value="eski">En eski</option>
            <option value="ad">Ada göre</option>
            <option value="puan">Puana göre</option>
            <option value="takip">Takip tarihine göre</option>
          </select>
        </Field>
      </FilterBar>

      <form action={bulkLeadAction} className="space-y-3">
        <Table head={["", "Ad", "Telefon", "Durum", "Sıcaklık", "Puan", "Kaynak", "Sahip", "Takip", "Eklenme"]}>
          {rows.length === 0 ? (
            <EmptyRow colSpan={10} text={`${t("lead")} bulunamadı. Filtreleri değiştirin ya da yeni ${t("lead").toLocaleLowerCase("tr")} ekleyin.`} />
          ) : (
            rows.map((lead) => (
              <tr key={lead.id} className="hover:bg-neutral-50">
                <Td>
                  {canUpdate || canDelete ? <input type="checkbox" name="ids" value={lead.id} aria-label={`${lead.name} seç`} /> : null}
                </Td>
                <Td className="font-medium">
                  <Link href={`/satis/adaylar/${lead.id}`} className="hover:underline">
                    {lead.name}
                  </Link>
                  {lead.contactName ? <span className="block text-xs font-normal text-neutral-500">{lead.contactName}</span> : null}
                </Td>
                <Td className="text-neutral-600">{lead.phone ?? "—"}</Td>
                <Td><Badge tone={STATUS_TONE[lead.status]}>{STATUS_LABEL[lead.status]}</Badge></Td>
                <Td>
                  {lead.temperature ? <Badge tone={TEMPERATURE_TONE[lead.temperature]}>{TEMPERATURE_LABEL[lead.temperature]}</Badge> : "—"}
                </Td>
                <Td className="tabular-nums">{lead.score}</Td>
                <Td className="text-neutral-600">{SOURCE_LABEL[lead.source]}</Td>
                <Td className="text-neutral-600">{lead.ownerName ?? "Sahipsiz"}</Td>
                <Td className="text-neutral-600">{formatDate(lead.followUpAt)}</Td>
                <Td className="text-neutral-500">{formatDate(lead.createdAt)}</Td>
              </tr>
            ))
          )}
        </Table>

        {rows.length > 0 && (canUpdate || canDelete) ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
            <span className="text-xs text-neutral-500">Seçilenlere uygula:</span>
            <select name="bulk" className={`${inputClass} max-w-xs`} defaultValue="">
              <option value="" disabled>İşlem seçin</option>
              {canUpdate ? (
                <>
                  <optgroup label="Durum">
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={`status:${o.value}`}>{o.label} yap</option>
                    ))}
                  </optgroup>
                  <optgroup label="Sıcaklık">
                    {TEMPERATURE_OPTIONS.map((o) => (
                      <option key={o.value} value={`temperature:${o.value}`}>{o.label} yap</option>
                    ))}
                  </optgroup>
                  <optgroup label="Sahip">
                    <option value={`owner:${session.userId}`}>Bana ata</option>
                    {seeAll
                      ? owners.filter((o) => o.id !== session.userId).map((o) => (
                          <option key={o.id} value={`owner:${o.id}`}>{o.name} kişisine ata</option>
                        ))
                      : null}
                    <option value="owner:">Sahibini kaldır</option>
                  </optgroup>
                </>
              ) : null}
              {canDelete ? (
                <optgroup label="Tehlikeli">
                  <option value="delete:">Seçilenleri kalıcı sil</option>
                </optgroup>
              ) : null}
            </select>
            <Button type="submit" variant="ghost">Uygula</Button>
            <span className="text-xs text-neutral-400">Silme geri alınamaz; Atricard kaynaklı kayıtlar yeniden gelmez.</span>
          </div>
        ) : null}
      </form>

      <Pagination
        basePath="/satis/adaylar"
        page={page}
        pageCount={pageCount}
        query={{ q: filter.q, durum: filter.status, sicaklik: filter.temperature, kaynak: filter.source, sahip: filter.owner, sirala: filter.sort }}
      />
    </div>
  );
}
