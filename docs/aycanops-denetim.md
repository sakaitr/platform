# AycanOps → Platform — Kullanılabilirlik Denetimi

**Tarih:** 2026-09-08
**Kaynak:** `github.com/sakaitr/aycanops` @ `c3d9113` (local = uzak, senkron)
**Kanıt:** canlı MariaDB satır sayıları + kod envanteri + canlı UI gezintisi

---

## Yöntem

Kod satır sayısı tek başına yanıltıcı. Asıl ölçüt: **canlı veritabanında gerçek operasyon verisi var mı.**
Boş tablo = modül yazılmış ama sahada kullanılmamış.

---

## A. KANITLANMIŞ — gerçek üretim verisi var

Port önceliği en yüksek. Mantık sahada doğrulanmış.

| Modül | Kanıt (canlı satır) | Kod | Platform hedefi |
|---|---|---|---|
| **Giriş kontrol** | `vehicle_arrivals` **32.668** | 1.043 satır | operasyon |
| **Yolcu/personel** | `passengers` **3.730** | 1.124 satır, 6 API | operasyon |
| **Araçlar** | `company_vehicles` 2.406 · `vehicles` 899 | 1.727 satır | filo |
| **Denetimler** | `inspections` 455 + 348 foto | 1.617 satır | filo |
| **Firmalar/cari** | `companies` 183 · `musteriler` 185 · `cari_tedarikci` 188 | 1.766 satır | CRM |
| **Finans (gider/hareket)** | `finans_gider` 126 · `finans_hareket` 133 · `finans_kategori` 78 | 3.398 satır, **39 API** | muhasebe |
| **Güzergah + rota planlama** | `routes` 85 · `route_plan_stops` 85 · `geocode_cache` 202 | 2.658 satır | operasyon |
| **Ziyaretçi kayıt** | `ziyaretci_kayitlari` 130 | 237 satır | operasyon (küçük) |
| **Günlük check-in** | `gunluk_cevap` 64 · `gunluk_soru` 12 | 1.280 satır | operasyon |
| **Sürücüler** | `drivers` 27 | 1.116 satır | filo |
| **Müşteri portalı** | `portal_sessions` 28 · `customer_user_companies` 19 | 2.189 satır, **16 API** | portal |
| **Görev/worklog** | `todos` 24 · `worklogs` 16 | 1.183 satır | proje/ticket |
| **Import merkezi** | `import_job_rows` **6.606** · `import_jobs` 10 | 5 API | çekirdek (veri göçü!) |

## B. YAZILMIŞ AMA KULLANILMAMIŞ — kod var, veri yok

Kod ve uçtan uca testleri var (GELISTIRME_PLANI'nda belgeli) ama **sahada hiç çalıştırılmamış**.
Port edilebilir, ancak iş kuralları gerçek kullanımla doğrulanmamış.

| Modül | Canlı veri | Kod |
|---|---|---|
| **Muhasebe zinciri** — işleten/hakediş/cari/mutabakat | `isleten` **0** · `hakedis` **0** · `isleten_cari` **0** · `firma_mutabakat` **0** | 984 + 629 + 226 satır, 7 API |
| **Çetele** | `cetele` **6** (test kaydı) | 1.254 satır, 3 API |
| **Filo detay** — kaza/ceza/arıza/sigorta/lastik | `vehicle_accidents` 1, diğerleri **0** | 1.146 satır, 10 API |
| **Yakıt kartı / HGS** | `yakit_kartlari` 0 · `yakit_dolumlar` 0 · `hgs_ogs` 0 | 465 satır |
| **GPS / Arvento** | `gps_cihazlari` 0 · `gps_events` 0 · `geofences` 0 · `vehicle_locations` 8 | entegrasyon kodu var |
| **Duyuru / anket** | `duyurular` 0 · `anketler` 0 | Sprint 8 |
| **Rehber / kara liste** | `rehberler` 0 · `kara_liste` 0 | Sprint 4 |
| **Ödeme planı / servis değişikliği** | ikisi de 0 | Sprint 3 |

## C. İSKELET / ÖLÜ — port etme

| Sayfa | Durum |
|---|---|
| `seferler` | 5 satır — yönlendirme |
| `is-giris` | 10 satır |
| `offline` | 24 satır — PWA yardımcı |
| `operasyon` | 55 satır |
| `tedarikciler`, `fiyat-yetkilileri` | **boş klasör** |

---

## Taşınmaya değer altyapı parçaları

Modül değil ama platforma doğrudan kazanç:

| Parça | Neden |
|---|---|
| **Rapor motoru** (`lib/reports/{catalog,engine,queries}.ts`) | Deklaratif, **32 rapor tanımı**, XLSX+PDF otomatik. Platformda `raporlar` modülünün çekirdeği olur |
| **Import merkezi** (`lib/import-center.ts` + 5 API) | Şablon→yükle→eşleştir→önizle→uygula→geri al. **6.606 satır işlenmiş** = sahada çalışıyor. Yeni müşteri onboarding'inin kilit parçası |
| **Rota planlayıcı** (`lib/planner.ts` + `geocode.ts`) | Otomatik durak önerisi, ana yol yaklaştırma, U-dönüşü azaltma. Özgün değer |
| **WhatsApp istemcisi** (`lib/whatsapp*.ts`) | Bildirim kanalı |
| **Numaralandırma** (`ticketNo/suggestNo/warningNo`) | Platformda zaten yazdım, deseni doğruladı |
| **Finans yardımcıları** (`finans-gider.ts`, `finans-hareket.ts`) | 39 API'nin mantığı |

---

## aycanops sayfası → platform modülü eşlemesi

| Platform modülü | aycanops kaynağı |
|---|---|
| **operasyon** | giris-kontrol · gunluk · guzergahlar · acik-guzergahlar · rota-planlama · operasyon-haritasi · transferler · cetele · yolcular · ziyaretci-kayit |
| **filo** | araclar · bakim · belgeler · denetimler · filo/* · yakit-kartlari · suruculer · surucu-sicil · sofor-degerlendirme |
| **muhasebe** | finans/* · isletenler · hakedis · mutabakat · kar-zarar · butce · cari-tedarikci · guzergah-fiyatlari |
| **CRM** | firmalar · musteriler · musteri-destek |
| **portal** | portal/* |
| **raporlar** | raporlar + `lib/reports/*` |
| **görev/ticket** | gorevler · sorunlar · notlar · oneriler |
| **İK** | izin-talepleri · arac-is-basvuru · rehberler |
| **yönetim** | admin/* (41 dosya, 9.160 satır) · toplu-islem |

---

## Önerilen port sırası

**1. operasyon** — en yoğun kanıt (32.668 giriş kaydı, 3.730 yolcu). Ürünün kalbi.
**2. filo** — 2.406 araç + 455 denetim. Operasyona bağlı.
**3. muhasebe** — 39 finans API'si + 126 gider **kanıtlı**; hakediş/işleten zinciri **kanıtsız** ama kodu hazır.
**4. CRM + portal** — firma/müşteri + dış erişim.
**5. raporlar** — motor hazır, üstteki modüller oturunca anlamlı.

Paralel/erken: **import merkezi** çekirdeğe alınmalı — her modülün veri göçü ona bağlı.

---

## Uyarılar

- **Güvenlik:** canlıda `admin123` / `admin123`. Zayıf. Aycan kapanıyor olsa da sistem halka açık — kapatılana kadar şifre değiştirilmeli.
- **Rol kapsamı:** verilen hesap `Personel` rolünde, çoğu modüle erişemiyor. Tam UI denetimi için `admin`/`yonetici` rollü hesap gerekli.
- **Stack farkı:** aycanops MySQL + ham SQL (ORM yok) → platform Postgres + Drizzle. Port = sorgu çevirisi, tasarım kopyası.
- **Önceki değerlendirmem düzeltildi:** muhasebe zincirini "sahada test edilmiş" diye nitelemiştim — yanlış. Kodu ve uçtan uca testleri var, **gerçek kullanımı yok**.

---

# EK: Canlı UI Denetimi (admin yetkisiyle)

**Hesap:** `admin` / Kayra İşbilir (Admin rolü)

## UI kalitesi: üretim seviyesi

Gezilen modüller tutarlı ve olgun. Ortak desenler oturmuş:
arama · çoklu filtre · sayfalama (50/sayfa) · toplu seçim (checkbox) · satır içi Düzenle/Sil ·
rozet/etiket · koyu tema · tam Türkçe · sağ üstte global firma seçici.

| Modül | Gözlem |
|---|---|
| **Yolcular** | **500 kayıt/sayfa, 10 sayfa.** Tür (Yolcu/Personel), aktif/pasif, firma filtresi, "Toplu Ekle". Sağlam. |
| **Raporlar** | **31 rapor**, firma bazlı + tarih aralıklı, XLSX & PDF, "Toplu Dışa Aktar". KPI paneli: Filo Kullanılabilirliği %100 (898/899), SLA %100, Denetim Geçme %85 (123/145). 6 sekme. **En değerli parçalardan.** |
| **Rota Planlama** | Vardiya bazlı plan, **versiyonlama (v1)**, Yayınla/Aktifleştir, Aktif/Arşiv durumu. Çalışıyor ama planlar test verisi ("tewst", "test"). |
| **Çetele** | UI **tam**: Günlük/Takvim toggle, tarih navigasyonu, durum filtreleri, Serbest Kayıt. Ama **0 kayıt** — yazılmış, kullanılmamış. |
| **Giriş Kontrol** | Araç Gelişleri / Sefer Kontrolleri sekmeleri, firma+tarih filtresi. En yoğun kullanılan modül. |

## Yetki sistemi — beklenenden çok gelişmiş

| | |
|---|---|
| Rol sayısı | **24** (admin, yonetici, operasyon_yetkili, muhasebe_yetkili, finans_yetkili, ik_yetkili, denetim, satinalma, teknik, genel_mudur...) |
| İzin anahtarı | **330 farklı** — `kaynak:eylem` deseni (`arrivals:create`, `anketler:read`, `audit:export`) |
| Hiyerarşi | `hierarchy_level` 0–3, `is_system` bayrağı |
| En yetkili rol | `yonetim_dept` 308 izin · `yonetici` 255 · `admin` 249 |
| Kapsam | ayrıca `allowed_pages` + `allowed_companies` (kullanıcı bazlı) |

**Platform şu an 5 rol × 5 izinle çalışıyor.** Port sırasında bu model genişletilmeli —
ama sektör paketi mimarisiyle uyumlu: roller de pakete girebilir.

## Bulunan hata

**Panel (`/`) hiçbir admin için açılmıyor** — `admin123` ve ana `admin` hesabı, ikisi de
"Bu sayfaya erişim yetkiniz yok" alıyor. Middleware (`proxy.ts`) sadece `personel` ve
finans rollerini engelliyor, yani engel sayfa içi kontrolden geliyor.
Port'u etkilemez (platformun kendi dashboard'u var) ama aycanops canlı kaldığı sürece kusur.

## Port için kritik teknik notlar

- **Yetki çerezi:** `opsdesk_role` httpOnly çerezde tutuluyor, middleware ona güveniyor.
  DB'de rol değişince çerez eskide kalıyor → yeniden giriş gerekiyor.
  **Platformda bunu yapma** — rol her istekte oturumdan/DB'den çözülmeli.
- **CSRF:** `proxy.ts` mutasyon API'lerinde origin/referer kontrolü yapıyor. İyi desen, taşınmalı.
- **Global firma seçici:** üst barda, localStorage kalıcı. Platformda "kapsam seçici" olarak karşılığı olmalı.
