/**
 * Sabit pencereli hız sınırı. Birden çok süreçte tutarlı olsun diye Redis (`INCR` + `PEXPIRE`) kullanılır;
 * Redis yoksa ya da hata verirse süreç içi sayaca düşer (sınır kaybolmaz, yalnız süreç başına olur).
 */

export type CounterStore = {
  /** Anahtarı artırır ve pencere içindeki sayıyı döner. İlk artışta pencere süresi başlar. */
  hit(key: string, windowMs: number): Promise<number>;
};

export class MemoryStore implements CounterStore {
  private readonly counters = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number, now: number = Date.now()): Promise<number> {
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      // Bellek şişmesin: ara sıra süresi dolanları temizle
      if (this.counters.size > 5000) {
        for (const [k, v] of this.counters) if (v.resetAt <= now) this.counters.delete(k);
      }
      return 1;
    }
    current.count += 1;
    return current.count;
  }
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function createRateLimiter(options: { limit: number; windowMs: number; store: CounterStore; fallback?: CounterStore }) {
  const fallback = options.fallback ?? new MemoryStore();
  return async function check(key: string): Promise<RateLimitResult> {
    let count: number;
    try {
      count = await options.store.hit(key, options.windowMs);
    } catch {
      count = await fallback.hit(key, options.windowMs);
    }
    return {
      allowed: count <= options.limit,
      remaining: Math.max(0, options.limit - count),
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    };
  };
}

/** Redis tabanlı sayaç. Bağlantı tembel açılır; kullanılmazsa Redis'e dokunulmaz. */
export function redisStore(): CounterStore {
  let clientPromise: Promise<import("ioredis").default> | null = null;
  const client = (): Promise<import("ioredis").default> => {
    clientPromise ??= import("ioredis").then(
      ({ default: IORedis }) =>
        new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          lazyConnect: false,
        }),
    );
    return clientPromise;
  };
  return {
    async hit(key, windowMs) {
      const redis = await client();
      const count = await redis.incr(`rl:${key}`);
      if (count === 1) await redis.pexpire(`rl:${key}`, windowMs);
      return count;
    },
  };
}

/** İstemci IP'si: Traefik/Coolify arkasında `x-forwarded-for` ilk değeri, yoksa "unknown". */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
