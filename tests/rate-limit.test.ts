import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter, MemoryStore, type CounterStore } from "@/lib/rate-limit";

describe("hız sınırı", () => {
  it("sabit pencere: sınıra kadar izin, sonra reddeder, pencere dolunca sıfırlanır", async () => {
    const store = new MemoryStore();
    const t0 = 1_000_000;
    expect(await store.hit("k", 1000, t0)).toBe(1);
    expect(await store.hit("k", 1000, t0 + 500)).toBe(2);
    expect(await store.hit("k", 1000, t0 + 999)).toBe(3);
    expect(await store.hit("k", 1000, t0 + 1000)).toBe(1); // yeni pencere
  });

  it("anahtarlar bağımsız sayılır", async () => {
    const check = createRateLimiter({ limit: 2, windowMs: 60_000, store: new MemoryStore() });
    expect((await check("a")).allowed).toBe(true);
    expect((await check("a")).allowed).toBe(true);
    expect((await check("a")).allowed).toBe(false);
    expect((await check("b")).allowed).toBe(true);
  });

  it("kalan hak ve Retry-After", async () => {
    const check = createRateLimiter({ limit: 3, windowMs: 30_000, store: new MemoryStore() });
    expect(await check("k")).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 30 });
    await check("k");
    await check("k");
    expect(await check("k")).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
  });

  it("depo (Redis) hata verirse süreç içi sayaca düşer, sınır kaybolmaz", async () => {
    const broken: CounterStore = { hit: async () => { throw new Error("redis yok"); } };
    const check = createRateLimiter({ limit: 2, windowMs: 60_000, store: broken });
    expect((await check("k")).allowed).toBe(true);
    expect((await check("k")).allowed).toBe(true);
    expect((await check("k")).allowed).toBe(false);
  });

  it("istemci IP'si x-forwarded-for ilk değeri, yoksa x-real-ip, yoksa unknown", () => {
    const h = (map: Record<string, string>) => ({ get: (n: string) => map[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
