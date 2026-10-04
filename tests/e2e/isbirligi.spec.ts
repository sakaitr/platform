import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("görev açılır ve durumu ilerletilir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/gorevler");

  await page.getByRole("button", { name: "Yeni Görev" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlık").fill("E2E Sözleşme yenile");
  await form.getByLabel("Öncelik").selectOption("yuksek");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "E2E Sözleşme yenile" });
  await expect(row.getByText("Yüksek")).toBeVisible();

  await row.getByRole("combobox").selectOption("bitti");
  await row.getByRole("button", { name: "değiştir" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Sözleşme yenile" }).getByRole("combobox")).toHaveValue("bitti");
});

test("destek talebi açılır, numara verilir, iç not müşteriye kapalı işaretlenir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/destek");

  await page.getByRole("button", { name: "Yeni Talep" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Konu").fill("E2E Klima arızası");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText(/TLP\d{4}-\d{6} açıldı\./)).toBeVisible();

  await page.goto("/destek");
  await page.getByRole("row").filter({ hasText: "E2E Klima arızası" }).getByRole("link").click();

  const reply = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await reply.getByLabel("Mesaj").fill("Ekip yönlendirildi");
  await reply.getByLabel("İç not (müşteri görmez)").check();
  await reply.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText("iç not")).toBeVisible();
});

test("talep durumu sırayı zorlar", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/destek");
  await page.getByRole("button", { name: "Yeni Talep" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Konu").fill("E2E Akış testi");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await page.goto("/destek");
  await page.getByRole("row").filter({ hasText: "E2E Akış testi" }).getByRole("link").click();

  // Açık durumda "Çözüldü" doğrudan görünmemeli
  await expect(page.getByRole("button", { name: "İşlemde" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Çözüldü" })).toHaveCount(0);

  await page.getByRole("button", { name: "İşlemde" }).click();
  await expect(page.getByRole("button", { name: "Çözüldü" })).toBeVisible();
});

test("izin talebi gün sayısını kendi hesaplar", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/izinler");

  await page.getByRole("button", { name: "İzin Talebi" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlangıç").fill("2026-10-01");
  await form.getByLabel("Bitiş").fill("2026-10-05");
  await form.getByRole("button", { name: "Kaydet" }).click();

  // 1–5 Ekim dahil = 5 gün
  await expect(form.getByText("5 günlük izin talebi oluşturuldu.")).toBeVisible();
});

test("bitiş başlangıçtan önceyse izin talebi reddedilir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/izinler");

  await page.getByRole("button", { name: "İzin Talebi" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlangıç").fill("2026-10-10");
  await form.getByLabel("Bitiş").fill("2026-10-05");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await expect(form.getByText("Bitiş tarihi başlangıçtan önce olamaz.")).toBeVisible();
});

test("portal kullanıcısı firmasız oluşturulamaz", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/admin/portal");

  await page.getByRole("button", { name: "Yeni Portal Kullanıcısı" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Ad Soyad").fill("E2E Müşteri");
  await form.getByLabel("E-posta").fill("e2e-musteri@test.local");
  await form.getByLabel("Şifre").fill("Portal1234!");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await expect(form.getByText("En az bir firma seçin.")).toBeVisible();
});

test("kısıtlı kullanıcı görev ve destek modüllerini görmez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Görevler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Destek", exact: true })).toHaveCount(0);
  await page.goto("/gorevler");
  await expect(page).toHaveURL("/dashboard");
});
