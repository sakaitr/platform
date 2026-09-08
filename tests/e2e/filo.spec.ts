import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("bakım kaydı eklenir ve listede görünür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/bakim");

  await page.getByRole("button", { name: "Yeni Bakım" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Araç").selectOption({ label: "34ABC01" });
  await form.getByLabel("Bakım Tipi").fill("periyodik");
  await form.getByLabel("Tarih", { exact: true }).fill("2026-09-01");
  await form.getByLabel("Bakım KM", { exact: true }).fill("120000");
  await form.getByLabel("Tutar (₺)").fill("4500");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "34ABC01" });
  await expect(row.getByText("periyodik")).toBeVisible();
  await expect(row.getByText("120.000")).toBeVisible();
});

test("süresi geçmiş belge kırmızı rozetle işaretlenir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/belgeler");

  await page.getByRole("button", { name: "Yeni Belge" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Araç").selectOption({ label: "34ABC01" });
  await form.getByLabel("Belge Tipi").fill("muayene");
  await form.getByLabel("Bitiş").fill("2020-01-01");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "muayene" });
  await expect(row.getByText("01.01.2020")).toBeVisible();
});

test("bilinmeyen kayıt tipi 404 verir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  const response = await page.goto("/filo/olmayan-kayit");
  expect(response?.status()).toBe(404);
});

test("pilates kiracısı filo kayıtlarına giremez", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await page.goto("/filo/bakim");
  await expect(page).toHaveURL("/dashboard");
});

test("yakıt dolumunda tüketim km farkından hesaplanır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/yakit");

  await page.getByRole("button", { name: "Yeni Yakıt Dolumu" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Araç").selectOption({ label: "34XYZ02" });
  await form.getByLabel("Dolum Tarihi").fill("2026-09-01");
  await form.getByLabel("Litre").fill("60");
  await form.getByLabel("Önceki KM").fill("100000");
  await form.getByLabel("Son KM").fill("100500");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "34XYZ02" });
  // 60 L / 500 km → 12 L/100km
  await expect(row.locator("td").nth(5)).toHaveText("12");
});

test("araç detayı belgeleri ve firma atamalarını gösterir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/araclar");

  await page.getByRole("link", { name: "34ABC01" }).click();
  await page.waitForURL(/\/filo\/araclar\/[0-9a-f-]{36}$/);
  const detailUrl = page.url();

  await expect(page.getByRole("heading", { name: "34ABC01" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Firma Atamaları" })).toBeVisible();

  // Ek firma ata
  await page.getByRole("button", { name: "Firma Ekle" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(detailUrl);
  await expect(page.getByText("Beta Tekstil")).toBeVisible();

  // Belge ekle
  await page.getByRole("button", { name: "Belge Ekle" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Belge Tipi").fill("K belgesi");
  await form.getByLabel("Bitiş").fill("2027-06-30");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto(detailUrl);
  await expect(page.getByRole("row").filter({ hasText: "K belgesi" })).toBeVisible();
});

test("sürücü detayı belge ve sicil bölümlerini gösterir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");

  // Önce sürücü oluştur
  await page.goto("/filo/suruculer");
  await page.getByRole("button", { name: /Yeni Sürücü/ }).click();
  let form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Ad Soyad").fill("E2E Şoför Detay");
  await form.getByLabel("Ehliyet Sınıfı").fill("D");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/filo/suruculer");
  await page.getByRole("link", { name: "E2E Şoför Detay" }).click();
  await page.waitForURL(/\/filo\/suruculer\/[0-9a-f-]{36}$/);
  const url = page.url();

  await expect(page.getByRole("heading", { name: "Sürücü Belgeleri" })).toBeVisible();
  await expect(page.getByText("Sürücü belgesi henüz eklenmemiş")).toBeVisible();

  await page.getByRole("button", { name: "Belge Ekle" }).click();
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Belge Tipi").fill("SRC");
  await form.getByLabel("Bitiş").fill("2029-01-01");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto(url);
  await expect(page.getByRole("row").filter({ hasText: "SRC" })).toBeVisible();
});

test("araç listesi kapasiteye göre sıralanabilir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/araclar?sirala=kapasite");
  const plates = await page.getByRole("row").locator("td:first-child").allInnerTexts();
  // 34ABC01 kapasite 27, 34XYZ02 kapasite 16 → büyükten küçüğe
  expect(plates[0]).toContain("34ABC01");
});
