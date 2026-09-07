import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("lojistik kiracısı irsaliye menüsünü görür, hakediş görmez", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await expect(page.getByText("Lojistik / Nakliye")).toBeVisible();
  await expect(page.getByRole("link", { name: "İrsaliyeler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hakedişler" })).toHaveCount(0);
});

test("pilates kiracısı farklı terimler görür", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await expect(page.getByText("Pilates / Fitness Stüdyo")).toBeVisible();
  await page.goto("/admin/terminoloji");
  await expect(page.getByText("Üye", { exact: true })).toBeVisible();
  await expect(page.getByText("Eğitmen", { exact: true })).toBeVisible();
  await expect(page.getByText("Ders", { exact: true })).toBeVisible();
});

test("lojistik kiracısında özel alan irsaliye_no tanımlıdır", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await page.goto("/admin/alanlar");
  await expect(page.getByText("invoice.irsaliye_no · zorunlu")).toBeVisible();
  await expect(page.getByText("İrsaliye No")).toBeVisible();
});

test("pilates kiracısında filo modülü yok (lisanssız)", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await expect(page.getByRole("link", { name: "Filo" })).toHaveCount(0);
});
