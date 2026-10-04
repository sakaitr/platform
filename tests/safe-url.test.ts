import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSafeRequester,
  isBlockedIp,
  makeSafeLookup,
  parseIPv4,
  parseIPv6,
  SafeRequestError,
  validateWebhookUrl,
} from "@/lib/safe-url";

const BLOCKED_URLS: [string, string][] = [
  ["http://ornek.com/x", "protocol"],
  ["ftp://ornek.com/x", "protocol"],
  ["javascript:alert(1)", "protocol"],
  ["https://kullanici:parola@ornek.com/x", "credentials"],
  ["https://kullanici@ornek.com/x", "credentials"],
  ["https://localhost/x", "host"],
  ["https://LOCALHOST/x", "host"],
  ["https://localhost./x", "host"],
  ["https://app.localhost/x", "host"],
  ["https://yazici.local/x", "host"],
  ["https://metadata.google.internal/computeMetadata/v1/", "host"],
  ["https://db.localdomain/x", "host"],
  ["https://intranet/x", "host"],
  ["https://sunucu/x", "host"],
  ["https://router.home.arpa/x", "host"],
  ["https://1.2.3.4.5/x", "invalid"],
  ["https://ornek.123/x", "invalid"],
  ["https://127.0.0.1/x", "private_ip"],
  ["https://127.1/x", "private_ip"],
  ["https://0x7f.1/x", "private_ip"],
  ["https://2130706433/x", "private_ip"],
  ["https://017700000001/x", "private_ip"],
  ["https://0.0.0.0/x", "private_ip"],
  ["https://10.0.0.5/x", "private_ip"],
  ["https://172.16.0.1/x", "private_ip"],
  ["https://172.31.255.255/x", "private_ip"],
  ["https://192.168.1.1/x", "private_ip"],
  ["https://169.254.169.254/latest/meta-data/", "private_ip"],
  ["https://100.64.0.1/x", "private_ip"],
  ["https://100.127.255.254/x", "private_ip"],
  ["https://224.0.0.1/x", "private_ip"],
  ["https://255.255.255.255/x", "private_ip"],
  ["https://[::1]/x", "private_ip"],
  ["https://[::]/x", "private_ip"],
  ["https://[fc00::1]/x", "private_ip"],
  ["https://[fd12:3456::1]/x", "private_ip"],
  ["https://[fe80::1]/x", "private_ip"],
  ["https://[::ffff:127.0.0.1]/x", "private_ip"],
  ["https://[::ffff:7f00:1]/x", "private_ip"],
  ["https://[::ffff:10.0.0.1]/x", "private_ip"],
  ["https://[::ffff:169.254.169.254]/x", "private_ip"],
  ["https://[0:0:0:0:0:ffff:c0a8:1]/x", "private_ip"],
  ["https://[::127.0.0.1]/x", "private_ip"],
  ["https://[64:ff9b::7f00:1]/x", "private_ip"],
  ["https://[2002:7f00:1::1]/x", "private_ip"],
  ["https://[2001:db8::1]/x", "private_ip"],
  ["https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/x", "private_ip"],
  ["https://[ff02::1]/x", "private_ip"],
  ["", "invalid"],
  ["not a url", "invalid"],
  ["https://", "invalid"],
];

const ALLOWED_URLS = [
  "https://ornek.com/hook",
  "https://api.ornek.com.tr:8443/v1/olay?x=1",
  "https://hooks.slack.com/services/T000/B000/XXXX",
  "https://münchen.de/x",
  "https://8.8.8.8/x",
  "https://[2606:4700:4700::1111]/x",
  "https://[::ffff:8.8.8.8]/x",
  "https://[2002:0808:0808::1]/x",
  "https://ornek.com:65535/x",
];

describe("adres doğrulama (kayıt anı)", () => {
  it.each(BLOCKED_URLS)("reddeder: %s (%s)", (url, code) => {
    const result = validateWebhookUrl(url);
    expect(result.ok, url).toBe(false);
    if (!result.ok) {
      expect(result.code, url).toBe(code);
      expect(result.message.length).toBeGreaterThan(10);
    }
  });

  it.each(ALLOWED_URLS)("kabul eder: %s", (url) => {
    expect(validateWebhookUrl(url).ok, url).toBe(true);
  });

  it("çok uzun adres reddedilir", () => {
    expect(validateWebhookUrl(`https://ornek.com/${"a".repeat(2100)}`)).toMatchObject({ ok: false, code: "too_long" });
  });

  it("kenarlar: yalnız ayrılmış aralığın içi engelli, komşusu serbest", () => {
    const free = ["172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "169.253.255.255", "169.255.0.0", "192.167.255.255", "192.169.0.0", "11.0.0.0", "9.255.255.255", "126.255.255.255", "128.0.0.0", "223.255.255.255"];
    for (const ip of free) expect(isBlockedIp(ip), ip).toBe(false);
    const blocked = ["172.16.0.0", "172.31.255.255", "100.64.0.0", "100.127.255.255", "169.254.0.0", "169.254.255.255", "192.168.0.0", "192.168.255.255", "10.0.0.0", "10.255.255.255", "127.0.0.0", "127.255.255.255", "0.0.0.0", "0.255.255.255", "224.0.0.0", "240.0.0.1"];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
  });

  it("IP ayrıştırıcıları katıdır", () => {
    expect(parseIPv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
    for (const bad of ["1.2.3", "1.2.3.4.5", "256.1.1.1", "01x.1.1.1", "1.2.3.-4", "", "1..2.3", "0x7f.0.0.1", " 1.2.3.4"]) {
      expect(parseIPv4(bad), bad).toBeNull();
    }
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6("2001:db8::")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    for (const bad of ["", ":::", "1::2::3", "12345::", "g::1", "1:2:3:4:5:6:7:8:9", "::1%eth0", "1:2:3:4:5:6:7::8", "1.2.3.4"]) {
      expect(parseIPv6(bad), bad).toBeNull();
    }
  });

  it("çözülemeyen ya da geçersiz IP metni engelli sayılır", () => {
    for (const bad of ["", "abc", "1.2.3", "::g", "999.1.1.1"]) expect(isBlockedIp(bad), bad).toBe(true);
  });
});

describe("bağlantı anı: lookup denetimi", () => {
  const run = (addresses: { address: string; family: number }[], all = false) =>
    new Promise<{ error: NodeJS.ErrnoException | null; result: unknown }>((resolve) => {
      const lookup = makeSafeLookup(async () => addresses, isBlockedIp);
      lookup("ornek.com", { all }, (error, address, family) => resolve({ error, result: all ? address : [address, family] }));
    });

  it("DNS özel IP'ye çözülürse bağlantı kurulmaz", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.10"]) {
      const { error } = await run([{ address: ip, family: 4 }]);
      expect(error?.code, ip).toBe("EBLOCKED");
    }
    for (const ip of ["::1", "fc00::5", "::ffff:127.0.0.1", "fe80::1"]) {
      const { error } = await run([{ address: ip, family: 6 }]);
      expect(error?.code, ip).toBe("EBLOCKED");
    }
  });

  it("karışık kayıtta biri bile engelliyse hepsi reddedilir (engelsiz olanı seçtirme saldırısı)", async () => {
    const { error } = await run([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(error?.code).toBe("EBLOCKED");
    const { error: all } = await run([{ address: "127.0.0.1", family: 4 }, { address: "8.8.8.8", family: 4 }], true);
    expect(all?.code).toBe("EBLOCKED");
  });

  it("tüm adresler herkese açıksa IPv4 tercih edilir; all:true hepsini döner", async () => {
    const { error, result } = await run([
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(error).toBeNull();
    expect(result).toEqual(["8.8.8.8", 4]);
    const both = await run([{ address: "8.8.8.8", family: 4 }, { address: "1.1.1.1", family: 4 }], true);
    expect(both.result).toHaveLength(2);
  });

  it("kayıt yoksa ENOTFOUND", async () => {
    const { error } = await run([]);
    expect(error?.code).toBe("ENOTFOUND");
  });
});

describe("güvenli POST (gerçek HTTPS sunucusuyla)", () => {
  let server: Server;
  let port: number;
  let ca: string;
  let dir: string;
  let seen: { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const HOST = "hook.example.test";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "safe-url-"));
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${HOST}`,
      "-addext", `subjectAltName=DNS:${HOST}`, "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    ], { stdio: "ignore" });
    ca = readFileSync(join(dir, "cert.pem"), "utf8");
    server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: ca }, (req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url?.startsWith("/redirect")) {
          res.writeHead(302, { Location: "https://127.0.0.1:1/gizli" });
          res.end();
        } else if (req.url?.startsWith("/hang")) {
          // yanıt verme
        } else if (req.url?.startsWith("/big")) {
          res.writeHead(200);
          res.end("x".repeat(100_000));
        } else if (req.url?.startsWith("/fail")) {
          res.writeHead(500);
          res.end("hata gövdesi");
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    });
    rmSync(dir, { recursive: true, force: true });
  });

  // Test sunucusu 127.0.0.1'de: yalnız burada engel kuralı gevşetilir (üretim isteyicisinde yoktur).
  const requester = (resolver = async () => [{ address: "127.0.0.1", family: 4 }]) =>
    createSafeRequester({ resolver, isBlocked: () => false, ca });

  it("gövde ve başlıklarla POST eder, yanıtı döner; çözüm tam bir kez yapılır (DNS rebinding penceresi yok)", async () => {
    seen = [];
    let resolutions = 0;
    const post = requester(async () => {
      resolutions += 1;
      return [{ address: "127.0.0.1", family: 4 }];
    });
    const res = await post(`https://${HOST}:${port}/hook?a=1`, '{"x":1}', { "Content-Type": "application/json", "X-Test": "1" });
    expect(res).toEqual({ status: 200, body: '{"ok":true}' });
    expect(resolutions).toBe(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/hook?a=1", body: '{"x":1}' });
    expect(seen[0]!.headers["x-test"]).toBe("1");
    expect(seen[0]!.headers["content-length"]).toBe("7");
    expect(seen[0]!.headers.host).toBe(`${HOST}:${port}`);
  });

  it("DNS sonradan özel IP verse de bağlantı yalnız ilk çözümdeki doğrulanmış IP'ye kurulur", async () => {
    // Çözücü ilk çağrıda sunucuyu, sonraki çağrılarda engelli adresi döner. Tek çağrı yapıldığı için
    // ikincisine hiç ulaşılmaz.
    let calls = 0;
    const post = requester(async () => (++calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }]));
    await post(`https://${HOST}:${port}/hook`, "{}", {});
    expect(calls).toBe(1);
  });

  it("üretim kuralları: DNS özel IP'ye çözülürse hiç bağlanmaz", async () => {
    seen = [];
    const post = createSafeRequester({ resolver: async () => [{ address: "127.0.0.1", family: 4 }], ca });
    await expect(post(`https://${HOST}:${port}/hook`, "{}", {})).rejects.toMatchObject({ code: "blocked_ip" });
    expect(seen).toHaveLength(0);
  });

  it("yönlendirme izlenmez: 302 olduğu gibi döner, Location'a gidilmez", async () => {
    seen = [];
    const res = await requester()(`https://${HOST}:${port}/redirect`, "{}", {});
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it("5xx yanıtı hata fırlatmaz, durum ve gövde döner", async () => {
    const res = await requester()(`https://${HOST}:${port}/fail`, "{}", {});
    expect(res).toEqual({ status: 500, body: "hata gövdesi" });
  });

  it("yanıt gövdesi sınırlıdır", async () => {
    const res = await requester()(`https://${HOST}:${port}/big`, "{}", {}, { maxBytes: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(1000);
  });

  it("yanıt vermeyen sunucuda zaman aşımı", async () => {
    const started = Date.now();
    await expect(requester()(`https://${HOST}:${port}/hang`, "{}", {}, { timeoutMs: 400 })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("geçersiz sertifika (güvenilmeyen CA) bağlantı hatasıdır, doğrulama kapatılmaz", async () => {
    const strict = createSafeRequester({ resolver: async () => [{ address: "127.0.0.1", family: 4 }], isBlocked: () => false });
    await expect(strict(`https://${HOST}:${port}/hook`, "{}", {})).rejects.toMatchObject({ code: "network" });
  });

  it("bağlantı anında adres kuralı yeniden denetlenir (kayıttan sonra bozulmuş kayıt)", async () => {
    seen = [];
    for (const bad of ["http://ornek.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://u:p@ornek.com/"]) {
      await expect(requester()(bad, "{}", {}), bad).rejects.toBeInstanceOf(SafeRequestError);
    }
    expect(seen).toHaveLength(0);
  });

  it("çözülemeyen alan adı dns hatasıdır", async () => {
    const post = createSafeRequester({
      resolver: async () => {
        throw Object.assign(new Error("yok"), { code: "ENOTFOUND" });
      },
    });
    await expect(post("https://yok.example.test/x", "{}", {})).rejects.toMatchObject({ code: "dns" });
  });
});
