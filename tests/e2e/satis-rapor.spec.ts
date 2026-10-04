import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

const KEYS = ["satis_huni", "satis_kaynak", "satis_kazanma", "satis_performans", "satis_kapanis_suresi"];

test("yönetici Satış raporlarını listeler, CSV ve Excel indirir", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/raporlar");
  await expect(page.getByRole("heading", { name: "Satış", exact: true })).toBeVisible();
  for (const name of ["Satış Hunisi", "Kaynağa Göre Aday", "Kazanma Oranı", "Satışçı Performansı", "Ortalama Kapanış Süresi"]) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  const csv = await page.request.get("/api/reports/satis_huni?format=csv");
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text.startsWith("﻿Aşama;Tür;Fırsat;Tutar (₺);Ortalama (₺)")).toBe(true);
  expect(text).toContain("Kazanıldı");
  expect(text).toContain("Açık fırsat tutarı");

  for (const key of KEYS) {
    const res = await page.request.get(`/api/reports/${key}?format=xlsx&from=2026-01-01&to=2026-12-31`);
    expect(res.status(), key).toBe(200);
    expect(res.headers()["content-type"]).toContain("spreadsheetml");
  }
});

test("Satışçı Satış raporlarını göremez ve indiremez (kendi verisi dışına çıkamaz)", async ({ page }) => {
  await login(page, "satisci1@e2e.test");
  await page.goto("/raporlar");
  await expect(page.getByText("Satış Hunisi")).toHaveCount(0);
  for (const key of KEYS) {
    expect((await page.request.get(`/api/reports/${key}?format=csv`)).status(), key).toBe(403);
  }
});

test("satış modülü lisanslı olmayan kiracı, tüm izinlere sahip olsa da Satış raporlarını göremez ve indiremez", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await page.goto("/raporlar");
  await expect(page.getByRole("heading", { name: "Satış", exact: true })).toHaveCount(0);
  for (const key of KEYS) {
    expect((await page.request.get(`/api/reports/${key}?format=csv`)).status(), key).toBe(403);
  }
  // diğer modül raporları etkilenmez
  await expect(page.getByText("Kullanıcı Listesi")).toBeVisible();
});

test("pano: yönetici satış kartlarını görür, kartlar görünürlüğe uyar", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  const main = page.getByRole("main");
  await expect(main.getByText("Yeni aday")).toBeVisible();
  await expect(main.getByText("Açık fırsat tutarı")).toBeVisible();
  await expect(main.getByText("Bu ay kazanılan")).toBeVisible();
  await expect(main.getByText("Bugün yapılacak görev")).toBeVisible();

  await login(page, "lojistik@e2e.test");
  await expect(page.getByRole("main").getByText("Yeni aday")).toHaveCount(0);
});
