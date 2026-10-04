import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader, inputClass } from "@/components/ui";
import { EntityForm } from "@/components/ui/entity-form";
import { one, pageContext, type SearchParams } from "@/lib/page-context";
import { formatDate, formatDateTime, istanbulDayKey } from "@/lib/time";
import {
  addContactAction,
  assignLeadAction,
  convertLeadAction,
  deleteLeadAction,
  removeContactAction,
  saveLeadAction,
  setLeadStatusAction,
  setLeadTemperatureAction,
} from "@/modules/satis/actions";
import { leadFormFields } from "@/modules/satis/lead-form";
import {
  ACTIVITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  STATUS_TONE,
  TEMPERATURE_LABEL,
  TEMPERATURE_OPTIONS,
  TEMPERATURE_TONE,
} from "@/modules/satis/labels";
import { whatsappNumber } from "@/modules/satis/normalize";
import { getLeadDetail, listOwnerOptions } from "@/modules/satis/queries";
import { canSeeAll } from "@/modules/satis/visibility";

const ERRORS: Record<string, string> = {
  already_converted: "Bu aday zaten müşteriye dönüştürülmüş.",
  no_open_stage: "Pipeline'da açık aşama yok. Önce Pipeline'dan bir aşama ekleyin.",
  not_found: "Aday bulunamadı.",
};

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export default async function AdayDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { session, t } = await pageContext("satis_aday:read", "satis");

  const detail = await getLeadDetail(session, id);
  if (!detail) notFound();
  const { lead, contacts, deals, activities } = detail;
  const owners = await listOwnerOptions(session.tenantId);

  const seeAll = canSeeAll(session);
  const canUpdate = session.permissions.has("satis_aday:update");
  const canDelete = session.permissions.has("satis_aday:delete");
  const converted = lead.status === "converted";
  const editing = one(query, "duzenle") === "1" && canUpdate;
  const errorText = ERRORS[one(query, "hata") ?? ""];
  const wa = whatsappNumber(lead.phone);

  const editValues = {
    ...lead,
    estimatedValue: lead.estimatedValue ?? "",
    followUpDate: lead.followUpAt ? istanbulDayKey(lead.followUpAt) : "",
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={lead.name}
        description={lead.contactName ?? undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[lead.status]}>{STATUS_LABEL[lead.status]}</Badge>
            {lead.temperature ? <Badge tone={TEMPERATURE_TONE[lead.temperature]}>{TEMPERATURE_LABEL[lead.temperature]}</Badge> : null}
            <Link href="/satis/adaylar" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
              Listeye dön
            </Link>
          </div>
        }
      />

      {errorText ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p> : null}

      {editing ? (
        <EntityForm
          action={saveLeadAction}
          fields={leadFormFields(owners, seeAll)}
          values={editValues}
          idValue={lead.id}
          openLabel="Düzenle"
          alwaysOpen
        />
      ) : (
        <Card className="p-4">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Info label="Telefon">
              {lead.phone ? (
                <span className="flex flex-wrap items-center gap-2">
                  <a href={`tel:${lead.phone}`} className="hover:underline">{lead.phone}</a>
                  {wa ? (
                    <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline">
                      WhatsApp
                    </a>
                  ) : null}
                </span>
              ) : null}
            </Info>
            <Info label="E-posta">{lead.email ? <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a> : null}</Info>
            <Info label="Web sitesi">{lead.website}</Info>
            <Info label="Şehir">{lead.city}</Info>
            <Info label="Sektör">{lead.sector}</Info>
            <Info label="İlgilendiği hizmet">{lead.service}</Info>
            <Info label="Kaynak">
              {SOURCE_LABEL[lead.source]}
              {lead.eventName ? ` · ${lead.eventName}` : ""}
            </Info>
            <Info label="Puan">{lead.score}</Info>
            <Info label="Tahmini değer">{lead.estimatedValue ? `${Number(lead.estimatedValue).toLocaleString("tr-TR")} TL` : null}</Info>
            <Info label="Sahip">{lead.ownerName ?? "Sahipsiz"}</Info>
            <Info label="Takip tarihi">{formatDate(lead.followUpAt)}</Info>
            <Info label="Eklenme">{formatDateTime(lead.createdAt)}</Info>
          </dl>
          {lead.message ? (
            <div className="mt-4">
              <p className="text-xs text-neutral-500">Adayın mesajı</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{lead.message}</p>
            </div>
          ) : null}
          {lead.note ? (
            <div className="mt-4">
              <p className="text-xs text-neutral-500">Not</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm">{lead.note}</p>
            </div>
          ) : null}
          {canUpdate ? (
            <div className="mt-4">
              <Link href={`/satis/adaylar/${lead.id}?duzenle=1`} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                Düzenle
              </Link>
            </div>
          ) : null}
        </Card>
      )}

      {canUpdate ? (
        <Card className="flex flex-wrap items-end gap-4 p-4">
          {!converted ? (
            <form action={setLeadStatusAction} className="flex items-end gap-2">
              <input type="hidden" name="id" value={lead.id} />
              <label className="text-xs text-neutral-600">
                Durum
                <select name="status" defaultValue={lead.status} className={`${inputClass} mt-1`}>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="ghost">Kaydet</Button>
            </form>
          ) : null}
          <form action={setLeadTemperatureAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className="text-xs text-neutral-600">
              Sıcaklık
              <select name="temperature" defaultValue={lead.temperature ?? ""} className={`${inputClass} mt-1`}>
                <option value="">Belirsiz</option>
                {TEMPERATURE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="ghost">Kaydet</Button>
          </form>
          <form action={assignLeadAction} className="flex items-end gap-2">
            <input type="hidden" name="id" value={lead.id} />
            <label className="text-xs text-neutral-600">
              Sahip
              <select name="ownerUserId" defaultValue={lead.ownerUserId ?? ""} className={`${inputClass} mt-1`}>
                <option value="">Sahipsiz</option>
                {(seeAll ? owners : owners.filter((o) => o.id === session.userId)).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="ghost">Ata</Button>
          </form>
          {!converted ? (
            <form action={convertLeadAction}>
              <input type="hidden" name="id" value={lead.id} />
              <Button type="submit">Müşteriye dönüştür</Button>
            </form>
          ) : null}
          {canDelete ? (
            <form action={deleteLeadAction} className="ml-auto">
              <input type="hidden" name="id" value={lead.id} />
              <Button type="submit" variant="danger">Kalıcı sil</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Kişiler</h2>
            {canUpdate ? (
              <EntityForm
                action={addContactAction}
                fields={[
                  { name: "fullName", label: "Ad soyad", type: "text", required: true },
                  { name: "title", label: "Unvan", type: "text" },
                  { name: "phone", label: "Telefon", type: "tel" },
                  { name: "email", label: "E-posta", type: "email" },
                ]}
                extraHidden={{ leadId: lead.id }}
                openLabel="Kişi ekle"
              />
            ) : null}
          </div>
          {contacts.length === 0 ? (
            <p className="text-sm text-neutral-500">Henüz kişi yok.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-medium">{c.fullName}{c.title ? <span className="font-normal text-neutral-500"> · {c.title}</span> : null}</p>
                    <p className="text-xs text-neutral-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  {canUpdate ? (
                    <form action={removeContactAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="leadId" value={lead.id} />
                      <Button type="submit" variant="danger">Kaldır</Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">{t("deal_plural")}</h2>
          {deals.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {converted ? "Bu adaya bağlı fırsat yok." : `Müşteriye dönüştürünce ilk ${t("deal").toLocaleLowerCase("tr")} otomatik açılır.`}
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {deals.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{d.title}</span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500">
                    {Number(d.value).toLocaleString("tr-TR")} {d.currency}
                    <Badge tone={d.stageKind === "won" ? "ok" : d.stageKind === "lost" ? "bad" : "info"}>{d.stageLabel}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {converted && lead.convertedCompanyId ? (
            <Link href={`/crm/firmalar/${lead.convertedCompanyId}`} className="mt-3 inline-block text-xs text-neutral-600 underline">
              Firma kaydını aç
            </Link>
          ) : null}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Hareketler</h2>
        {activities.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz hareket yok.</p>
        ) : (
          <ul className="space-y-2">
            {activities.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-neutral-400">{formatDateTime(a.createdAt)}</span>
                <span>
                  <span className="mr-2 text-xs text-neutral-500">{a.isSystem ? "Sistem" : ACTIVITY_LABEL[a.type]}</span>
                  {a.subject}
                  {a.note ? <span className="block text-xs text-neutral-500">{a.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
