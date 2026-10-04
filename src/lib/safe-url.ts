import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

/**
 * SSRF koruması. İki yerde uygulanır:
 *  1) KAYITTA: adres girilirken `validateWebhookUrl`.
 *  2) BAĞLANTI ANINDA: `safeLookup` DNS çözümünden gelen her IP'yi aynı kurallarla denetler ve
 *     bağlantı DOĞRULANAN O IP'ye kurulur. Çözüm ile bağlantı arasında ikinci bir DNS sorgusu
 *     olmadığı için DNS rebinding işe yaramaz. Yönlendirmeler izlenmez.
 *
 * Kural: yalnız `https`, kullanıcı adı/parola yok, `localhost` / `.local` / `.internal` /
 * `.localdomain`, noktasız adlar, özel/ayrılmış IPv4 aralıkları ve IPv6 (loopback, ULA, link-local,
 * IPv4'e eşlenmiş adresler dahil) engellenir.
 */

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; code: UrlRejection; message: string };

export type UrlRejection =
  | "invalid"
  | "protocol"
  | "credentials"
  | "host"
  | "private_ip"
  | "too_long";

const REJECT_MESSAGES: Record<UrlRejection, string> = {
  invalid: "Adres geçerli değil. https://ornek.com/yol biçiminde yazın.",
  protocol: "Yalnızca https:// adresleri kabul edilir.",
  credentials: "Adres kullanıcı adı ya da parola içeremez. Kimlik doğrulama için imza anahtarını kullanın.",
  host: "Bu alan adı kullanılamaz. Herkese açık, tam nitelikli bir alan adı (ör. ornek.com) girin.",
  private_ip: "Adres iç ağa ya da ayrılmış bir IP aralığına çıkıyor. Herkese açık bir adres girin.",
  too_long: "Adres en fazla 2048 karakter olabilir.",
};

const reject = (code: UrlRejection): UrlCheck => ({ ok: false, code, message: REJECT_MESSAGES[code] });

// ---- IPv4 ---------------------------------------------------------------------------------

/** Yalnız noktalı onluk "a.b.c.d" (her bölüm 0-255). Başka yazımlar (sekizlik, onaltılık, tek sayı) `null`. */
export function parseIPv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/** Engelli IPv4 aralıkları: özel, loopback, link-local (bulut metadata dahil), CGNAT, ayrılmış, multicast. */
export function isBlockedIPv4(o: readonly [number, number, number, number]): boolean {
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

// ---- IPv6 ---------------------------------------------------------------------------------

/** Sekiz 16 bitlik bölüme açar. `::` kısaltmasını ve gömülü IPv4'ü (`::ffff:1.2.3.4`) destekler. */
export function parseIPv6(input: string): number[] | null {
  let value = input.toLowerCase();
  if (value.includes("%")) return null; // zone id kabul edilmez
  if (!/^[0-9a-f:.]+$/.test(value)) return null;

  // Gömülü IPv4'ü iki onaltılık bölüme çevir
  const lastColon = value.lastIndexOf(":");
  if (value.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(value.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parse = (chunk: string): number[] | null => {
    if (chunk === "") return [];
    const out: number[] = [];
    for (const part of chunk.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" en az bir bölümü temsil etmeli
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

const v4From = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * Yalnız küresel tekil yayın (2000::/3) kabul edilir; geri kalan hepsi engelli (loopback, ULA fc00::/7,
 * link-local fe80::/10, multicast, `::`...). İstisnalar: IPv4'e eşlenmiş `::ffff:a.b.c.d` IPv4 kurallarına
 * göre değerlendirilir; 6to4 (2002::/16) gömülü IPv4'e göre; Teredo (2001::/32) ve dokümantasyon
 * (2001:db8::/32) engelli.
 */
export function isBlockedIPv6(h: readonly number[]): boolean {
  const isMapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
  if (isMapped) return isBlockedIPv4(v4From(h[6]!, h[7]!));
  // IPv4-uyumlu (::a.b.c.d, kullanımdan kalktı) ve `::`, `::1` dahil ::/96 tamamen engelli
  if (h.slice(0, 6).every((x) => x === 0)) return true;
  if ((h[0]! & 0xe000) !== 0x2000) return true; // 2000::/3 dışı
  if (h[0] === 0x2002) return isBlockedIPv4(v4From(h[1]!, h[2]!)); // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // dokümantasyon
  return false;
}

/** Bir IP metni (IPv4 ya da IPv6) engelli aralıkta mı. Çözülemeyen/geçersiz metin de engelli sayılır. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const octets = parseIPv4(ip);
    return octets ? isBlockedIPv4(octets) : true;
  }
  if (family === 6) {
    const parsed = parseIPv6(ip);
    return parsed ? isBlockedIPv6(parsed) : true;
  }
  return true;
}

// ---- Adres doğrulama ----------------------------------------------------------------------

const BLOCKED_SUFFIXES = [".local", ".internal", ".localdomain", ".localhost", ".home.arpa", ".lan", ".intranet"];

/** Tek başına geçerli bir alan adı etiketi dizisi mi (en az iki etiket, alfabetik/punycode TLD). */
function isPublicDomainName(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false; // noktasız ad
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return false;
  return /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]!); // sayısal TLD yok
}

/**
 * Kayıt anı doğrulaması. `new URL` IP yazımlarını (ondalık `2130706433`, sekizlik `0177.0.0.1`,
 * onaltılık `0x7f.1`, kısa `127.1`) noktalı onluğa çevirir; böylece hepsi aşağıdaki IPv4 denetimine düşer.
 */
export function validateWebhookUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text.length > 2048) return reject("too_long");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return reject("invalid");
  }
  if (url.protocol !== "https:") return reject("protocol");
  if (url.username || url.password) return reject("credentials");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return reject("invalid");

  // IPv6 literal köşeli parantezlidir
  if (host.startsWith("[") && host.endsWith("]")) {
    const parsed = parseIPv6(host.slice(1, -1));
    return parsed && !isBlockedIPv6(parsed) ? { ok: true, url } : reject("private_ip");
  }
  if (/^[\d.]+$/.test(host)) {
    const octets = parseIPv4(host);
    return octets && !isBlockedIPv4(octets) ? { ok: true, url } : reject(octets ? "private_ip" : "host");
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return reject("host");
  if (!isPublicDomainName(host)) return reject("host");
  return { ok: true, url };
}

// ---- Bağlantı anı -------------------------------------------------------------------------

export class SafeRequestError extends Error {
  constructor(
    message: string,
    readonly code: "blocked_ip" | "blocked_url" | "dns" | "timeout" | "network" | "too_large",
  ) {
    super(message);
    this.name = "SafeRequestError";
  }
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

export const defaultResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `https.request` için `lookup`. DNS'in döndüğü TÜM adresler denetlenir (biri bile engelliyse reddedilir:
 * saldırgan karışık kayıt döndürüp engelsiz olanı seçtirmeye çalışabilir). Kabul edilen adres
 * bağlantıda kullanılır; ikinci bir çözüm yapılmaz.
 */
export function makeSafeLookup(resolver: Resolver, isBlocked: (ip: string) => boolean) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolver(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          callback(Object.assign(new Error("DNS kaydı yok"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException, "");
          return;
        }
        const blocked = addresses.find((a) => isBlocked(a.address));
        if (blocked) {
          // Düz hata + EBLOCKED: istek katmanı bunu `blocked_ip` olarak eşler (IP ayrıntısı dışarı sızmaz)
          callback(Object.assign(new Error("Engelli IP"), { code: "EBLOCKED" }) as NodeJS.ErrnoException, "");
          return;
        }
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const preferred = addresses.find((a) => a.family === 4) ?? addresses[0]!;
        callback(null, preferred.address, preferred.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };
}

export type SafeResponse = { status: number; body: string };

export type SafeRequesterOptions = {
  resolver?: Resolver;
  isBlocked?: (ip: string) => boolean;
  /** Yalnız testler: güvenilen CA. Üretimde verilmez, sistem CA'ları kullanılır. */
  ca?: string | Buffer;
};

export const RESPONSE_SNIPPET_BYTES = 2048;
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * Güvenli POST. Yönlendirme izlenmez (3xx de yanıt olarak döner), toplam süre `timeoutMs`, yanıt gövdesi
 * en çok `maxBytes` okunur. Keep-alive kapalı (`agent: false`): her istek yeni çözüm ve yeni bağlantı.
 */
export function createSafeRequester(options: SafeRequesterOptions = {}) {
  const lookup = makeSafeLookup(options.resolver ?? defaultResolver, options.isBlocked ?? isBlockedIp);

  return async function safePost(
    rawUrl: string,
    body: string,
    headers: Record<string, string>,
    limits: { timeoutMs?: number; maxBytes?: number } = {},
  ): Promise<SafeResponse> {
    // Bağlantı anında adres kuralları yeniden denetlenir (kayıttan sonra değişmiş olabilir)
    const check = validateWebhookUrl(rawUrl);
    if (!check.ok) throw new SafeRequestError(check.message, "blocked_url");
    const url = check.url;

    const timeoutMs = limits.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const maxBytes = limits.maxBytes ?? RESPONSE_SNIPPET_BYTES;
    const host = url.hostname.replace(/^\[|\]$/g, "");

    const requestOptions: RequestOptions & { ca?: string | Buffer } = {
      method: "POST",
      protocol: "https:",
      hostname: host,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      headers: { ...headers, "Content-Length": String(Buffer.byteLength(body)) },
      agent: false,
      lookup: lookup as unknown as RequestOptions["lookup"],
      servername: isIP(host) ? undefined : host,
      ca: options.ca,
    };

    return new Promise<SafeResponse>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        fn();
      };

      const req = httpsRequest(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= maxBytes) chunks.push(chunk);
          else if (size > maxBytes * 4) res.destroy(); // büyük gövdeyi indirme
        });
        const done = (): void =>
          finish(() =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes) }),
          );
        res.on("end", done);
        res.on("close", done);
        res.on("error", done);
      });

      const deadline = setTimeout(() => {
        req.destroy();
        finish(() => reject(new SafeRequestError("Zaman aşımı", "timeout")));
      }, timeoutMs);

      req.on("error", (error: NodeJS.ErrnoException) => {
        finish(() => {
          if (error instanceof SafeRequestError) reject(error);
          else if ((error as NodeJS.ErrnoException).code === "EBLOCKED") reject(new SafeRequestError("Adres iç ağa çözülüyor, engellendi", "blocked_ip"));
          else if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") reject(new SafeRequestError("Alan adı çözülemedi", "dns"));
          else reject(new SafeRequestError(`Bağlantı hatası: ${error.code ?? error.message}`, "network"));
        });
      });

      req.write(body);
      req.end();
    });
  };
}

/** Üretim istekçisi: sistem DNS'i, sistem CA'ları, varsayılan engel kuralları. */
export const safePost = createSafeRequester();
