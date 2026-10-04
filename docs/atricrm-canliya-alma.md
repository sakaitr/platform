# AtriCRM canlıya alma kontrol listesi

Bu liste **Kayra'nın** yapacağı adımlardır; kod tarafı dalda hazırdır, deploy yapılmamıştır.

## Önce

- [ ] Dalı gözden geçirip birleştirin. Dal, `feat/cekirdek-sektor-motoru` (b88a022) üzerine kuruludur. **GitHub `main` bu daldan 52 commit geridedir: `main`'e değil çekirdek dalına birleştirin.**
- [ ] Üretim kodu yerel ağaçtan `rsync` ile gittiği için GitHub dalı ile üretim arasında fark olabilir: deploy öncesi karşılaştırın.
- [ ] `.env.production` dosyasına **`INTEGRATION_SECRET_KEY`** ekleyin (en az 32 karakter, `openssl rand -base64 48`). Uygulama ve worker aynı `.env.production`'ı kullanıyor, tek yerden okunur. **Yedeğini güvenli bir yerde tutun; değişirse kayıtlı tüm webhook anahtarları çözülemez.**
- [ ] `APP_URL` ve `REDIS_URL` zaten tanımlı olmalı (Entegrasyonlar sayfası adresi `APP_URL`'den üretir).

## Veritabanı

- [ ] Yeni tablolar: `crm_stages`, `crm_leads`, `crm_contacts`, `crm_deals`, `crm_activities`, `crm_quotes`, `crm_templates`, `crm_integrations`, `crm_inbound_events`, `crm_deleted_external`, `crm_webhook_deliveries`, `crm_api_keys` (12 tablo, hepsi `tenant_id` taşır ve RLS ile korunur).
- [ ] `scripts/deploy.sh` şema + RLS'i birlikte uygular ve `pgTable(` sayısıyla tablo sayısını, korunmasız tablo sayısını doğrular. Elle uygulayacaksanız **çıplak `db:push` kullanmayın, `npm run db:sync` kullanın** (RLS'i kapatır).
- [ ] Yalnızca ekleme yapılır (yeni tablolar, yeni enum'lar). Mevcut tablolara dokunulmaz.

## Servisler

- [ ] **Worker yeni kodla yeniden başlamalı**: deploy sonrası `agno_platform_worker` konteynerinin yeni imajla çalıştığını doğrulayın (`docker compose -f docker-compose.prod.yml ps`). Yeni işler: `webhooks` kuyruğu işleyicisi, 5 saniyelik süpürücü, günlük görev özeti, 6 saatte bir temizlik. Worker çalışmazsa giden webhook'lar **gönderilmez** (olaylar veritabanında bekler, worker gelince gönderilir).
- [ ] Redis erişilebilir olmalı (kuyruk ve hız sınırı).

## Agno kiracısı ve ilk bağlantı

- [ ] Agno'nun kendi kiracısını `satis_crm` paketiyle kurun: `npx tsx scripts/provision.ts --name "Agno" --slug agno --pack satis_crm --email … --password …`. Başka bir kiracıya sonradan `satis` modülü açılacaksa operatör panelinden modülü ve (isteniyorsa) `satis.teklif`, `satis.entegrasyon` yeteneklerini açın; pipeline aşamaları ilk kullanımda otomatik kurulur, teklif numara dizisi ilk tekliflerle otomatik kurulur.
- [ ] Satış kullanıcılarına roller: `satis_yonetici` (hepsini görür), `satisci` (yalnız kendine atanmış ve sahipsiz kayıtlar), `satis_izleyici` (salt okur).
- [ ] Entegrasyonlar sayfasında **Atricard bağlantısı** oluşturun. Çıkan adresi ve anahtarı Atricard'da Ayarlar, Bağlantılar bölümüne girin (anahtar bir daha gösterilmez).
- [ ] Atricard'dan **"test gönder"** ile ilk teslimi sınayın: aday listesinde `Atricard` kaynaklı kayıt belirmeli, Entegrasyonlar sayfasındaki "Gelen olaylar" listesinde `İşlendi` görünmeli.
- [ ] Giden webhook kullanılacaksa: oluşturun, onay kutusunu işaretleyin, **Test gönder** ile alıcının imzayı doğrulayıp `2xx` döndüğünü doğrulayın (`docs/integrations/atricrm.md` örnek kodlar).
- [ ] İsteğe bağlı: eski Agno CRM verisini taşıyın (`docs/integrations/agno-crm-tasima.md`), önce DENEME ile.

## Elle denenecekler (hızlı)

1. Yönetici ile giriş: aday ekle, aynı telefonla ikinci kez ekle (reddedilmeli), CSV içe aktar, müşteriye dönüştür.
2. Satışçı ile giriş: yalnız kendi ve sahipsiz adaylarını görmeli, başkasının adayının adresi `404` vermeli.
3. Pipeline: kartı sürükle, "Kaybedildi"ye bırakınca neden sorulmalı; görev ekle, Görevler sayfasında "Bugün" altında görünmeli.
4. Teklif: kalem ekle, toplamı kontrol et, gönderildi yap (düzenleme kilitlenmeli), "Yeni sürüm oluştur", Yazdır sayfasını tarayıcıdan PDF olarak kaydet.
5. Raporlar: Satış kategorisinde beş rapor, CSV ve Excel indirme. Satışçı hesabında görünmemeli.
6. Atricard'da bir lead sil: AtriCRM'de aday silinmeli (fırsatı varsa anonimleşmeli), sonradan aynı kimlikle `lead.created` gelirse yok sayılmalı.

## Bilinen sınırlar ve karar bekleyenler

Ayrıntı için dalın son raporuna bakın. Özet: `/kvkk` aydınlatma metni, İYS ve ticari ileti izni, veri işleyen sözleşmesi hukuki işlerdir; AtriCRM adı/alan adı, paketleme ve tek hesap kararları bekliyor; Agno CRM'in kapatılması ayrı bir karardır.
