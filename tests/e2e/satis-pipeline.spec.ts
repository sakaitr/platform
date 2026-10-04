import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

const column = (page: Page, label: string) => page.getByRole("region", { name: label, exact: true });

test("yönetici fırsat açar, sürükleyerek aşama değiştirir, kaybedilende neden zorunlu", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/pipeline");
  await page.getByRole("button", { name: "Yeni fırsat" }).click();
  await page.getByLabel("Başlık").fill("Sürüklenen Fırsat");
  await page.getByLabel("Tutar (TL)").fill("12.500");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Fırsat eklendi.")).toBeVisible();

  await page.goto("/satis/pipeline");
  await expect(column(page, "Yeni").getByText("Sürüklenen Fırsat")).toBeVisible();

  // Sürükle-bırak: Yeni → Görüşüldü
  await column(page, "Yeni").getByText("Sürüklenen Fırsat").dragTo(column(page, "Görüşüldü"));
  await expect(column(page, "Görüşüldü").getByText("Sürüklenen Fırsat")).toBeVisible();

  // Kaybedildi: neden sorulur; boş geçilemez
  await column(page, "Görüşüldü").getByLabel("Sürüklenen Fırsat aşaması").selectOption({ label: "Kaybedildi" });
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("neden yazın");
  await expect(column(page, "Kaybedildi").getByText("Sürüklenen Fırsat")).toHaveCount(0);

  await page.getByPlaceholder("Örn. bütçe yetersiz, rakibi seçti").fill("Bütçe yetersiz");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(column(page, "Kaybedildi").getByText("Sürüklenen Fırsat")).toBeVisible();

  await column(page, "Kaybedildi").getByRole("link", { name: "Sürüklenen Fırsat" }).click();
  await expect(page.getByText("Kayıp nedeni: Bütçe yetersiz")).toBeVisible();
  await expect(page.getByText("Aşama: Görüşüldü → Kaybedildi")).toBeVisible();
});

test("kazanıldı: bağlı aday müşteri olur", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Birinci");
  await page.getByRole("link", { name: "Birinci Satiscinin Adayi" }).click();
  await expect(page).toHaveURL(/\/satis\/adaylar\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Fırsat ekle" }).click();
  await page.getByLabel("Başlık").fill("Adaydan Fırsat");
  await page.getByRole("button", { name: "Kaydet" }).last().click();
  await expect(page.getByText("Fırsat eklendi.")).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Adaydan Fırsat" }).click();
  await expect(page).toHaveURL(/\/satis\/pipeline\/[0-9a-f-]{36}$/);

  await page.locator('select[name="stageId"]').selectOption({ label: "Kazanıldı" });
  await page.getByRole("button", { name: "Aşamayı değiştir" }).click();
  await expect(page.getByText("Aşama: Yeni → Kazanıldı")).toBeVisible();

  await page.goto("/satis/adaylar?q=Birinci");
  await expect(page.getByRole("row", { name: /Birinci Satiscinin Adayi/ }).getByText("Müşteri oldu")).toBeVisible();
});

test("görev: fırsata eklenir, Görevler sayfasında bugün altında çıkar, tamamlanınca tamamlananlara geçer", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/pipeline");
  await page.getByRole("link", { name: "Birinci Satiscinin Firsati" }).click();

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // Yerel (İstanbul) bugün 23:00: tarayıcı saat dilimi sunucuyla aynı olmayabilir, tarihi sabit gün olarak yaz
  const istanbulToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
  await page.getByLabel("Tür").selectOption("task");
  await page.getByLabel("Konu").fill("Teklifi sor");
  await page.getByLabel("Vade (görev için)").fill(`${istanbulToday}T23:00`);
  await page.getByLabel("Görev sahibi").selectOption({ label: "Yonetici Kisi" });
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Görev eklendi.")).toBeVisible();
  void pad;

  await page.goto("/satis/gorevler");
  const today = page.getByRole("heading", { name: /^Bugün\s*\d/ }).locator("xpath=ancestor::*[contains(@class,'rounded-xl')][1]");
  await expect(today.getByText("Teklifi sor")).toBeVisible();
  await today.getByRole("button", { name: "Tamamla" }).first().click();
  await expect(page.getByText("Teklifi sor")).toHaveCount(0);

  await page.goto("/satis/gorevler?gorunum=tamam");
  await expect(page.getByText("Teklifi sor")).toBeVisible();
});

test("takip önerisi: görüşüldü olan ve takip tarihi boş adaya onayla görev eklenir", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/adaylar?q=Ikinci");
  await page.getByRole("link", { name: "Ikinci Satiscinin Adayi" }).click();
  await expect(page).toHaveURL(/\/satis\/adaylar\/[0-9a-f-]{36}$/);
  await page.locator('select[name="status"]').selectOption({ label: "Görüşüldü" });
  await page.getByRole("button", { name: "Kaydet" }).first().click();
  await expect(page.getByText("3 gün sonrası için takip görevi eklensin mi?")).toBeVisible();
  await page.getByRole("button", { name: "Takip görevi ekle" }).click();
  await expect(page.getByText("Takip görevi eklendi (3 gün sonra)")).toBeVisible();
  await expect(page.getByText("3 gün sonrası için takip görevi eklensin mi?")).toHaveCount(0);
  await expect(page.getByText("Takip: Ikinci Satiscinin Adayi")).toBeVisible();
});

test("satışçı başkasının fırsatını panoda görmez, adresle de açamaz", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/pipeline");
  const href = await page.getByRole("link", { name: "Ikinci Satiscinin Firsati" }).getAttribute("href");
  expect(href).toMatch(/^\/satis\/pipeline\/[0-9a-f-]{36}$/);

  await login(page, "satisci1@e2e.test");
  await page.goto("/satis/pipeline");
  await expect(page.getByRole("link", { name: "Ikinci Satiscinin Firsati" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Aşamaları düzenle" })).toHaveCount(0);
  const response = await page.goto(href!);
  expect(response?.status()).toBe(404);
  // Aşama düzenleme sayfası da yetkisiz
  await page.goto("/satis/pipeline/asamalar");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("aşama düzenleme: ekle, sırala, fırsatlı aşama taşımadan silinmez, son 'kazanıldı' silinmez", async ({ page }) => {
  await login(page, "yonetici@e2e.test");
  await page.goto("/satis/pipeline/asamalar");
  await page.getByRole("button", { name: "Yeni aşama" }).click();
  const newStageForm = page.locator("form").filter({ has: page.getByLabel("Aşama adı") });
  await page.getByLabel("Aşama adı").fill("Demo planlandı");
  await newStageForm.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Aşama eklendi.")).toBeVisible();
  await page.goto("/satis/pipeline");
  await expect(column(page, "Demo planlandı")).toBeVisible();

  // Aynı ad tekrar eklenemez
  await page.goto("/satis/pipeline/asamalar");
  await page.getByRole("button", { name: "Yeni aşama" }).click();
  await page.getByLabel("Aşama adı").fill("demo PLANLANDI");
  await page.locator("form").filter({ has: page.getByLabel("Aşama adı") }).getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/iki aşama olamaz/)).toBeVisible();

  // Fırsatı olan "Yeni" aşaması taşıma hedefi seçilmeden silinemez
  const yeni = page.getByRole("listitem").filter({ has: page.locator('input[value="Yeni"]') });
  await yeni.getByRole("button", { name: "Aşamayı sil" }).click();
  await expect(yeni.getByText(/fırsat var/)).toBeVisible();

  // Tek 'Kazanıldı' aşaması silinemez
  const won = page.getByRole("listitem").filter({ has: page.locator('input[value="Kazanıldı"]') });
  await won.getByRole("button", { name: "Aşamayı sil" }).click();
  await expect(won.getByText(/kazanıldı/i).last()).toBeVisible();
  await page.goto("/satis/pipeline");
  await expect(column(page, "Kazanıldı")).toBeVisible();
});
