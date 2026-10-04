# Agno Platform — CRM Modülü + Atricar Bağlantı Katmanı (Plan 8, taslak)

> **Durum:** TASLAK — onay bekliyor. Kod yazılmadı. Ayrıntılı task/test adımları onaydan sonra `Faz 1` planı formatında genişletilecek.

**Amaç:** Atricar'a bağlanan şirketlerin işini kolaylaştıran, platformun `crm` modülü. Şirket Atricar'a bağlandığı anda hazır bir CRM'e sahip olur: talepler (lead) kendiliğinden düşer, kimse veri girmez, kimse kurulum yapmaz.

## Varsayımlar (yanlışsa söyle, plan değişir)

| # | Varsayım | Yanlışsa etkisi |
|---|---|---|
| A1 | Atricar, araç odaklı harici bir platform. Şirketler (galeri, servis, filo/kiralama) ona bağlanır; Atricar bu şirketlere lead/talep, araç ve müşteri verisi akıtır. | Bağlayıcı katmanı (Bölüm 3) aynı kalır, yalnızca olay şemaları değişir. |
| A2 | Atricar'ın henüz bilinen/kararlı bir API'si yok veya bize açık değil. | Aşağıda `AtricarConnector` arayüzünün arkasına gizlenir. API netleşince sadece bir adaptör yazılır. |
| A3 | CRM, bu repodaki platforma `crm` modülü olarak oturur (kiracı + RLS + lisans + sektör paketi altyapısı hazır). | Bağımsız ürünse altyapı Faz 1'den kopyalanır; maliyet artar. |
| A4 | Ana akış tek yönlü: **Atricar → CRM** (lead/araç/müşteri gelir). CRM → Atricar yalnızca durum geri bildirimi (örn. "teklif verildi", "satıldı"). | İki yönlü senkron istenirse Bölüm 3.4 genişler, çakışma çözümü gerekir. |
| A5 | Hedef şirket: Türk KOBİ, tek kişi ile 15 kişilik ekip arası; CRM bilgisi yok. | Kurumsal ise rol/yetki ve raporlama derinleşir. |

## Bağımlılık

Repo şu an yalnızca iskelet (Faz 1, Task 1). Bu plan **Faz 1 Task 1–10** (şema, RLS, kimlik, modül kaydı, sektör paketi, provizyon) bittikten sonra başlar. Faz 1'e dokunmaz; yalnızca `MODULE_KEYS`'e `"crm"` ekler ve RLS listesini genişletir.

---

## 1. Şirketin işini kolaylaştıran ilkeler (tasarım ölçütü)

Her özellik şu sorudan geçer: *"Bunu şirket kendisi yapmak zorunda kalıyor mu?"* Cevap evetse otomatikleştirilir.

1. **Sıfır kurulum:** Bağlanınca pipeline, aşamalar, mesaj şablonları, alanlar hazır gelir (sektör paketinden).
2. **Sıfır veri girişi:** Lead Atricar'dan gelir; müşteri, araç ve talep kaydı otomatik açılır. Elle giriş sadece istisna.
3. **Çift kayıt yok:** Aynı telefon/e-posta/plaka ikinci kez gelirse yeni kayıt değil, mevcut kişiye yeni talep eklenir.
4. **İlk 5 dakikada değer:** Bağlandıktan sonra "ilk lead'ini yanıtla" ekranına düşer. Boş dashboard yok.
5. **Mobil-öncelikli:** Satışçı sahada. Tek dokunuşla ara / WhatsApp / not ekle.
6. **Hiçbir lead unutulmaz:** Yanıtsız lead için SLA sayacı, hatırlatma, sahibine/yöneticiye bildirim.
7. **Şirketin diliyle:** Terimler sektör paketinden (galeri için "Araç", servis için "İş emri", kiralama için "Rezervasyon").
8. **KVKK hazır:** Rıza, kaynak, silme/anonimleştirme baştan var.

---

## 2. Kapsam

### Faz A — Çekirdek CRM (Atricar'sız da çalışır)
- Kişi/firma, talep (deal) ve pipeline/aşama yönetimi
- Aktivite akışı (arama, WhatsApp, not, e-posta), görev ve hatırlatma
- CSV içe aktarma (eski müşteri listesi), dışa aktarma
- Kanban + liste görünümü, arama, filtre, kayıtlı görünümler
- Sahip atama (elle + sıra dağıtımı), takım görünümü

### Faz B — Atricar bağlantısı
- Bağlantı sihirbazı (tek ekran, anahtar/yetkilendirme → test → bitti)
- Lead / araç / müşteri olaylarının güvenli alımı, tekilleştirme, otomatik kayıt
- Alan eşleme (varsayılanlı) ve sektör paketine göre ön ayar
- Bağlantı sağlığı ekranı: son olay, hata, yeniden dene
- Durum geri bildirimi (CRM → Atricar)

### Faz C — Verimlilik
- SLA ve otomatik yanıt kuralları, atama kuralları
- Mesaj/teklif şablonları (değişkenli)
- Raporlar: lead → satış dönüşümü, ilk yanıt süresi, kaynak başına performans
- WhatsApp Business / e-posta (Resend) kanal entegrasyonu

### Kapsam dışı (bu plan)
Faturalama/cari (Plan 2–3), randevu (Plan 4), pazarlama otomasyonu/toplu kampanya, Atricar'ın kendi tarafındaki geliştirmeler.

---

## 3. Mimari

### 3.1 Konum
`src/modules/crm/` (modüler monolit). Tüm tablolar kiracılı: `tenant_id` + indeks + RLS (`drizzle/9000_rls.sql` listesine eklenir, ayrı `9001_rls_crm.sql` olarak). Tüm okuma/yazma `withTenant()` içinde.

### 3.2 Veri modeli (Drizzle, `src/db/schema/crm.ts`)

| Tablo | Amaç | Önemli kolonlar |
|---|---|---|
| `crm_contacts` | Kişi/firma | `kind(person\|company)`, `name`, `phone_e164`, `email_lower`, `owner_user_id`, `consent_*`, `custom jsonb` |
| `crm_contact_identities` | Tekilleştirme anahtarları | `contact_id`, `type(phone\|email\|plate\|atricar_id)`, `value_normalized` — `unique(tenant_id,type,value_normalized)` |
| `crm_pipelines` / `crm_stages` | Süreç tanımı | `position`, `is_won`, `is_lost`, `sla_minutes` |
| `crm_deals` | Talep/fırsat | `contact_id`, `stage_id`, `source`, `amount numeric(14,2)`, `owner_user_id`, `first_response_at`, `custom jsonb` |
| `crm_activities` | Akış | `deal_id`, `contact_id`, `type`, `body`, `due_at`, `done_at`, `created_by` |
| `crm_assets` | Araç / ilgili varlık | `contact_id`, `plate_normalized`, `make`, `model`, `year`, `custom jsonb` |
| `integration_connections` | Bağlantı | `provider("atricar")`, `status`, `credentials_encrypted`, `last_event_at`, `last_error` |
| `integration_events` | Gelen kutusu | `connection_id`, `external_event_id`, `payload jsonb`, `status`, `attempts` — `unique(connection_id,external_event_id)` |
| `integration_field_maps` | Alan eşleme | `provider`, `source_path`, `target_field`, `transform` |

Kurallar (Faz 1 ile aynı): `uuid` PK, `timestamptz`, para `numeric(14,2)`, float yok, özel alanlar `custom jsonb` + `entity_fields` ile.

### 3.3 Bağlayıcı arayüzü (Atricar'ın API'si netleşmese de ilerlemeyi sağlar)

```
interface IntegrationConnector {
  provider: string
  verify(connection): Promise<ConnectionCheck>          // bağlantı testi
  parseInbound(request): Promise<NormalizedEvent[]>     // imza doğrula + normalize et
  pull?(connection, since): Promise<NormalizedEvent[]>  // webhook yoksa yoklama
  pushStatus?(connection, change): Promise<void>        // CRM → Atricar
}
```

`NormalizedEvent` = `lead.created | lead.updated | asset.upserted | contact.upserted`. Atricar'a özel her şey `src/modules/crm/connectors/atricar.ts` içinde kalır; CRM çekirdeği Atricar'ı bilmez. Yeni sağlayıcı = yeni adaptör.

### 3.4 Olay alımı (güvenilirlik)
1. `POST /api/integrations/atricar/webhook/:connectionToken` → **HMAC imzası + zaman damgası** doğrulanır, hızlıca `integration_events`'e yazılır, `202` döner (iş yapılmaz).
2. BullMQ worker olayı işler: normalize → tekilleştir → kişi/araç/talep oluştur → atama kuralı → bildirim.
3. **İdempotent:** `unique(connection_id, external_event_id)`; aynı olay iki kez gelirse tek etki.
4. **Yeniden deneme:** üstel geri çekilme, 5 deneme sonra `dead` + sağlık ekranında görünür + tek tıkla yeniden dene.
5. Sıra bozukluğuna dayanıklı: `updated_at` karşılaştırması ile eski olay yenisini ezmez.
6. Kimlik bilgileri **uygulama seviyesinde şifreli** (AES-256-GCM, anahtar env'de), loglara asla yazılmaz. Webhook token'ı döndürülebilir.

### 3.5 Tekilleştirme
Normalizasyon: telefon → E.164 (`+90…`), e-posta → küçük harf, plaka → boşluksuz büyük harf. Eşleşme önceliği: `atricar_id` → telefon → e-posta → plaka. Belirsiz eşleşme (örn. aynı telefon, farklı isim) otomatik birleştirilmez, "Birleştirme önerisi" olarak kuyruğa düşer.

### 3.6 Sektör paketi entegrasyonu
Faz 1 paket motoru kullanılır; paket başına: pipeline aşamaları, terminoloji, özel alanlar, şablonlar, atama/SLA varsayılanı, alan eşleme ön ayarı.

| Paket | Aşama örneği | Özel alan örneği |
|---|---|---|
| `oto_galeri` | Yeni → Arandı → Test sürüşü → Teklif → Satış / Kayıp | Bütçe, takas aracı, finansman ihtiyacı |
| `oto_servis` (var) | Talep → Randevu → İş emri → Teslim | Plaka, km, şasi no |
| `kiralama` | Talep → Müsaitlik → Teklif → Sözleşme | Kiralama süresi, teslim şehri |

### 3.7 İzinler
`crm.read`, `crm.write`, `crm.assign`, `crm.settings`, `crm.integrations`. Rol eşlemesi: `member` yalnız kendi kayıtlarını yazar, `manager` ekibi görür/atar, `admin` bağlantıyı yönetir.

---

## 4. Şirket deneyimi (ekranlar)

1. **Bağlan sihirbazı:** "Atricar'a bağlan" → yetkilendir/anahtar → otomatik test → sektör seç → "Hazırsın". Hedef: < 5 dk.
2. **Gelen kutusu (varsayılan açılış):** yanıtlanmamış lead'ler, SLA sayacı, tek dokunuşla Ara / WhatsApp / Not.
3. **Pipeline (kanban):** sürükle-bırak, aşama değişince Atricar'a otomatik durum.
4. **Kişi kartı:** tek sayfada geçmiş talepler, araçlar, tüm aktivite.
5. **Bağlantı sağlığı:** yeşil/kırmızı durum, son olay, hata nedeni, "yeniden dene".
6. **Günün özeti:** bugün aranacaklar, geciken görevler, haftalık dönüşüm.

Tasarım: platform kabuğu içinde (Radix + Tailwind), premium his, mobil önce. UI Türkçe; hata mesajları Türkçe, log İngilizce.

---

## 5. Uygulama sırası (taslak task listesi)

**Faz A — Çekirdek CRM**
1. `crm` modülü kaydı + izinler + RLS (9001) + şema
2. Kişi + tekilleştirme kimlikleri + normalizasyon yardımcıları (test: telefon/plaka/e-posta)
3. Pipeline/aşama + talep servisleri
4. Aktivite/görev + hatırlatma worker işi
5. Kanban + liste + kişi kartı UI
6. CSV içe/dışa aktarma
7. Sektör paketi: `oto_galeri` + `kiralama` CRM varsayılanları

**Faz B — Atricar**
8. `integration_*` şema + şifreli kimlik bilgisi yardımcısı
9. Webhook alımı + HMAC + gelen kutusu + idempotency
10. Olay işleyici worker (normalize → tekilleştir → oluştur)
11. `AtricarConnector` (başta sahte/fixture ile; gerçek API gelince adaptör)
12. Bağlan sihirbazı + sağlık ekranı + yeniden dene
13. Durum geri bildirimi (`pushStatus`)

**Faz C — Verimlilik**
14. Atama kuralları + SLA + bildirimler
15. Şablonlar (değişkenli) + WhatsApp/e-posta
16. Raporlar + günün özeti

Her task: önce başarısız test, sonra kod, Conventional Commit.

## 6. Test stratejisi
- **RLS:** her yeni tabloda iki kiracılı sızıntı testi (Faz 1 deseni).
- **Tekilleştirme:** tablo tabanlı birim testleri (Türkçe telefon biçimleri: `0532…`, `+90 532…`, `532…`).
- **Olay alımı:** aynı olay 2×, sıra bozuk olay, geçersiz imza, bozuk payload, worker çökmesi sonrası devam.
- **E2E (Playwright):** bağlan → lead gelir → kanbanda görünür → aşama değişir → Atricar'a durum gider (sahte sunucu).

## 7. Riskler
| Risk | Önlem |
|---|---|
| Atricar API'si belirsiz/değişken | Bağlayıcı arayüzü + fixture ile geliştirme; sözleşme netleşince tek adaptör |
| Yanlış otomatik birleştirme | Belirsizse birleştirme önerisi, otomatik değil |
| Webhook sahteciliği / tekrarı | HMAC + zaman penceresi + idempotency anahtarı |
| KVKK | Rıza alanı, kaynak kaydı, silme/anonimleştirme task'ı (Faz C'ye bağlı) |
| Kimlik bilgisi sızıntısı | Şifreli saklama, log maskeleme, token döndürme |

## 8. Netleşmesi gereken (blokaj değil, ama plan yönünü etkiler)
1. Atricar tam olarak nedir ve elimizde API/webhook dokümanı var mı? (A1–A2)
2. Hedef sektörler: galeri, servis, kiralama — hangisi ilk? (Bölüm 3.6)
3. Atricar'a durum geri bildirimi şart mı, yoksa ilk sürümde tek yön yeterli mi? (A4)
4. WhatsApp için resmî Business API mı, yoksa `wa.me` bağlantısı mı? (Faz C, maliyet farkı büyük)
