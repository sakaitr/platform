/**
 * Giden webhook sözleşmesi (AtriCRM → müşterinin sistemi). Başlıklar Atricard'ınkiyle aynı biçimde,
 * önek `X-AtriCRM-`. Bu dosya saf mantıktır: olay adları, yük şekilleri, tekrar deneme takvimi.
 */

export const OUTBOUND_EVENTS = [
  "lead.created",
  "lead.updated",
  "lead.deleted",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

export const EVENT_LABEL: Record<OutboundEvent, string> = {
  "lead.created": "Aday oluşturuldu",
  "lead.updated": "Aday güncellendi",
  "lead.deleted": "Aday silindi",
  "deal.stage_changed": "Fırsat aşaması değişti",
  "deal.won": "Fırsat kazanıldı",
  "deal.lost": "Fırsat kaybedildi",
};

export function isOutboundEvent(value: string): value is OutboundEvent {
  return (OUTBOUND_EVENTS as readonly string[]).includes(value);
}

export const HEADER_PREFIX = "X-AtriCRM";
export const USER_AGENT = "AtriCRM-Webhooks/1";
export const PAYLOAD_VERSION = 1;

// ---- Tekrar deneme -------------------------------------------------------------------------

/** İlk deneme + 5 tekrar = en çok 6 deneme. Bekleme: 1 dk, 5 dk, 30 dk, 2 sa, 12 sa. */
export const MAX_ATTEMPTS = 6;
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
/** Art arda bu kadar teslim `failed` olunca uç kapanır. */
export const AUTO_DISABLE_AFTER_FAILURES = 20;
/** Bir deneme işlenirken teslim bu süre "kiralanır"; işçi çökerse süre dolunca yeniden alınır. */
export const LEASE_MS = 2 * 60_000;
export const RETENTION_DAYS = 30;

/**
 * `attempts` yapılan deneme sayısı (bu başarısız deneme dahil). Sonraki denemeye kadar bekleme;
 * deneme hakkı bittiyse `null` (teslim `failed`). `scale` yalnız testlerde beklemeyi kısaltmak içindir
 * (`WEBHOOK_RETRY_SCALE`); üretim varsayılanı 1'dir.
 */
export function retryDelayMs(attempts: number, scale: number = retryScale()): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const base = RETRY_DELAYS_MS[attempts - 1];
  return base === undefined ? null : Math.max(1, Math.round(base * scale));
}

export function retryScale(env: string | undefined = process.env.WEBHOOK_RETRY_SCALE): number {
  const value = Number(env);
  return env !== undefined && env !== "" && Number.isFinite(value) && value > 0 ? value : 1;
}

// ---- Yükler (v1) ---------------------------------------------------------------------------

export type LeadSnapshot = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  sector: string | null;
  message: string | null;
  service: string | null;
  source: string;
  status: string;
  temperature: string | null;
  score: number;
  eventName: string | null;
  estimatedValue: string | null;
  followUpAt: Date | null;
  createdAt: Date;
};

export type PersonRef = { name: string; email: string } | null;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function buildLeadPayload(
  event: "lead.created" | "lead.updated",
  lead: LeadSnapshot,
  owner: PersonRef,
  occurredAt: Date,
  extra: Record<string, unknown> = {},
) {
  return {
    event,
    version: PAYLOAD_VERSION,
    id: lead.id,
    occurred_at: occurredAt.toISOString(),
    lead: {
      name: lead.name,
      contact_name: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      website: lead.website,
      city: lead.city,
      sector: lead.sector,
      message: lead.message,
      service: lead.service,
      origin: lead.source,
      status: lead.status,
      temperature: lead.temperature,
      score: lead.score,
      event_name: lead.eventName,
      estimated_value: lead.estimatedValue,
      follow_up_at: iso(lead.followUpAt),
      created_at: lead.createdAt.toISOString(),
    },
    owner,
    ...extra,
  };
}

/** Silme olayı kişisel veri taşımaz: yalnız kimlik ve neden. */
export function buildLeadDeletedPayload(leadId: string, reason: string, occurredAt: Date) {
  return { event: "lead.deleted" as const, version: PAYLOAD_VERSION, id: leadId, occurred_at: occurredAt.toISOString(), reason };
}

export type DealSnapshot = {
  id: string;
  title: string;
  value: string;
  currency: string;
  leadId: string | null;
  companyName: string | null;
  expectedCloseAt: Date | null;
  closedAt: Date | null;
  lostReason: string | null;
};

export type StageRef = { key?: string; label: string; kind: "open" | "won" | "lost" };

export function buildDealPayload(
  event: "deal.stage_changed" | "deal.won" | "deal.lost",
  deal: DealSnapshot,
  stage: StageRef,
  previousStage: StageRef | null,
  owner: PersonRef,
  occurredAt: Date,
) {
  return {
    event,
    version: PAYLOAD_VERSION,
    id: deal.id,
    occurred_at: occurredAt.toISOString(),
    deal: {
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      stage: { label: stage.label, kind: stage.kind },
      previous_stage: previousStage ? { label: previousStage.label, kind: previousStage.kind } : null,
      lost_reason: event === "deal.lost" ? deal.lostReason : null,
      expected_close_at: iso(deal.expectedCloseAt),
      closed_at: iso(deal.closedAt),
    },
    lead_id: deal.leadId,
    company: deal.companyName ? { name: deal.companyName } : null,
    owner,
  };
}

/** "Test gönder": örnek `lead.created` yükü, `"test": true`. Gerçek kişi verisi içermez. */
export function buildTestPayload(occurredAt: Date, id: string) {
  return {
    event: "lead.created" as const,
    version: PAYLOAD_VERSION,
    id,
    occurred_at: occurredAt.toISOString(),
    test: true,
    lead: {
      name: "Örnek Aday",
      contact_name: "Deniz Yılmaz",
      phone: "+905320000000",
      email: "ornek@example.com",
      website: null,
      city: "İstanbul",
      sector: null,
      message: "Bu bir test iletisidir.",
      service: "Web sitesi",
      origin: "manual",
      status: "new",
      temperature: null,
      score: 45,
      event_name: null,
      estimated_value: null,
      follow_up_at: null,
      created_at: occurredAt.toISOString(),
    },
    owner: null,
  };
}

/** Başlıkların imza dışı kısmı. İmza ve zaman damgası her denemede yeniden üretilir. */
export function deliveryHeaders(event: string, deliveryId: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": USER_AGENT,
    [`${HEADER_PREFIX}-Event`]: event,
    [`${HEADER_PREFIX}-Delivery`]: deliveryId,
  };
}

/** Yanıt/hata metnini kaydedilecek boyuta indirger (yanıt gövdesi kişisel veri ya da gizli içerebilir). */
export function truncateError(text: string, max = 500): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
