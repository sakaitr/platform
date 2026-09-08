import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("owner Yönetim menüsünü görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await expect(page.getByRole("link", { name: "Yönetim", exact: true })).toBeVisible();
});

test("kısıtlı kullanıcı Yönetim menüsünü görmez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Yönetim", exact: true })).toHaveCount(0);
});

test("kısıtlı kullanıcı yönetim sayfasına gidemez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await page.goto("/admin/roller");
  await expect(page).toHaveURL("/dashboard");
});

test("owner rol listesini ve izinlerini görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/admin/roller");
  // Rol anahtarı + seviye satırı benzersiz ve kararlı
  await expect(page.getByText("owner · seviye 3")).toBeVisible();
  await expect(page.getByText("operasyon · seviye 1")).toBeVisible();
  await expect(page.getByText("sadece_dashboard · seviye 0")).toBeVisible();
  // İzin rozetleri render ediliyor
  await expect(page.getByText("dashboard:read").first()).toBeVisible();
});

test("operatör olmayan kullanıcı operatör paneline giremez", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill("kisitli-owner@e2e.test");
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");

  // Kiracının sahibi bile operatör değil: liste ortam değişkeninden gelir
  await expect(page.getByRole("link", { name: "Operatör", exact: true })).toHaveCount(0);
  await page.goto("/operator");
  await expect(page).toHaveURL("/dashboard");
});

test("modül kapatılınca menüden ve URL'den erişim kesilir", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill("kisitli-owner@e2e.test");
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/admin/moduller");
  const row = page.getByRole("row").filter({ hasText: "Görevler" });
  await row.getByRole("button", { name: "Kapat" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/gorevler");
  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByRole("link", { name: "Görevler", exact: true })).toHaveCount(0);

  // Geri aç: veri kaybı olmadan erişim döner
  await page.goto("/admin/moduller");
  await page.getByRole("row").filter({ hasText: "Görevler" }).getByRole("button", { name: "Aç" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto("/gorevler");
  await expect(page).toHaveURL("/gorevler");
});
