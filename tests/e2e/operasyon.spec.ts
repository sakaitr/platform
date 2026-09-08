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
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Plaka", { exact: true }).fill("06 test 99");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("06TEST99")).toBeVisible();
});

test("aynı plaka ikinci kez eklenince Türkçe hata döner", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/filo/araclar");
  await page.getByRole("button", { name: /Yeni Araç/ }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Plaka", { exact: true }).fill("34ABC01");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("34ABC01 plakası zaten kayıtlı.")).toBeVisible();
});

test("yolcu eklenir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular");
  await page.getByRole("button", { name: "Yeni Kayıt" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Ad Soyad").fill("E2E Test Yolcu");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Test Yolcu" })).toBeVisible();
});

test("toplu yolcu ekleme satır satır kayıt açar", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular");

  await page.getByRole("button", { name: "Toplu Yolcu Ekle" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Hepsini Ekle" }) });
  await form.getByLabel("Alış Noktası (hepsi için)").fill("E2E Ortak Durak");
  await form
    .getByLabel("Kişiler")
    .fill("E2E Toplu Bir;05321112233;11111111111\nE2E Toplu İki;05339998877\nE2E Toplu Üç");
  await form.getByRole("button", { name: "Hepsini Ekle" }).click();
  await expect(form.getByText("3 kayıt eklendi.")).toBeVisible();

  await page.goto("/operasyon/yolcular?q=E2E Toplu");
  await expect(page.getByRole("row").filter({ hasText: "E2E Toplu Bir" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "E2E Toplu Üç" })).toBeVisible();
});

test("adı eksik satır toplu eklemeyi durdurur", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular");

  await page.getByRole("button", { name: "Toplu Yolcu Ekle" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Hepsini Ekle" }) });
  await form.getByLabel("Kişiler").fill("Geçerli Kişi\n;05321112233");
  await form.getByRole("button", { name: "Hepsini Ekle" }).click();
  await expect(form.getByText("2. satırda ad soyad eksik.")).toBeVisible();
});

test("geçici güzergah ataması kaydedilir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular?q=Alfa Yolcu");

  await page.getByRole("row").filter({ hasText: "Alfa Yolcu" }).getByRole("link", { name: "Servis" }).click();
  await page.getByRole("button", { name: "Geçici Güzergah" }).click();

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlangıç").fill("2026-10-01");
  await form.getByLabel("Bitiş").fill("2026-10-15");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText("Servis değişikliği kaydedildi.")).toBeVisible();
});

test("bitiş başlangıçtan önceyse servis değişikliği reddedilir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/yolcular?q=Alfa Yolcu");
  await page.getByRole("row").filter({ hasText: "Alfa Yolcu" }).getByRole("link", { name: "Servis" }).click();
  await page.getByRole("button", { name: "Geçici Güzergah" }).click();

  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Başlangıç").fill("2026-10-20");
  await form.getByLabel("Bitiş").fill("2026-10-05");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText("Bitiş tarihi başlangıçtan önce olamaz.")).toBeVisible();
});

// Testler aynı kiracıyı paylaşıyor; her biri kendi gününde çalışsın ki
// birbirinin işaretlerini görmesin.
const GUN = {
  tahta: "2026-03-02",
  plaka: "2026-03-03",
  eslesmeyen: "2026-03-04",
  vardiya: "2026-03-05",
  toplu: "2026-03-06",
};

test("giriş kontrol tahtası firmanın tüm araçlarını bekleyen olarak gösterir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.tahta}`);

  // Sayfa boş başlamaz: firmanın aktif araçları beklenen liste olarak gelir
  const row = page.getByRole("row").filter({ hasText: "34ABC01" });
  await expect(row.getByText("Bekleniyor")).toBeVisible();
  await expect(page.getByRole("main").getByText("Beklenen araç")).toBeVisible();
});

test("plaka son ekiyle hızlı giriş yapılır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.plaka}`);

  await page.getByPlaceholder("Plakanın son hanelerini yazın").fill("01");
  await page.getByRole("button", { name: "34ABC01 · Geldi" }).click();
  await page.waitForLoadState("networkidle");

  const row = page.getByRole("row").filter({ hasText: "34ABC01" });
  await expect(row.getByRole("button", { name: "Geri al" })).toBeVisible();
});

test("eşleşmeyen plaka uyarı verir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.eslesmeyen}`);
  await page.getByPlaceholder("Plakanın son hanelerini yazın").fill("999");
  await expect(page.getByText(/999 ile biten araç yok/)).toBeVisible();
});

test("vardiya tanımlanınca gecikme hesaplanır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");

  await page.goto("/operasyon/vardiyalar");
  await page.getByRole("button", { name: "Yeni Vardiya" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Firma").selectOption({ label: "Alfa Sanayi" });
  await form.getByLabel("Vardiya Adı").fill("sabah");
  await form.getByLabel("Beklenen Saat").fill("08:00");
  await form.getByLabel("Gecikme Toleransı (dk)").fill("10");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText("Vardiya eklendi.")).toBeVisible();

  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.vardiya}&vardiya=sabah`);
  // Vardiya sekmesi ve planlanan saat görünmeli
  await expect(page.getByRole("link", { name: /sabah 08:00/ })).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "34ABC01" });
  await row.getByRole("button", { name: "Geldi" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.vardiya}&vardiya=sabah`);

  // Saati elle geciktir, durum gecikmeliye dönsün
  const marked = page.getByRole("row").filter({ hasText: "34ABC01" });
  await marked.getByRole("button", { name: "Düzenle" }).click();
  await marked.locator('input[type="time"]').fill("08:45");
  await marked.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("row").filter({ hasText: "34ABC01" }).getByText(/Gecikmeli · 45 dk/),
  ).toBeVisible();
});

test("tümü geldi bekleyenleri toplu işaretler", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.toplu}`);

  const bulk = page.getByRole("button", { name: /Tümü geldi/ });
  await expect(bulk).toBeVisible();
  await bulk.click();
  await page.waitForLoadState("networkidle");
  await page.goto(`/operasyon/giris-kontrol?tarih=${GUN.toplu}`);

  await expect(page.getByRole("button", { name: /Tümü geldi/ })).toHaveCount(0);
  await expect(page.getByRole("main").getByText("Bekleyen")).toBeVisible();
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

test("rota planı üretilir, kapasiteye göre araçlara bölünür ve aktifleşince harita dolar", async ({
  page,
}) => {
  await login(page, "kisitli-owner@e2e.test");

  // Koordinatlı üç yolcu ekle
  await page.goto("/operasyon/yolcular");
  for (const [name, lat, lng] of [
    ["E2E Plan Yolcu A", "40.8600000", "29.3600000"],
    ["E2E Plan Yolcu B", "40.8700000", "29.3700000"],
    ["E2E Plan Yolcu C", "40.8800000", "29.3800000"],
  ]) {
    const openButton = page.getByRole("button", { name: "Yeni Kayıt" });
    if (await openButton.isVisible()) await openButton.click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
    await form.getByLabel("Ad Soyad").fill(name!);
    await form.getByLabel("Alış Enlem").fill(lat!);
    await form.getByLabel("Alış Boylam").fill(lng!);
    await form.getByRole("button", { name: "Kaydet" }).click();
    await expect(form.getByText("Kayıt eklendi.")).toBeVisible();
  }

  // Plan oluştur
  await page.goto("/operasyon/rota-planlama");
  await page.getByRole("button", { name: "Yeni Plan" }).click();
  let form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Plan Adı").fill("E2E Sabah Planı");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText("Plan oluşturuldu. Şimdi rotaları üretebilirsiniz.")).toBeVisible();

  await page.goto("/operasyon/rota-planlama");
  await page.getByRole("link", { name: "E2E Sabah Planı" }).click();
  await page.waitForURL(/\/operasyon\/rota-planlama\/[0-9a-f-]{36}$/);
  const planUrl = page.url();

  // Rotaları üret
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "Üret" }) });
  await form.getByLabel("Varış Enlem").fill("40.8000000");
  await form.getByLabel("Varış Boylam").fill("29.4000000");
  await form.getByRole("button", { name: "Üret" }).click();
  // Sunucu aksiyonu bitip sayfa yeniden render edilmeden ilerlemek yarış yaratıyor.
  await page.waitForLoadState("networkidle");
  await page.goto(planUrl);

  // Seed'deki 34ABC01 (27) ve 34XYZ02 (16) kapasiteli; üç yolcu ilk araca sığar
  await expect(page.getByRole("heading", { name: "34ABC01" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "E2E Plan Yolcu A" })).toBeVisible();

  // Yayınla, sonra aktifleştir
  await page.getByRole("button", { name: "Yayınlandı" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(planUrl);
  await page.getByRole("button", { name: "Aktif" }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/operasyon/harita");
  await expect(page.getByRole("row").filter({ hasText: "E2E Plan Yolcu A" })).toBeVisible();
});

test("aktif plan silinemez", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/operasyon/rota-planlama?durum=aktif");
  const activeRows = page.getByRole("row").filter({ hasText: "Aktif" });
  if ((await activeRows.count()) > 0) {
    await expect(activeRows.first().getByRole("button", { name: "Sil" })).toHaveCount(0);
  }
});
