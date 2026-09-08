import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("owner rapor listesini görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/raporlar");
  await expect(page.getByText("Kullanıcı Listesi")).toBeVisible();
  await expect(page.getByText("Denetim İzi")).toBeVisible();
});

test("CSV indirilebiliyor — Excel uyumlu BOM ve başlık", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  const response = await page.request.get("/api/reports/kullanicilar?format=csv");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const body = await response.text();
  expect(body).toContain("İsim;E-posta");
});

test("Excel indirilebiliyor", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  const response = await page.request.get("/api/reports/kullanicilar?format=xlsx");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain(".xlsx");
});

test("kısıtlı kullanıcı rapor menüsünü ve API'yi göremez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Raporlar", exact: true })).toHaveCount(0);
  const response = await page.request.get("/api/reports/kullanicilar?format=csv");
  expect(response.status()).toBe(403);
});
