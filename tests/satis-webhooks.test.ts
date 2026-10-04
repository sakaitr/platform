import { describe, expect, it } from "vitest";
import {
  AUTO_DISABLE_AFTER_FAILURES,
  buildDealPayload,
  buildLeadDeletedPayload,
  buildLeadPayload,
  buildTestPayload,
  deliveryHeaders,
  isOutboundEvent,
  MAX_ATTEMPTS,
  OUTBOUND_EVENTS,
  retryDelayMs,
  retryScale,
  truncateError,
  type LeadSnapshot,
} from "@/modules/satis/webhooks";

const lead: LeadSnapshot = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Mavi Tur",
  contactName: "Deniz",
  phone: "+905320000000",
  email: "d@x.co",
  website: null,
  city: "Ankara",
  sector: null,
  message: "Merhaba",
  service: "Web",
  source: "atricard",
  status: "new",
  temperature: "hot",
  score: 80,
  eventName: "Fuar",
  estimatedValue: "1000.00",
  followUpAt: null,
  createdAt: new Date("2026-10-04T10:00:00Z"),
};

describe("tekrar deneme takvimi", () => {
  it("1 dk, 5 dk, 30 dk, 2 sa, 12 sa; altıncı denemeden sonra durur", () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n, 1))).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
    expect(retryDelayMs(6, 1)).toBeNull();
    expect(retryDelayMs(7, 1)).toBeNull();
    expect(MAX_ATTEMPTS).toBe(6);
  });
  it("ilk denemeden önce (0) ve negatif girdide çökmez", () => {
    expect(retryDelayMs(0, 1)).toBeNull();
    expect(retryDelayMs(-3, 1)).toBeNull();
  });
  it("ölçek yalnız testlerde kısaltır; üretim varsayılanı 1", () => {
    expect(retryScale(undefined)).toBe(1);
    expect(retryScale("")).toBe(1);
    expect(retryScale("abc")).toBe(1);
    expect(retryScale("0")).toBe(1);
    expect(retryScale("-2")).toBe(1);
    expect(retryScale("0.001")).toBe(0.001);
    expect(retryDelayMs(1, 0.001)).toBe(60);
    expect(retryDelayMs(1, 0.0000001)).toBe(1); // sıfır bekleme olmaz
  });
  it("20 art arda başarısızlıkta kapanır", () => {
    expect(AUTO_DISABLE_AFTER_FAILURES).toBe(20);
  });
});

describe("olaylar", () => {
  it("altı olay, geçerlilik denetimi", () => {
    expect([...OUTBOUND_EVENTS]).toEqual(["lead.created", "lead.updated", "lead.deleted", "deal.stage_changed", "deal.won", "deal.lost"]);
    expect(isOutboundEvent("lead.created")).toBe(true);
    expect(isOutboundEvent("message.created")).toBe(false);
    expect(isOutboundEvent("")).toBe(false);
  });
});

describe("yük şekilleri (v1)", () => {
  it("lead.created: kimlik, sürüm, zaman, alanlar; selfie/cihaz bilgisi yok", () => {
    const payload = buildLeadPayload("lead.created", lead, { name: "Fatma", email: "f@x.co" }, new Date("2026-10-04T10:15:00Z"));
    expect(payload).toMatchObject({
      event: "lead.created", version: 1, id: lead.id, occurred_at: "2026-10-04T10:15:00.000Z",
      lead: { name: "Mavi Tur", contact_name: "Deniz", phone: "+905320000000", origin: "atricard", status: "new", temperature: "hot", score: 80, event_name: "Fuar" },
      owner: { name: "Fatma", email: "f@x.co" },
    });
    const json = JSON.stringify(payload);
    for (const forbidden of ["selfie", "photo", "device", "ip_hash", "user_agent"]) expect(json).not.toContain(forbidden);
  });
  it("lead.deleted yalnız kimlik ve neden taşır (kişisel veri yok)", () => {
    const payload = buildLeadDeletedPayload(lead.id, "owner_deleted", new Date("2026-10-04T11:00:00Z"));
    expect(payload).toEqual({ event: "lead.deleted", version: 1, id: lead.id, occurred_at: "2026-10-04T11:00:00.000Z", reason: "owner_deleted" });
    expect(JSON.stringify(payload)).not.toContain("Mavi");
  });
  it("deal olayları: aşama, önceki aşama, kayıp nedeni yalnız deal.lost'ta", () => {
    const deal = { id: "d1", title: "Web", value: "500.00", currency: "TRY", leadId: lead.id, companyName: "Mavi Tur", expectedCloseAt: null, closedAt: new Date("2026-10-04T12:00:00Z"), lostReason: "Bütçe" };
    const lost = buildDealPayload("deal.lost", deal, { label: "Kaybedildi", kind: "lost" }, { label: "Teklif", kind: "open" }, null, new Date("2026-10-04T12:00:00Z"));
    expect(lost.deal).toMatchObject({ stage: { label: "Kaybedildi", kind: "lost" }, previous_stage: { label: "Teklif", kind: "open" }, lost_reason: "Bütçe" });
    expect(lost.company).toEqual({ name: "Mavi Tur" });
    expect(lost.owner).toBeNull();
    const won = buildDealPayload("deal.won", { ...deal, lostReason: null }, { label: "Kazanıldı", kind: "won" }, null, null, new Date());
    expect(won.deal.lost_reason).toBeNull();
    expect(won.deal.previous_stage).toBeNull();
    // stage_changed'da kayıp nedeni sızmaz
    const changed = buildDealPayload("deal.stage_changed", deal, { label: "Kaybedildi", kind: "lost" }, null, null, new Date());
    expect(changed.deal.lost_reason).toBeNull();
  });
  it("test yükü: test:true, örnek veri, gerçek kişi yok", () => {
    const payload = buildTestPayload(new Date("2026-10-04T10:00:00Z"), "t-1");
    expect(payload).toMatchObject({ event: "lead.created", test: true, id: "t-1", lead: { name: "Örnek Aday", email: "ornek@example.com" } });
  });
  it("başlıklar: olay, teslim kimliği, kullanıcı aracısı; imza/zaman damgası burada yok", () => {
    const h = deliveryHeaders("lead.created", "abc");
    expect(h).toMatchObject({ "X-AtriCRM-Event": "lead.created", "X-AtriCRM-Delivery": "abc", "User-Agent": "AtriCRM-Webhooks/1" });
    expect(Object.keys(h).join()).not.toMatch(/Signature|Timestamp/);
  });
  it("hata metni sınırlanır ve tek satıra indirilir", () => {
    expect(truncateError("a\n\n  b\tc")).toBe("a b c");
    expect(truncateError("x".repeat(1000)).length).toBe(500);
    expect(truncateError("x".repeat(1000)).endsWith("…")).toBe(true);
    expect(truncateError("kısa")).toBe("kısa");
  });
});
