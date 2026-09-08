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

test("çetele onaylanır, onaylı kayıt düzenlenemez", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/cetele");

  await page.getByRole("button", { name: "Yeni Kayıt" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Araç").selectOption({ label: "34ABC01" });
  await form.getByLabel("Hareket Tipi").fill("sabah");
  await form.getByLabel("Yolcu Sayısı").fill("22");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "34ABC01" });
  await expect(row.getByText("Bekliyor")).toBeVisible();

  await row.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Seçilenleri Onayla" }).click();

  await expect(row.getByText("Onaylandı")).toBeVisible();
  await expect(row.getByRole("link", { name: "Düzenle" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Onayı Geri Al" })).toBeVisible();
});

test("pilates kiracısında çetele yeteneği kapalı", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await page.goto("/operasyon/cetele");
  await expect(page).toHaveURL("/dashboard");
});

test("lojistik kiracısında çetele menüde yok ama rota planlama açık", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  // lojistik paketi yalnız operasyon.rota_planlama yeteneğini açıyor
  await expect(page.getByRole("link", { name: "Çetele", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Transferler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Güzergahlar", exact: true })).toBeVisible();
});

test("transfer durum makinesi sırayı zorlar", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/transferler");

  await page.getByRole("button", { name: "Yeni Transfer" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlık").fill("E2E Havalimanı Transferi");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await page.getByRole("link", { name: "E2E Havalimanı Transferi" }).click();

  // istek durumunda yalnız Planlandı ve İptal seçenekleri olmalı
  await expect(page.getByRole("button", { name: "Planlandı" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tamamlandı" })).toHaveCount(0);

  await page.getByRole("button", { name: "Planlandı" }).click();
  await expect(page.getByRole("button", { name: "Yolda" })).toBeVisible();
});

test("güzergaha araç atanınca önceki atama kapanır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/guzergahlar");

  await page.getByRole("button", { name: "Yeni Güzergah" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Güzergah Adı").fill("E2E Gebze Hattı");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await page.getByRole("link", { name: "E2E Gebze Hattı" }).click();
  await page.waitForURL(/\/operasyon\/guzergahlar\/[0-9a-f-]{36}$/);
  const routeUrl = page.url();
  for (const plate of ["34ABC01", "34XYZ02"]) {
    // Her atama arasında sayfayı tazeliyoruz: kaydetme sonrası RSC yeniden
    // render ederken forma tekrar tıklamak testi kararsızlaştırıyor.
    await page.goto(routeUrl);
    await page.getByRole("button", { name: "Araç Ata" }).click();
    const assignForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
    await assignForm.getByLabel("Araç").selectOption({ label: plate });
    await assignForm.getByRole("button", { name: "Kaydet" }).click();
    await expect(assignForm.getByText("Atama kaydedildi.")).toBeVisible();
  }

  await page.goto(routeUrl);

  // Tek "güncel" rozeti kalmalı — ikinci atama ilkini kapatır
  await expect(page.getByText("güncel")).toHaveCount(1);
});
