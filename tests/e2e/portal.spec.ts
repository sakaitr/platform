import { expect, test, type Page } from "@playwright/test";

async function portalLogin(page: Page, email: string): Promise<void> {
  await page.goto("/portal/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  // Yönlendirme tamamlanmadan gezinmek çerezi yarışa sokuyor.
  await page.waitForURL((url) => !url.pathname.endsWith("/giris"));
}

test("portal girişi çalışır ve firma adı görünür", async ({ page }) => {
  await portalLogin(page, "portal@e2e.test");
  await expect(page).toHaveURL("/portal");
  await expect(page.getByRole("heading", { name: "Merhaba Portal Musteri" })).toBeVisible();
  await expect(page.getByText("Alfa Sanayi").first()).toBeVisible();
});

test("yanlış şifre hesap varlığını sızdırmaz", async ({ page }) => {
  await page.goto("/portal/giris");
  await page.getByLabel("E-posta").fill("portal@e2e.test");
  await page.getByLabel("Şifre").fill("YanlisSifre123");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();

  await page.getByLabel("E-posta").fill("olmayan@e2e.test");
  await page.getByLabel("Şifre").fill("YanlisSifre123");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  // Aynı mesaj: var olan hesapla olmayan ayırt edilemez
  await expect(page.getByText("E-posta veya şifre hatalı.")).toBeVisible();
});

test("portal yalnız kendi firmasının taleplerini gösterir", async ({ page }) => {
  await portalLogin(page, "portal@e2e.test");
  await page.goto("/portal/talepler");
  await expect(page.getByRole("row").filter({ hasText: "Alfa talebi" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Beta talebi" })).toHaveCount(0);
});

test("portal kullanıcısı personel paneline giremez", async ({ page }) => {
  await portalLogin(page, "portal@e2e.test");
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/login");
});

test("oturumsuz portal sayfası girişe yönlendirir", async ({ page }) => {
  await page.goto("/portal/talepler");
  await expect(page).toHaveURL("/portal/giris");
});

test("firmasız portal hesabı erişim yok sayfasına düşer", async ({ page }) => {
  await portalLogin(page, "portal-bos@e2e.test");
  await page.goto("/portal");
  await expect(page).toHaveURL("/portal/erisim-yok");
});

test("portalden açılan talep personel kuyruğuna düşer", async ({ page }) => {
  await portalLogin(page, "portal@e2e.test");
  await page.goto("/portal/talepler");

  await page.getByRole("button", { name: "Yeni Talep" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Gönder" }) });
  await form.getByLabel("Konu").fill("E2E Portal talebi");
  await form.getByLabel("Açıklama").fill("Servis saatinde gelmedi");
  await form.getByRole("button", { name: "Gönder" }).click();
  await expect(form.getByText(/TLP\d{4}-\d{6} açıldı/)).toBeVisible();

  // Personel tarafında Portal kaynağıyla görünmeli
  await page.goto("/login");
  await page.getByLabel("E-posta").fill("kisitli-owner@e2e.test");
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
  await page.goto("/destek?kaynak=portal");
  await expect(page.getByRole("row").filter({ hasText: "E2E Portal talebi" })).toBeVisible();
});

test("personelin iç notu portalde görünmez", async ({ page }) => {
  // Personel bir talebe iç not düşer
  await page.goto("/login");
  await page.getByLabel("E-posta").fill("kisitli-owner@e2e.test");
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");

  await page.goto("/destek");
  const row = page.getByRole("row").filter({ hasText: "Alfa talebi" });
  await row.getByRole("link").click();

  const reply = page.locator("form").filter({ has: page.getByRole("button", { name: "Kaydet" }) });
  await reply.getByLabel("Mesaj").fill("GIZLI-IC-NOT");
  await reply.getByLabel("İç not (müşteri görmez)").check();
  await reply.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText("GIZLI-IC-NOT")).toBeVisible();

  const ticketUrl = page.url();
  const ticketId = ticketUrl.split("/destek/")[1];

  await portalLogin(page, "portal@e2e.test");
  await page.goto(`/portal/talepler/${ticketId}`);
  await expect(page.getByRole("heading", { name: /Alfa talebi/ })).toBeVisible();
  await expect(page.getByText("GIZLI-IC-NOT")).toHaveCount(0);
});
