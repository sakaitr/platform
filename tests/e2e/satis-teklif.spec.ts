import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

async function openDeal(page: Page, title: string): Promise<void> {
  await page.goto("/satis/pipeline");
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/satis\/pipeline\/[0-9a-f-]{36}$/);
}

test("teklif: kalemlerden canlı toplam, kaydet, gönder, kilitlen, yeni sürüm", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await openDeal(page, "Birinci Satiscinin Firsati");
  await page.getByRole("link", { name: "Teklif oluştur" }).click();
  await expect(page).toHaveURL(/\/satis\/teklifler\/yeni\?firsat=/);

  await page.getByLabel("Kalem 1 adı").fill("Web sitesi");
  await page.getByLabel("Kalem 1 adedi").fill("2");
  await page.getByLabel("Kalem 1 birim fiyatı").fill("1.000,00");
  await page.getByRole("button", { name: "Kalem ekle" }).click();
  await page.getByLabel("Kalem 2 adı").fill("Danışmanlık saati");
  await page.getByLabel("Kalem 2 adedi").fill("1,5");
  await page.getByLabel("Kalem 2 birim fiyatı").fill("100");
  await page.getByLabel("Kalem 2 KDV oranı").fill("10");
  // 2×1000 (%20 = 400) + 1,5×100 (%10 = 15) = 2.565,00
  await expect(page.getByTestId("quote-total")).toHaveText("2.565,00 TL");

  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page).toHaveURL(/\/satis\/teklifler\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/TKL\d{4}-\d{5}/);
  await expect(page.getByText("Taslak").first()).toBeVisible();

  // Düzenleyici saklanan değeri TR biçiminde geri verir: adet 1,5 (1500 değil)
  await expect(page.getByLabel("Kalem 2 adedi")).toHaveValue("1,5");
  await expect(page.getByTestId("quote-total")).toHaveText("2.565,00 TL");

  await page.getByRole("button", { name: "Gönderildi olarak işaretle" }).click();
  await expect(page.getByText("Gönderildi").first()).toBeVisible();
  await expect(page.getByLabel("Kalem 1 adı")).toHaveCount(0);
  await expect(page.getByText(/değiştirilemez/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Taslağı sil" })).toHaveCount(0);

  await page.getByRole("button", { name: "Yeni sürüm oluştur" }).click();
  await expect(page).toHaveURL(/\/satis\/teklifler\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/00002/);
  await expect(page.getByLabel("Kalem 1 adı")).toHaveValue("Web sitesi");
  await expect(page.getByTestId("quote-total")).toHaveText("2.565,00 TL");

  await page.goto("/satis/teklifler");
  await expect(page.getByRole("link", { name: /TKL\d{4}-00001/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /TKL\d{4}-00002/ })).toBeVisible();
});

test("teklif geçersiz kalemde hata verir, kaydetmez", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await openDeal(page, "Birinci Satiscinin Firsati");
  await page.getByRole("link", { name: "Teklif oluştur" }).click();
  await page.getByLabel("Kalem 1 adı").fill("Hatalı");
  await page.getByLabel("Kalem 1 birim fiyatı").fill("1,234");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator('span[role="alert"]')).toContainText("birim fiyat");
  await expect(page).toHaveURL(/\/yeni\?firsat=/);
});

test("yazdırma sayfası: teklif içeriği var, kenar çubuğu yazdırmada gizli", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/teklifler");
  await page.getByRole("link", { name: /TKL\d{4}-00001/ }).click();
  await page.getByRole("link", { name: "Yazdır" }).click();
  await expect(page).toHaveURL(/\/yazdir$/);
  await expect(page.getByText("Genel toplam")).toBeVisible();
  await expect(page.getByText("2.565,00 TL")).toBeVisible();
  await expect(page.getByText("Web sitesi")).toBeVisible();
  await expect(page.getByText("TEKLİF", { exact: true })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation")).toBeHidden();
  await expect(page.getByRole("button", { name: "Çıkış" })).toBeHidden();
  await expect(page.getByRole("button", { name: /Yazdır/ })).toBeHidden();
  await expect(page.getByText("2.565,00 TL")).toBeVisible();
});

test("satışçı başkasının fırsatındaki teklifi göremez", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await openDeal(page, "Ikinci Satiscinin Firsati");
  await page.getByRole("link", { name: "Teklif oluştur" }).click();
  await page.getByLabel("Kalem 1 adı").fill("Gizli hizmet");
  await page.getByLabel("Kalem 1 birim fiyatı").fill("500");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page).toHaveURL(/\/satis\/teklifler\/[0-9a-f-]{36}$/);
  const url = page.url();

  await login(page, "satisci1@e2e.test");
  const response = await page.goto(url);
  expect(response?.status()).toBe(404);
  await page.goto("/satis/teklifler");
  await expect(page.getByText("Gizli hizmet")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Ikinci Satiscinin Firsati/ })).toHaveCount(0);
});

test("teklif yeteneği kapalı kiracıda menü, sayfa ve fırsat bağlantısı yok", async ({ page }) => {
  await login(page, "satis-b@e2e.test");
  await expect(page.getByRole("link", { name: "Teklifler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Şablonlar", exact: true })).toBeVisible();
  await page.goto("/satis/teklifler");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/satis/teklifler/yeni");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("şablon: ekle, aynı ad ve tanınmayan yer tutucu reddedilir, adaydan WhatsApp ve e-posta bağlantısı", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/sablonlar");
  await expect(page.getByRole("heading", { name: "Tanıştığımıza memnun oldum" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Teklif gönderimi" })).toBeVisible();

  await page.getByRole("button", { name: "Yeni şablon" }).click();
  const form = page.locator("form").filter({ has: page.getByLabel("Şablon adı") });
  await page.getByLabel("Şablon adı").fill("Hatırlatma");
  await page.getByLabel("Kanal").selectOption("whatsapp");
  await page.getByLabel("Mesaj").fill("Merhaba {ad}, {hizmet} için dönüş bekliyorum. Kupon: {kupon}");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/Tanınmayan yer tutucu: \{kupon\}/)).toBeVisible();
  // Hata sonrası kullanıcının yazdıkları silinmez
  await expect(page.getByLabel("Şablon adı")).toHaveValue("Hatırlatma");
  await expect(page.getByLabel("Mesaj")).toHaveValue(/\{kupon\}/);

  await page.getByLabel("Mesaj").fill("Merhaba {ad}, {hizmet} için dönüş bekliyorum.");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Şablon eklendi.")).toBeVisible();

  await page.getByLabel("Şablon adı").fill("Hatırlatma");
  await page.getByLabel("Mesaj").fill("Aynı adlı ikinci şablon.");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/adında başka bir şablon var/)).toBeVisible();

  // Aday: telefon + e-posta + hizmet ile oluştur, şablon bağlantılarını gör
  await page.goto("/satis/adaylar");
  await page.getByRole("button", { name: "Yeni aday" }).click();
  await page.getByLabel("Ad / firma").fill("Şablon Deneme Ltd");
  await page.getByLabel("Yetkili kişi").fill("Zeynep");
  await page.getByLabel("Telefon").fill("0533 444 55 66");
  await page.getByLabel("E-posta").fill("zeynep@deneme.test");
  await page.getByLabel("İlgilendiği hizmet").fill("Web sitesi");
  await page.locator("form").filter({ has: page.getByLabel("Ad / firma") }).getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Aday eklendi.")).toBeVisible();

  await page.goto("/satis/adaylar?q=Şablon+Deneme");
  await page.getByRole("link", { name: "Şablon Deneme Ltd" }).click();
  await expect(page).toHaveURL(/\/satis\/adaylar\/[0-9a-f-]{36}$/);

  const wa = page.getByRole("listitem").filter({ hasText: "Hatırlatma" }).getByRole("link", { name: "WhatsApp'ta aç" });
  const href = await wa.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/905334445566\?text=/);
  expect(decodeURIComponent(href!)).toContain("Merhaba Zeynep, Web sitesi için dönüş bekliyorum.");

  const mail = page.getByRole("listitem").filter({ hasText: "Teklif gönderimi" }).getByRole("link", { name: "E-posta aç" });
  const mailHref = await mail.getAttribute("href");
  expect(mailHref).toMatch(/^mailto:zeynep%40deneme\.test\?/);
  expect(mailHref).toContain("subject=%C5%9Eablon%20Deneme%20Ltd%20i%C3%A7in%20teklifimiz");

  await page.getByRole("listitem").filter({ hasText: "Hatırlatma" }).getByRole("button", { name: "Gönderdim, kayda geç" }).click();
  await expect(page.getByText("WhatsApp gönderildi: Hatırlatma")).toBeVisible();
});

test("telefonu olmayan adayda WhatsApp bağlantısı yerine uyarı çıkar", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Sahipsiz");
  await page.getByRole("link", { name: "Sahipsiz Aday" }).click();
  await expect(page.getByText("Telefon yok").first()).toBeVisible();
});
