import { redirect } from "next/navigation";
import { Badge, Button, Card, EmptyRow, PageHeader, Table, Td, inputClass } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { formatDateTime } from "@/lib/time";
import {
  createApiKeyAction,
  createInboundAction,
  createOutboundAction,
  deleteIntegrationAction,
  regenerateSecretAction,
  resendDeliveryAction,
  revokeApiKeyAction,
  testSendAction,
  toggleIntegrationAction,
  updateOutboundAction,
} from "@/modules/satis/integration-actions";
import {
  displayUrl,
  listApiKeys,
  listIntegrations,
  listRecentDeliveries,
  listRecentInboundEvents,
} from "@/modules/satis/integration-queries";
import { EVENT_LABEL, OUTBOUND_EVENTS } from "@/modules/satis/webhooks";
import { RevealForm } from "../_components/reveal-form";

const DISABLED_TEXT: Record<string, string> = {
  manual: "Kapalı.",
  failures: "Art arda 20 teslim başarısız olduğu için otomatik kapandı. Alıcıyı kontrol edip yeniden açın.",
  plan_not_allowed: "Planınız bu özelliği içermediği için kapandı.",
  ssrf: "Alıcı adresi güvenlik kurallarına uymuyor (iç ağ adresi). Adresi düzeltin.",
};

const DELIVERY_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Bekliyor", tone: "warn" },
  succeeded: { label: "Teslim edildi", tone: "ok" },
  failed: { label: "Başarısız", tone: "bad" },
  cancelled: { label: "İptal", tone: "mute" },
};

const INBOUND_STATUS: Record<string, { label: string; tone: string }> = {
  processed: { label: "İşlendi", tone: "ok" },
  duplicate: { label: "Tekrar", tone: "info" },
  ignored: { label: "Yok sayıldı", tone: "mute" },
  rejected: { label: "Reddedildi", tone: "bad" },
};

const CONSENT_TEXT =
  "Bu bağlantıyı açarak aday adı, yetkili, firma, e-posta, telefon, web sitesi, şehir, sektör, mesaj ve hizmet bilgilerinin seçtiğim alıcıya gönderileceğini onaylıyorum. Fotoğraf ve cihaz bilgisi gönderilmez.";

export default async function EntegrasyonlarPage() {
  const { session, can } = await pageContext("satis_entegrasyon:read", "satis");
  if (!can("satis.entegrasyon")) redirect("/dashboard");
  const canEdit = session.permissions.has("satis_entegrasyon:update");

  const [integrations, deliveries, inbound, apiKeys] = await Promise.all([
    listIntegrations(session.tenantId),
    listRecentDeliveries(session.tenantId),
    listRecentInboundEvents(session.tenantId),
    listApiKeys(session.tenantId),
  ]);
  const inboundList = integrations.filter((i) => i.kind === "atricard_inbound");
  const outboundList = integrations.filter((i) => i.kind === "webhook_outbound");
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const alerts = integrations.filter((i) => !i.enabled && (i.disabledReason === "failures" || i.disabledReason === "ssrf" || i.disabledReason === "plan_not_allowed"));

  return (
    <div className="space-y-6">
      <PageHeader title="Entegrasyonlar" description="Atricard'dan gelen adayları alın, olayları kendi sistemlerinize gönderin." />

      {alerts.map((a) => (
        <p key={a.id} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>{a.name}:</strong> {DISABLED_TEXT[a.disabledReason ?? "manual"]}
        </p>
      ))}

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Atricard bağlantısı</h2>
          <p className="text-xs text-neutral-500">
            Atricard'da lead oluşunca (ya da silinince) imzalı bir istekle buraya gelir. Adresi ve anahtarı Atricard'da Ayarlar, Bağlantılar bölümüne girin.
          </p>
        </div>
        {inboundList.length === 0 ? <p className="text-sm text-neutral-500">Henüz Atricard bağlantısı yok.</p> : null}
        <ul className="space-y-3">
          {inboundList.map((i) => (
            <li key={i.id} className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{i.name}</span>
                <Badge tone={i.enabled ? "ok" : "mute"}>{i.enabled ? "Açık" : "Kapalı"}</Badge>
              </div>
              <p className="break-all text-xs text-neutral-600">Adres: {base}/api/webhooks/atricard/{i.id}</p>
              <p className="text-xs text-neutral-500">Son istek: {i.lastUsedAt ? formatDateTime(i.lastUsedAt) : "henüz yok"}</p>
              {canEdit ? (
                <div className="flex flex-wrap items-start gap-2">
                  <form action={toggleIntegrationAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <input type="hidden" name="enable" value={i.enabled ? "0" : "1"} />
                    <Button type="submit" variant="ghost">{i.enabled ? "Kapat" : "Aç"}</Button>
                  </form>
                  <RevealForm action={regenerateSecretAction} submitLabel="Anahtarı yeniden oluştur" variant="ghost" className="space-y-2">
                    <input type="hidden" name="id" value={i.id} />
                  </RevealForm>
                  <form action={deleteIntegrationAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" variant="danger">Sil</Button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <RevealForm action={createInboundAction} submitLabel="Atricard bağlantısı oluştur">
            <label className="block text-xs font-medium text-neutral-600">
              Bağlantı adı
              <input name="name" required placeholder="Atricard" className={`${inputClass} mt-1 max-w-sm`} />
            </label>
          </RevealForm>
        ) : null}
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Giden webhook'lar</h2>
          <p className="text-xs text-neutral-500">
            Seçtiğiniz olaylar imzalı bir POST ile alıcınıza gönderilir. İmza başlıkları: X-AtriCRM-Event, -Delivery, -Timestamp, -Signature. Yalnız https adresleri kabul edilir.
          </p>
        </div>
        {outboundList.length === 0 ? <p className="text-sm text-neutral-500">Henüz giden webhook yok.</p> : null}
        <ul className="space-y-3">
          {outboundList.map((o) => (
            <li key={o.id} className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{o.name}</span>
                <Badge tone={o.enabled ? "ok" : "mute"}>{o.enabled ? "Açık" : "Kapalı"}</Badge>
              </div>
              <p className="break-all text-xs text-neutral-600">{displayUrl(o.url)}</p>
              <p className="text-xs text-neutral-500">
                {o.events.map((e) => EVENT_LABEL[e as keyof typeof EVENT_LABEL] ?? e).join(", ")}
                {o.consecutiveFailures > 0 ? ` · art arda başarısız: ${o.consecutiveFailures}` : ""}
              </p>
              {!o.enabled && o.disabledReason ? <p className="text-xs text-red-700">{DISABLED_TEXT[o.disabledReason]}</p> : null}
              {canEdit ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-start gap-2">
                    {o.enabled ? (
                      <form action={toggleIntegrationAction}>
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="enable" value="0" />
                        <Button type="submit" variant="ghost">Kapat</Button>
                      </form>
                    ) : (
                      <form action={toggleIntegrationAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={o.id} />
                        <input type="hidden" name="enable" value="1" />
                        {!o.consentAt ? (
                          <label className="flex max-w-md items-start gap-2 text-xs text-neutral-600">
                            <input type="checkbox" name="consent" className="mt-0.5" />
                            {CONSENT_TEXT}
                          </label>
                        ) : null}
                        <Button type="submit">Aç</Button>
                      </form>
                    )}
                    <RevealForm action={testSendAction} submitLabel="Test gönder" variant="ghost" className="space-y-2">
                      <input type="hidden" name="id" value={o.id} />
                    </RevealForm>
                    <RevealForm action={regenerateSecretAction} submitLabel="Anahtarı yeniden oluştur" variant="ghost" className="space-y-2">
                      <input type="hidden" name="id" value={o.id} />
                    </RevealForm>
                    <form action={deleteIntegrationAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="danger">Sil</Button>
                    </form>
                  </div>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-neutral-600">Düzenle</summary>
                    <RevealForm action={updateOutboundAction} submitLabel="Kaydet" className="mt-2 space-y-3">
                      <input type="hidden" name="id" value={o.id} />
                      <label className="block text-xs font-medium text-neutral-600">Ad<input name="name" defaultValue={o.name} className={`${inputClass} mt-1 max-w-sm`} /></label>
                      <label className="block text-xs font-medium text-neutral-600">Alıcı adresi<input name="url" defaultValue={o.url ?? ""} className={`${inputClass} mt-1`} /></label>
                      <fieldset className="flex flex-wrap gap-3 text-xs">
                        {OUTBOUND_EVENTS.map((e) => (
                          <label key={e} className="flex items-center gap-1"><input type="checkbox" name="events" value={e} defaultChecked={o.events.includes(e)} />{EVENT_LABEL[e]}</label>
                        ))}
                      </fieldset>
                    </RevealForm>
                  </details>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <details className="rounded-lg border border-dashed border-neutral-300 p-3">
            <summary className="cursor-pointer text-sm font-medium">Yeni giden webhook</summary>
            <RevealForm action={createOutboundAction} submitLabel="Webhook oluştur" className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-neutral-600">Ad<input name="name" required placeholder="Muhasebe sistemi" className={`${inputClass} mt-1 max-w-sm`} /></label>
              <label className="block text-xs font-medium text-neutral-600">Alıcı adresi (https)<input name="url" required placeholder="https://ornek.com/webhook" className={`${inputClass} mt-1`} /></label>
              <fieldset className="flex flex-wrap gap-3 text-xs">
                <legend className="mb-1 text-xs font-medium text-neutral-600">Olaylar</legend>
                {OUTBOUND_EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-1"><input type="checkbox" name="events" value={e} defaultChecked={e.startsWith("lead.")} />{EVENT_LABEL[e]}</label>
                ))}
              </fieldset>
              <label className="flex max-w-xl items-start gap-2 text-xs text-neutral-600">
                <input type="checkbox" name="consent" className="mt-0.5" />
                {CONSENT_TEXT}
              </label>
            </RevealForm>
          </details>
        ) : null}
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Son teslimler (giden)</h2>
        <Table head={["Olay", "Bağlantı", "Durum", "Deneme", "HTTP", "Hata", "Zaman", ""]}>
          {deliveries.length === 0 ? (
            <EmptyRow colSpan={8} text="Henüz teslim yok." />
          ) : (
            deliveries.map((d) => (
              <tr key={d.id}>
                <Td>{EVENT_LABEL[d.event as keyof typeof EVENT_LABEL] ?? d.event}</Td>
                <Td className="text-neutral-600">{d.integrationName}</Td>
                <Td><Badge tone={DELIVERY_STATUS[d.status]!.tone}>{DELIVERY_STATUS[d.status]!.label}</Badge></Td>
                <Td className="tabular-nums">{d.attempts}</Td>
                <Td className="tabular-nums">{d.responseStatus ?? "—"}</Td>
                <Td className="max-w-xs truncate text-xs text-neutral-500" >{d.lastError ?? ""}</Td>
                <Td className="text-neutral-500">{formatDateTime(d.deliveredAt ?? d.nextAttemptAt ?? d.createdAt)}</Td>
                <Td>
                  {canEdit && d.status === "failed" ? (
                    <form action={resendDeliveryAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <Button type="submit" variant="ghost">Yeniden gönder</Button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))
          )}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Gelen olaylar (Atricard)</h2>
        <Table head={["Olay", "Bağlantı", "Durum", "Not", "Zaman"]}>
          {inbound.length === 0 ? (
            <EmptyRow colSpan={5} text="Henüz gelen olay yok." />
          ) : (
            inbound.map((e) => (
              <tr key={e.id}>
                <Td>{e.event}</Td>
                <Td className="text-neutral-600">{e.integrationName}</Td>
                <Td><Badge tone={INBOUND_STATUS[e.status]!.tone}>{INBOUND_STATUS[e.status]!.label}</Badge></Td>
                <Td className="text-xs text-neutral-500">{e.error ?? ""}</Td>
                <Td className="text-neutral-500">{formatDateTime(e.createdAt)}</Td>
              </tr>
            ))
          )}
        </Table>
      </section>

      <Card className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">API anahtarları</h2>
          <p className="text-xs text-neutral-500">
            Aday listesini kendi sisteminizden okumak için. İstek başlığı: <code>Authorization: Bearer atc_…</code>. Uç noktalar: <code>GET /api/v1/leads</code>, <code>GET /api/v1/leads/&lt;id&gt;</code>. Yalnız okuma.
          </p>
        </div>
        <Table head={["Ad", "Önek", "Son kullanım", "Durum", ""]}>
          {apiKeys.length === 0 ? (
            <EmptyRow colSpan={5} text="Henüz API anahtarı yok." />
          ) : (
            apiKeys.map((k) => (
              <tr key={k.id}>
                <Td className="font-medium">{k.name}</Td>
                <Td className="font-mono text-xs">atc_{k.prefix}_…</Td>
                <Td className="text-neutral-500">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "—"}</Td>
                <Td><Badge tone={k.revokedAt ? "mute" : "ok"}>{k.revokedAt ? "İptal edildi" : "Etkin"}</Badge></Td>
                <Td>
                  {canEdit && !k.revokedAt ? (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="id" value={k.id} />
                      <Button type="submit" variant="danger">İptal et</Button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))
          )}
        </Table>
        {canEdit ? (
          <RevealForm action={createApiKeyAction} submitLabel="API anahtarı oluştur">
            <label className="block text-xs font-medium text-neutral-600">
              Anahtar adı
              <input name="name" required placeholder="Raporlama" className={`${inputClass} mt-1 max-w-sm`} />
            </label>
          </RevealForm>
        ) : null}
      </Card>
    </div>
  );
}
