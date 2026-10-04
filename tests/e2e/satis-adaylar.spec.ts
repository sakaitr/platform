import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("satış CRM: menüde Satış CRM ve alt sayfaları var, Atricard bağlantısı Entegrasyonlar altında", async ({ page }) => {
  await login(page, "satis@e2e.test");
  await expect(page.getByRole("link", { name: "Satış CRM", exact: true })).toBeVisible();
  for (const label of ["Adaylar", "Pipeline", "Görevler", "Teklifler", "Şablonlar", "Entegrasyonlar"]) {
    await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Filo" })).toHaveCount(0);
});

test("satış CRM: lojistik kiracısı satış sayfasına URL ile giremez", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await page.goto("/satis/adaylar");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("yönetici aday ekler, aynı telefonla ikinci kez eklenemez, aday listede görünür", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar");
  await page.getByRole("button", { name: "Yeni aday" }).click();
  await page.getByLabel("Ad / firma").fill("Mavi Tur E2E");
  await page.getByLabel("Telefon").fill("0532 111 22 33");
  await page.getByLabel("E-posta").fill("deniz@mavitur.test");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Aday eklendi.")).toBeVisible();

  // Aynı numara farklı yazımla: yinelenen
  await page.getByLabel("Ad / firma").fill("Başka Ad");
  await page.getByLabel("Telefon").fill("+90 532 111 22 33");
  await page.getByLabel("E-posta").fill("");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Bu aday zaten kayıtlı")).toBeVisible();

  await page.goto("/satis/adaylar?q=Mavi+Tur+E2E");
  await expect(page.getByRole("link", { name: "Mavi Tur E2E" })).toBeVisible();
});

test("satışçı yalnız kendi ve sahipsiz adaylarını görür, başkasının adayı 404", async ({ page }) => {
  await login(page, "satisci1@e2e.test");
  await page.goto("/satis/adaylar");
  await expect(page.getByRole("link", { name: "Birinci Satiscinin Adayi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sahipsiz Aday" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ikinci Satiscinin Adayi" })).toHaveCount(0);

  // Yönetici olarak başkasının adayının adresini al, satışçı olarak aç
  await page.context().clearCookies();
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Ikinci");
  const href = await page.getByRole("link", { name: "Ikinci Satiscinin Adayi" }).getAttribute("href");
  expect(href).toMatch(/^\/satis\/adaylar\/[0-9a-f-]{36}$/);

  await page.context().clearCookies();
  await login(page, "satisci1@e2e.test");
  const response = await page.goto(href!);
  expect(response?.status()).toBe(404);
});

test("satışçı silme ve dışa aktarma yetkisi olmadan butonları görmez", async ({ page }) => {
  await login(page, "satisci1@e2e.test");
  await page.goto("/satis/adaylar");
  await expect(page.getByText("CSV dışa aktar")).toHaveCount(0);
  await expect(page.getByText("CSV içe aktar")).toHaveCount(0);
  const response = await page.request.get("/api/satis/adaylar/export");
  expect(response.status()).toBe(403);
});

test("aday müşteriye dönüşür; ikinci dönüştürme engellenir; firma oluşur", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Sahipsiz");
  await page.getByRole("link", { name: "Sahipsiz Aday" }).click();
  await page.getByRole("button", { name: "Müşteriye dönüştür" }).click();
  await expect(page.getByText("Müşteri oldu").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Müşteriye dönüştür" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Firma kaydını aç" })).toBeVisible();
  await expect(page.getByText("Sahipsiz Aday: Satış fırsatı")).toBeVisible();

  await page.goto("/crm/firmalar?q=Sahipsiz");
  await expect(page.getByRole("link", { name: "Sahipsiz Aday" })).toBeVisible();
});

test("CSV içe aktarma: geçerli, yinelenen ve hatalı satırlar raporlanır; dışa aktarma formülü kaçırır", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar/ice-aktar");
  const csv = [
    "Firma;Yetkili;Telefon;E-posta;Şehir",
    "Yeşil Lojistik;Ali Veli;0533 000 00 01;ali@yesil.test;Ankara",
    "Yeşil Lojistik Kopya;;+90 533 000 00 01;;",
    "=HYPERLINK(\"http://kotu.example\");;0533 000 00 03;;",
    ";;;;",
    "Kötü Eposta;;;yok;",
  ].join("\n");
  await page.setInputFiles('input[type="file"]', { name: "adaylar.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await page.getByRole("button", { name: "İçe aktar" }).click();
  await expect(page.getByText("2 aday eklendi, 1 yinelenen atlandı, 1 satır hatalı.")).toBeVisible();
  await expect(page.getByText(/Satır 3: zaten kayıtlı/)).toBeVisible();
  await expect(page.getByText(/Satır 6: E-posta geçersiz/)).toBeVisible();

  const response = await page.request.get("/api/satis/adaylar/export");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body.startsWith("﻿Ad;")).toBe(true);
  expect(body).toContain("Yeşil Lojistik");
  // Formülle başlayan ad, hücrede kaçırılmış olmalı
  expect(body).toMatch(/\r\n'=HYPERLINK\(/);
  expect(body).not.toMatch(/(^|;|\r\n)=HYPERLINK/);
});

test("başka kiracının yöneticisi bu kiracının adaylarını görmez", async ({ page }) => {
  await login(page, "satis-b@e2e.test");
  await page.goto("/satis/adaylar");
  await expect(page.getByText("Birinci Satiscinin Adayi")).toHaveCount(0);
  await expect(page.getByText("0 kayıt")).toBeVisible();
});

test("toplu işlem: seçilen adayın sıcaklığı değişir, kalıcı silinince listeden gider", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Mavi+Tur+E2E");
  await page.getByLabel("Mavi Tur E2E seç").check();
  await page.locator('select[name="bulk"]').selectOption("temperature:hot");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page.getByRole("row", { name: /Mavi Tur E2E/ }).getByText("Sıcak")).toBeVisible();

  await page.getByLabel("Mavi Tur E2E seç").check();
  await page.locator('select[name="bulk"]').selectOption("delete:");
  await page.getByRole("button", { name: "Uygula" }).click();
  await expect(page.getByText("Mavi Tur E2E")).toHaveCount(0);
});

test("yönetici adayı satışçıya atar: o satışçı görür, diğeri görmez; satışçı yalnız kendine atayabilir", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar");
  await page.getByRole("button", { name: "Yeni aday" }).click();
  await page.getByLabel("Ad / firma").fill("Atama Deneme Ltd");
  await page.locator("form").filter({ has: page.getByLabel("Ad / firma") }).getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Aday eklendi.")).toBeVisible();

  await page.goto("/satis/adaylar?q=Atama+Deneme");
  await page.getByRole("link", { name: "Atama Deneme Ltd" }).click();
  await expect(page).toHaveURL(/\/satis\/adaylar\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.locator('select[name="ownerUserId"]').selectOption({ label: "Satisci Bir" });
  await page.getByRole("button", { name: "Ata" }).click();
  await expect(page.getByText("Sahip atandı")).toBeVisible();

  await login(page, "satisci1@e2e.test");
  await page.goto("/satis/adaylar?q=Atama+Deneme");
  await expect(page.getByRole("link", { name: "Atama Deneme Ltd" })).toBeVisible();

  await login(page, "satisci2@e2e.test");
  await page.goto("/satis/adaylar?q=Atama+Deneme");
  await expect(page.getByRole("link", { name: "Atama Deneme Ltd" })).toHaveCount(0);
  expect((await page.goto(url))?.status()).toBe(404);

  // Satışçının sahip listesinde yalnız kendisi ve "Sahipsiz" vardır (başkasına atayamaz)
  await login(page, "satisci1@e2e.test");
  await page.goto(url);
  const options = await page.locator('select[name="ownerUserId"] option').allTextContents();
  expect(options.sort()).toEqual(["Sahipsiz", "Satisci Bir"]);
});
