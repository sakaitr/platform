import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("turizm kiracısı operasyon menüsünü görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await expect(page.getByRole("link", { name: "Operasyon", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Giriş Kontrol", exact: true })).toBeVisible();
});

test("pilates kiracısında operasyon modülü yok (lisanssız)", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await expect(page.getByRole("link", { name: "Operasyon", exact: true })).toHaveCount(0);
  await page.goto("/operasyon/giris-kontrol");
  await expect(page).toHaveURL("/dashboard");
});

test("firma listesi sektör terimiyle başlıklanır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/crm/firmalar");
  // turizm paketi customer_plural = "Firmalar"
  await expect(page.getByRole("heading", { name: "Firmalar" })).toBeVisible();
  await expect(page.getByText("Alfa Sanayi")).toBeVisible();

  await login(page, "lojistik@e2e.test");
  await page.goto("/crm/firmalar");
  // lojistik paketi customer_plural = "Müşteriler"
  await expect(page.getByRole("heading", { name: "Müşteriler" })).toBeVisible();
});

test("araç eklenir ve listede görünür", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await page.goto("/filo/araclar");
  await page.getByRole("button", { name: /Yeni Araç/ }).click();
  await page.getByLabel("Plaka").fill("06 test 99");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("06TEST99")).toBeVisible();
});

test("aynı plaka ikinci kez eklenince Türkçe hata döner", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/araclar");
  await page.getByRole("button", { name: /Yeni Araç/ }).click();
  await page.getByLabel("Plaka").fill("34ABC01");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("34ABC01 plakası zaten kayıtlı.")).toBeVisible();
});

test("yolcu eklenir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular");
  await page.getByRole("button", { name: "Yeni Kayıt" }).click();
  await page.getByLabel("Ad Soyad").fill("E2E Test Yolcu");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("E2E Test Yolcu")).toBeVisible();
});

test("geliş kaydedilir ve gecikme rozeti çıkar", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/giris-kontrol");
  await page.getByRole("button", { name: "Geliş Kaydet" }).click();

  // Filtre çubuğunda da "Vardiya" var — kayıt formuna daralt.
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Araç").selectOption({ label: "34ABC01" });
  await form.getByLabel("Vardiya").fill("sabah");
  await form.getByLabel("Geliş Saati").fill("08:12");
  await form.getByLabel("Planlanan Saat").fill("08:00");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText("12 dk geç")).toBeVisible();
});

test("ziyaretçi girişi ve çıkışı", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/ziyaretciler");
  await page.getByRole("button", { name: "Giriş Kaydet" }).click();
  await page.getByLabel("Ziyaretçi").fill("E2E Ziyaretci");
  await page.getByLabel("Kime Geldi").fill("Kayra");
  await page.getByLabel("Geliş Sebebi").fill("Toplantı");
  await page.getByRole("button", { name: "Kaydet" }).click();

  // Başlık açıklamasında da "içeride" geçiyor — tablodaki rozete bak.
  const row = page.getByRole("row").filter({ hasText: "E2E Ziyaretci" });
  await expect(row.getByText("içeride")).toBeVisible();

  await row.getByRole("button", { name: "Çıkış Ver" }).click();
  await expect(row.getByText("içeride")).toHaveCount(0);
});

test("kısıtlı kullanıcı operasyona erişemez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Operasyon", exact: true })).toHaveCount(0);
  await page.goto("/operasyon/yolcular");
  await expect(page).toHaveURL("/dashboard");
});
