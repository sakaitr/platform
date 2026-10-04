import { describe, expect, it } from "vitest";
import { secondsNow, signPayload, TIMESTAMP_TOLERANCE_SECONDS, verifySignature } from "@/lib/webhook-signing";

const SECRET = "whsec_test";
const TS = "1700000000";
const NOW = new Date(1_700_000_000_000);
const BODY = '{"a":1}';

describe("webhook imzası", () => {
  it("bilinen vektör (openssl ile bağımsız üretildi)", () => {
    expect(signPayload(SECRET, TS, BODY)).toBe("sha256=38877139021993b830af32feea6e18a8da83eb2f6e49ee50bd9e4cf4ca4d3789");
    // gövde UTF-8 bayt olarak imzalanır
    expect(signPayload(SECRET, TS, '{"ad":"Deniz Yılmaz"}')).toBe(
      "sha256=9b514c6080f033f77dea8352c79b2bffdf74c7c64186ee2efb4ff06ba46f850f",
    );
  });

  it("doğru imza kabul edilir", () => {
    const signature = signPayload(SECRET, TS, BODY);
    expect(verifySignature({ secret: SECRET, timestamp: TS, signature, rawBody: BODY, now: NOW })).toEqual({ ok: true });
  });

  it("yanlış anahtar reddedilir", () => {
    const signature = signPayload("whsec_baska", TS, BODY);
    expect(verifySignature({ secret: SECRET, timestamp: TS, signature, rawBody: BODY, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("değiştirilmiş gövde reddedilir (tek bayt, boşluk, sıra)", () => {
    const signature = signPayload(SECRET, TS, BODY);
    for (const tampered of ['{"a":2}', '{"a": 1}', '{"a":1} ', '{"a":1}\n', "", '{"a":1}{"b":2}']) {
      expect(verifySignature({ secret: SECRET, timestamp: TS, signature, rawBody: tampered, now: NOW }), tampered).toEqual({ ok: false, reason: "signature" });
    }
  });

  it("zaman damgası imzaya bağlıdır: damga değişince imza geçersiz", () => {
    const signature = signPayload(SECRET, TS, BODY);
    expect(verifySignature({ secret: SECRET, timestamp: "1700000001", signature, rawBody: BODY, now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("5 dakikadan eski ya da gelecekteki zaman damgası reddedilir; sınırda kabul", () => {
    const check = (offsetSeconds: number) => {
      const ts = String(1_700_000_000 + offsetSeconds);
      return verifySignature({ secret: SECRET, timestamp: ts, signature: signPayload(SECRET, ts, BODY), rawBody: BODY, now: NOW });
    };
    expect(check(-TIMESTAMP_TOLERANCE_SECONDS)).toEqual({ ok: true });
    expect(check(-TIMESTAMP_TOLERANCE_SECONDS - 1)).toEqual({ ok: false, reason: "timestamp" });
    expect(check(-3600)).toEqual({ ok: false, reason: "timestamp" });
    expect(check(TIMESTAMP_TOLERANCE_SECONDS)).toEqual({ ok: true });
    expect(check(TIMESTAMP_TOLERANCE_SECONDS + 1)).toEqual({ ok: false, reason: "timestamp" });
    expect(check(86_400)).toEqual({ ok: false, reason: "timestamp" });
  });

  it("eksik başlıklar ve bozuk zaman damgası", () => {
    const signature = signPayload(SECRET, TS, BODY);
    expect(verifySignature({ secret: SECRET, timestamp: null, signature, rawBody: BODY, now: NOW })).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature({ secret: SECRET, timestamp: TS, signature: undefined, rawBody: BODY, now: NOW })).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature({ secret: SECRET, timestamp: "", signature, rawBody: BODY, now: NOW })).toEqual({ ok: false, reason: "missing" });
    for (const bad of ["abc", "-5", "1.5", "17e8", " 1700000000", "1".repeat(20)]) {
      expect(verifySignature({ secret: SECRET, timestamp: bad, signature, rawBody: BODY, now: NOW }), bad).toEqual({ ok: false, reason: "timestamp" });
    }
  });

  it("imza biçimi: önek yok, büyük harf, kısa, uzun, boş reddedilir", () => {
    const good = signPayload(SECRET, TS, BODY);
    const hex = good.slice("sha256=".length);
    for (const bad of [hex, good.toUpperCase(), good.slice(0, -2), `${good}00`, "sha256=", "sha1=" + hex, "sha256=" + "0".repeat(64)]) {
      expect(verifySignature({ secret: SECRET, timestamp: TS, signature: bad, rawBody: BODY, now: NOW }), bad).toMatchObject({ ok: false });
    }
  });

  it("imza başlığındaki dış boşluk yok sayılır", () => {
    const signature = ` ${signPayload(SECRET, TS, BODY)} `;
    expect(verifySignature({ secret: SECRET, timestamp: TS, signature, rawBody: BODY, now: NOW })).toEqual({ ok: true });
  });

  it("secondsNow Unix saniyesini metin olarak verir", () => {
    expect(secondsNow(new Date(1_700_000_000_999))).toBe("1700000000");
  });
});
