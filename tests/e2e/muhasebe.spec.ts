import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("gider eklenir, KDV brütten ayrılır", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/muhasebe/hareketler");

  await page.getByRole("button", { name: "Yeni Hareket" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Tarih", { exact: true }).fill("2026-09-05");
  await form.getByLabel("Tutar (KDV dahil)").fill("1200");
  await form.getByLabel("KDV Oranı (%)").fill("20");
  await form.getByLabel("Belge No").fill("E2E-GID-1");
  await form.getByRole("button", { name: "Kaydet" }).click();

  const row = page.getByRole("row").filter({ hasText: "E2E-GID-1" });
  // 1200 brütün KDV'si 200,00
  await expect(row.getByText("₺200,00")).toBeVisible();
});

test("hakediş çetelesiz oluşturulamaz", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/muhasebe/isletenler");

  // Önce bir işleten tanımla
  await page.getByRole("button", { name: "Mali Bilgi Ekle" }).click();
  let form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Firma").selectOption({ label: "Alfa Sanayi" });
  await form.getByLabel("Cari Kod").fill("E2E-CARI-1");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("Mali bilgiler kaydedildi.")).toBeVisible();

  await page.goto("/muhasebe/hakedis");
  await page.getByRole("button", { name: "Hakediş Oluştur" }).click();
  form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("İşleten").selectOption({ label: "Alfa Sanayi" });
  await form.getByLabel("Sefer Başı Ücret").fill("1000");
  await form.getByRole("button", { name: "Kaydet" }).click();

  await expect(page.getByText("hakedişe bağlanabilecek onaylı çetele yok")).toBeVisible();
});

test("cari hareket eklenir ve bakiye borç eksi alacak olarak yürür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");

  // Firma kimliğini firmalar sayfasındaki düzenle bağlantısından alıyoruz.
  await page.goto("/crm/firmalar");
  const editHref = await page
    .getByRole("row")
    .filter({ hasText: "Beta Tekstil" })
    .getByRole("link", { name: "Düzenle" })
    .getAttribute("href");
  const companyId = editHref?.split("duzenle=")[1];
  expect(companyId).toBeTruthy();

  await page.goto(`/muhasebe/cari/${companyId}`);

  const add = async (field: string, amount: string, description: string): Promise<void> => {
    await page.getByRole("button", { name: "Hareket Ekle" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
    await form.getByLabel(field).fill(amount);
    await form.getByLabel("Açıklama").fill(description);
    await form.getByRole("button", { name: "Kaydet" }).click();
    await expect(form.getByText("Cari hareket eklendi.")).toBeVisible();
    await page.goto(`/muhasebe/cari/${companyId}`);
  };

  await add("Borç (₺)", "10000", "E2E fatura");
  await add("Alacak (₺)", "4000", "E2E tahsilat");

  // 10.000 borç − 4.000 alacak = 6.000
  await expect(page.getByRole("row").filter({ hasText: "E2E tahsilat" }).getByText("₺6.000,00")).toBeVisible();
});

test("lojistik kiracısında hakediş menüsü yok", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await expect(page.getByRole("link", { name: "Hakedişler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Gelir / Gider", exact: true })).toBeVisible();
  await page.goto("/muhasebe/hakedis");
  await expect(page).toHaveURL("/muhasebe/hareketler");
});

test("turizm kiracısında hakediş ve mutabakat açık", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await expect(page.getByRole("link", { name: "Hakedişler", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Mutabakat", exact: true })).toBeVisible();
});

test("kâr-zarar sayfası gelir gider farkını gösterir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/muhasebe/kar-zarar");
  await expect(page.getByRole("heading", { name: "Kâr / Zarar" })).toBeVisible();
  await expect(page.getByText("Marj")).toBeVisible();
});

test("lojistik kiracısı irsaliye kesebilir, numara otomatik gelir", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await expect(page.getByRole("link", { name: "İrsaliyeler", exact: true })).toBeVisible();

  await page.goto("/muhasebe/irsaliyeler");
  await page.getByRole("button", { name: "Yeni İrsaliye" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Malın Cinsi").fill("E2E Palet");
  await form.getByLabel("Miktar").fill("12");
  await form.getByLabel("Birim").fill("koli");
  await form.getByRole("button", { name: "Kaydet" }).click();

  // Numara IR ön eki + yıl + altı hane dolgu: IR2026-000001
  await expect(form.getByText(/IR\d{4}-\d{6} oluşturuldu\./)).toBeVisible();
  await page.goto("/muhasebe/irsaliyeler");
  await expect(page.getByRole("row").filter({ hasText: "E2E Palet" }).getByText("12 koli")).toBeVisible();
});

test("turizm kiracısında irsaliye kapalı", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await expect(page.getByRole("link", { name: "İrsaliyeler", exact: true })).toHaveCount(0);
  await page.goto("/muhasebe/irsaliyeler");
  await expect(page).toHaveURL("/muhasebe/hareketler");
});

test("firma detayı sorumlu, vardiya, araç ve giriş geçmişini gösterir", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/crm/firmalar");

  await page.getByRole("link", { name: "Alfa Sanayi" }).click();
  await page.waitForURL(/\/crm\/firmalar\/[0-9a-f-]{36}$/);
  const url = page.url();

  await expect(page.getByRole("heading", { name: "Sorumlular" })).toBeVisible();
  await expect(page.getByText("Henüz sorumlu atanmamış")).toBeVisible();

  // Sorumlu ata
  await page.getByRole("button", { name: "Sorumlu Ata" }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(url);
  await expect(page.getByText("Henüz sorumlu atanmamış")).toHaveCount(0);

  // Vardiya ekle
  await page.getByRole("button", { name: "Vardiya Ekle" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await form.getByLabel("Vardiya Adı").fill("gece");
  await form.getByLabel("Beklenen Saat").fill("23:00");
  await form.getByRole("button", { name: "Kaydet" }).click();
  await expect(form.getByText("Vardiya eklendi.")).toBeVisible();

  await page.goto(url);
  await expect(page.getByRole("row").filter({ hasText: "gece" })).toBeVisible();
  // Firmanın aracı listede
  await expect(page.getByRole("link", { name: "34ABC01" })).toBeVisible();
});
