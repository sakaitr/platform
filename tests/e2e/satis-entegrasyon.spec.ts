import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

/** Sözleşmeye göre imza: uygulamadan BAĞIMSIZ olarak burada hesaplanır. */
function sign(secret: string, timestamp: string, raw: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
}

const now = (): string => String(Math.floor(Date.now() / 1000));

type Hook = { path: string; secret: string };
let hook: Hook;
let tenantAIntegrationPath = "";

function leadBody(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: "lead.created", version: 1, id, occurred_at: new Date().toISOString(),
    lead: { name: "Deniz Yılmaz", company: `Mavi Tur ${id.slice(0, 4)}`, email: `${id.slice(0, 6)}@example.com`, phone: `+9053${id.replace(/\D/g, "").padEnd(8, "0").slice(0, 8)}`, message: "Teklif almak istiyoruz", service: "Web sitesi", origin: "FORM", status: "NEW", temperature: "HOT", event_name: "Fuar 2026", ...over },
    owner: { name: "Fatma Kaya", email: "satisci1@e2e.test", card: "https://atricard.com/fatma-kaya" },
    company: { name: "Arkın Studio" }, consent: { photo: false },
  };
}

async function send(
  page: Page,
  h: Hook,
  body: Record<string, unknown>,
  opts: { secret?: string; timestamp?: string; deliveryId?: string; event?: string; omitSignature?: boolean } = {},
) {
  const raw = JSON.stringify(body);
  const timestamp = opts.timestamp ?? now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Atricard-Event": opts.event ?? String(body.event),
    "X-Atricard-Delivery": opts.deliveryId ?? randomUUID(),
    "X-Atricard-Timestamp": timestamp,
  };
  if (!opts.omitSignature) headers["X-Atricard-Signature"] = sign(opts.secret ?? h.secret, timestamp, raw);
  const res = await page.request.post(h.path, { headers, data: raw });
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
}

test("Atricard bağlantısı oluşturulur; adres ve anahtar bir kez gösterilir, yenilenince kaybolur", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  await page.getByLabel("Bağlantı adı").first().fill("Atricard E2E");
  await page.getByRole("button", { name: "Atricard bağlantısı oluştur" }).click();
  await expect(page.getByText(/bir daha gösterilmez/i).first()).toBeVisible();

  const url = await page.getByTestId("reveal-Adres").innerText();
  const secret = await page.getByTestId("reveal-Anahtar").innerText();
  expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  expect(url).toMatch(/\/api\/webhooks\/atricard\/[0-9a-f-]{36}$/);
  hook = { path: new URL(url).pathname, secret };
  tenantAIntegrationPath = hook.path;

  // Sayfa yenilenince anahtar hiçbir yerde yok
  await page.reload();
  await expect(page.getByText("Atricard E2E")).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  await expect(page.getByTestId("reveal-Anahtar")).toHaveCount(0);
});

test("imzalı lead.created gelir: aday açılır, tekrarı açılmaz, kötü istekler reddedilir", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  const id = randomUUID();
  const body = leadBody(id);

  const created = await send(page, hook, body);
  expect(created.status).toBe(201);
  expect(created.json).toMatchObject({ status: "created" });

  // aynı lead tekrar: 200 duplicate, ikinci kayıt yok
  const dup = await send(page, hook, body);
  expect(dup.status).toBe(200);
  expect(dup.json).toMatchObject({ status: "duplicate", leadId: created.json.leadId });

  // yanlış imza, eski zaman damgası, imzasız, gelecek: 401
  expect((await send(page, hook, leadBody(randomUUID()), { secret: "whsec_yanlis" })).status).toBe(401);
  expect((await send(page, hook, leadBody(randomUUID()), { timestamp: String(Number(now()) - 400) })).status).toBe(401);
  expect((await send(page, hook, leadBody(randomUUID()), { timestamp: String(Number(now()) + 400) })).status).toBe(401);
  expect((await send(page, hook, leadBody(randomUUID()), { omitSignature: true })).status).toBe(401);
  // geçersiz gövde: 400
  const bad = await send(page, hook, { event: "lead.created", version: 1, id: randomUUID() });
  expect(bad.status).toBe(400);
  // bilinmeyen olay: 200 ignored
  expect(await send(page, hook, { event: "message.created", version: 1, id: "m1" })).toMatchObject({ status: 200, json: { status: "ignored" } });

  await page.goto(`/satis/adaylar?q=${encodeURIComponent(String((body.lead as { company: string }).company))}`);
  const row = page.getByRole("row", { name: new RegExp(String((body.lead as { company: string }).company)) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Atricard")).toBeVisible();
  await expect(row.getByText("Sıcak")).toBeVisible();
  await expect(row.getByText("Satisci Bir")).toBeVisible(); // kart sahibi e-postayla eşleşti

  await page.goto("/satis/entegrasyonlar");
  const log = page.getByRole("table").filter({ hasText: "Gelen olaylar" }).or(page.locator("section", { hasText: "Gelen olaylar (Atricard)" }));
  await expect(log.getByText("Reddedildi").first()).toBeVisible();
  await expect(log.getByText("İşlendi").first()).toBeVisible();
});

test("lead.deleted: aday silinir, sonradan gelen lead.created doğurmaz (KVKK sırası)", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  const id = randomUUID();
  const body = leadBody(id);
  await send(page, hook, body);
  const company = String((body.lead as { company: string }).company);

  const del = await send(page, hook, { event: "lead.deleted", version: 1, id, occurred_at: new Date().toISOString(), reason: "erasure_request" });
  expect(del).toMatchObject({ status: 200, json: { status: "processed", result: "deleted" } });
  await page.goto(`/satis/adaylar?q=${encodeURIComponent(company)}`);
  await expect(page.getByRole("link", { name: company })).toHaveCount(0);

  // geç gelen created
  const late = await send(page, hook, body);
  expect(late).toMatchObject({ status: 200, json: { status: "ignored" } });
  await page.reload();
  await expect(page.getByRole("link", { name: company })).toHaveCount(0);

  // olmayan kayıt için silme de 200
  expect((await send(page, hook, { event: "lead.deleted", version: 1, id: randomUUID(), reason: "owner_deleted" })).status).toBe(200);
});

test("anahtar yenilenince eski anahtar geçersiz, yenisi çalışır; kapatılınca 404", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  const card = page.getByRole("listitem").filter({ hasText: "Atricard E2E" });
  await card.getByRole("button", { name: "Anahtarı yeniden oluştur" }).click();
  await expect(page.getByText(/Eski anahtar artık geçerli değil/)).toBeVisible();
  const newSecret = await card.getByTestId("reveal-Anahtar").innerText();
  expect(newSecret).not.toBe(hook.secret);

  expect((await send(page, hook, leadBody(randomUUID()))).status).toBe(401); // eski anahtar
  const fresh = { ...hook, secret: newSecret };
  expect((await send(page, fresh, leadBody(randomUUID()))).status).toBe(201);

  hook = fresh;
  await page.goto("/satis/entegrasyonlar");
  await page.getByRole("listitem").filter({ hasText: "Atricard E2E" }).getByRole("button", { name: "Kapat" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Atricard E2E" }).getByText("Kapalı")).toBeVisible();
  expect((await send(page, hook, leadBody(randomUUID()))).status).toBe(404);
  await page.getByRole("listitem").filter({ hasText: "Atricard E2E" }).getByRole("button", { name: "Aç" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Atricard E2E" }).getByText("Açık")).toBeVisible();
  expect((await send(page, hook, leadBody(randomUUID()))).status).toBe(201);
});

test("giden webhook: iç ağ adresleri ve http kaydedilemez, onay şart, anahtar bir kez gösterilir", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  await page.getByText("Yeni giden webhook").click();
  const form = page.locator("form").filter({ has: page.getByLabel("Alıcı adresi (https)") });

  await form.locator('input[name="name"]').fill("Muhasebe");
  const attempt = async (url: string, consent: boolean): Promise<void> => {
    await form.getByLabel("Alıcı adresi (https)").fill(url);
    const box = form.getByRole("checkbox", { name: /onaylıyorum/ });
    if (consent) await box.check();
    else await box.uncheck();
    await form.getByRole("button", { name: "Webhook oluştur" }).click();
  };

  await attempt("http://127.0.0.1/x", true);
  await expect(form.getByRole("alert")).toContainText("Yalnızca https");
  await attempt("https://127.0.0.1/x", true);
  await expect(form.getByRole("alert")).toContainText("iç ağa");
  await attempt("https://localhost/x", true);
  await expect(form.getByRole("alert")).toContainText("alan adı kullanılamaz");
  await attempt("https://169.254.169.254/latest/meta-data/", true);
  await expect(form.getByRole("alert")).toContainText("iç ağa");
  await attempt("https://[::ffff:127.0.0.1]/x", true);
  await expect(form.getByRole("alert")).toContainText("iç ağa");
  await attempt("https://kullanici:parola@hooks.example.test/x", true);
  await expect(form.getByRole("alert")).toContainText("kullanıcı adı");
  // onay kutusu olmadan olmaz
  await attempt("https://hooks.example.test/in", false);
  await expect(form.getByRole("alert")).toContainText("onaylayın");
  // adres alanı hata sonrası korunur
  await expect(form.getByLabel("Alıcı adresi (https)")).toHaveValue("https://hooks.example.test/in");

  await attempt("https://hooks.example.test/in", true);
  await expect(form.getByText(/İmza anahtarını şimdi kaydedin/)).toBeVisible();
  const secret = await form.getByTestId("reveal-Anahtar").innerText();
  expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);

  await page.reload();
  expect(await page.content()).not.toContain(secret);
  const card = page.getByRole("listitem").filter({ hasText: "Muhasebe" });
  await expect(card).toContainText("https://hooks.example.test/in");
  await expect(card.getByText("Açık")).toBeVisible();
});

test("giden webhook: test gönder sıraya alır; adres değişince bağlantı kapanır ve yeniden onay ister", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  const card = page.getByRole("listitem").filter({ hasText: "Muhasebe" });
  await card.getByRole("button", { name: "Test gönder" }).click();
  await expect(page.getByText(/Test iletisi sıraya alındı/)).toBeVisible();
  await page.reload();
  const deliveries = page.locator("section", { hasText: "Son teslimler" });
  await expect(deliveries.getByRole("row").filter({ hasText: "Muhasebe" }).first()).toBeVisible();

  await card.getByText("Düzenle").click();
  const edit = card.locator("form").filter({ has: page.getByLabel("Alıcı adresi", { exact: true }) });
  await edit.getByLabel("Alıcı adresi", { exact: true }).fill("https://baska.example.test/hook");
  await edit.getByRole("button", { name: "Kaydet" }).click();
  await expect(edit.getByText(/yeniden açın/)).toBeVisible();
  await page.reload();
  const updated = page.getByRole("listitem").filter({ hasText: "Muhasebe" });
  await expect(updated.getByText("Kapalı").first()).toBeVisible();
  // yeniden açmak için onay kutusu gerekir: onaysız Aç çalışmaz
  await updated.getByRole("button", { name: "Aç" }).click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Muhasebe" }).getByText("Kapalı").first()).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Muhasebe" }).getByRole("checkbox", { name: /onaylıyorum/ }).check();
  await page.getByRole("listitem").filter({ hasText: "Muhasebe" }).getByRole("button", { name: "Aç" }).click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Muhasebe" }).getByText("Açık").first()).toBeVisible();
});

test("başka kiracının yöneticisi bu kiracının bağlantılarını görmez ve değiştiremez", async ({ page }) => {
  await login(page, "satis-b@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  await expect(page.getByText("Atricard E2E")).toHaveCount(0);
  await expect(page.getByText("Muhasebe")).toHaveCount(0);
  expect(await page.content()).not.toContain(tenantAIntegrationPath.split("/").pop()!);

  // B kendi bağlantısını oluşturur, formdaki kimliği A'nın kimliğiyle değiştirip silmeyi dener
  await page.getByLabel("Bağlantı adı").first().fill("B bağlantısı");
  await page.getByRole("button", { name: "Atricard bağlantısı oluştur" }).click();
  await expect(page.getByText(/bir daha gösterilmez/i).first()).toBeVisible();
  await page.reload();
  const mine = page.getByRole("listitem").filter({ hasText: "B bağlantısı" });
  const foreignId = tenantAIntegrationPath.split("/").pop()!;
  await mine.locator('form:has(button:has-text("Sil")) input[name="id"]').evaluate((el, id) => ((el as HTMLInputElement).value = id), foreignId);
  await mine.getByRole("button", { name: "Sil" }).click();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "B bağlantısı" })).toBeVisible(); // B'ninki silinmedi (kimlik geçersiz)

  // A'nın bağlantısı hâlâ çalışıyor
  await login(page, "yonetici@e2e.test");
  expect((await send(page, hook, leadBody(randomUUID()))).status).toBe(201);
});

test("entegrasyon yeteneği kapalı kiracıda menü, sayfa ve webhook yolu kapalı; yetkisiz satışçı giremez", async ({ page }) => {
  await login(page, "satis-c@e2e.test");
  await expect(page.getByRole("link", { name: "Entegrasyonlar", exact: true })).toHaveCount(0);
  await page.goto("/satis/entegrasyonlar");
  await expect(page).toHaveURL(/\/dashboard/);

  await login(page, "satisci1@e2e.test");
  await expect(page.getByRole("link", { name: "Entegrasyonlar", exact: true })).toHaveCount(0);
  await page.goto("/satis/entegrasyonlar");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("API anahtarı: bir kez gösterilir, okuma API'si yalnız kendi kiracısını döner, iptalde 401", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/entegrasyonlar");
  await page.getByLabel("Anahtar adı").fill("Raporlama");
  await page.getByRole("button", { name: "API anahtarı oluştur" }).click();
  await expect(page.getByText(/API anahtarı oluşturuldu/)).toBeVisible();
  const token = await page.getByTestId("reveal-Anahtar").last().innerText();
  expect(token).toMatch(/^atc_[0-9a-f]{8}_[0-9a-f]{64}$/);
  await page.reload();
  expect(await page.content()).not.toContain(token);

  const auth = { Authorization: `Bearer ${token}` };
  const list = await page.request.get("/api/v1/leads?limit=5", { headers: auth });
  expect(list.status()).toBe(200);
  const json = (await list.json()) as { data: { name: string }[]; total: number; page_size: number };
  expect(json.page_size).toBe(5);
  expect(json.total).toBeGreaterThan(3);
  expect(JSON.stringify(json)).not.toMatch(/"note"|phone_key|Başkasının/);
  const first = (json.data[0] as unknown as { id: string }).id;
  expect((await page.request.get(`/api/v1/leads/${first}`, { headers: auth })).status()).toBe(200);
  expect((await page.request.get("/api/v1/leads/00000000-0000-0000-0000-000000000000", { headers: auth })).status()).toBe(404);
  expect((await page.request.get("/api/v1/leads?status=uydurma", { headers: auth })).status()).toBe(400);

  // anahtarsız, yanlış, bozuk: 401
  expect((await page.request.get("/api/v1/leads")).status()).toBe(401);
  expect((await page.request.get("/api/v1/leads", { headers: { Authorization: `Bearer ${token.slice(0, -1)}0` } })).status()).toBe(401);
  expect((await page.request.get("/api/v1/leads", { headers: { Authorization: "Bearer bozuk" } })).status()).toBe(401);

  // oturum çerezi API'yi açmaz (yalnız anahtar)
  expect((await page.request.get("/api/v1/leads")).status()).toBe(401);

  // iptal
  const row = page.getByRole("row", { name: /Raporlama/ });
  await row.getByRole("button", { name: "İptal et" }).click();
  await expect(page.getByRole("row", { name: /Raporlama/ }).getByText("İptal edildi")).toBeVisible();
  expect((await page.request.get("/api/v1/leads", { headers: auth })).status()).toBe(401);
});
