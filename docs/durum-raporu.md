# Agno Platform — Durum Raporu

**Tarih:** 2026-09-08
**Canlı:** https://platform.agno.digital
**Depo:** github.com/sakaitr/platform · dal `feat/cekirdek-sektor-motoru`

---

## Ne yapıldı

aycanops'un 45 sayfası ve 301 API'si tek platforma taşındı. Taşıma birebir kopya
değil: aycanops MySQL + ham SQL ile yazılmıştı, platform PostgreSQL + Drizzle +
satır düzeyi güvenlik kullanıyor. İş kuralları (hakediş zinciri, çetele onayı,
rota optimizasyonu) korundu; altyapı yeniden yazıldı.

| | Sayı |
|---|---|
| Sayfa | 66 |
| Tablo | 77 (hepsinde RLS politikası) |
| Modül | 10 |
| İzin anahtarı | 178 |
| Rapor | 12 |
| Birim test | 190 |
| Uçtan uca test | 59 |

---

## Modüller

**Operasyon** — giriş kontrol, güzergahlar, açık güzergahlar, rota planlama,
harita, çetele, transferler, yolcular, ziyaretçiler, günlük check-in

**Filo** — araçlar, sürücüler, bakım, belgeler, denetimler, kazalar, cezalar,
arızalar, sigortalar, lastikler, yakıt kartları, yakıt dolumları, uyarılar,
sürücü sicili, şoför değerlendirme

**Muhasebe** — gelir/gider, kategoriler, cari, kâr-zarar, bütçe, işletenler,
ücretlendirme, hakedişler, mutabakat, irsaliyeler, güzergah fiyatları

**CRM** — firmalar (müşteri, tedarikçi, işleten tek tabloda)

**Görevler** — görevler, duyurular, rehber, kara liste

**Destek** — talepler, öneri/şikâyet

**İnsan Kaynakları** — izinler, izin türleri

**Raporlar** — 12 rapor, CSV ve Excel çıktısı

**Yönetim** — kullanıcılar, roller, firma kapsamı, terimler, özel alanlar,
modüller, denetim izi, veri aktarımı, portal kullanıcıları

**Müşteri Portalı** — ayrı oturum, firma bazlı izolasyon, talep açma ve
servis gelişi görüntüleme

**Operatör Paneli** — kiracı kurma, lisans yönetimi, paket yenileme

---

## Sektöre uyarlama nasıl çalışıyor

Talep edilen asıl mesele buydu: aynı modül farklı sektörde farklı davransın,
kod çoğaltılmasın. Dört katman var:

1. **Terim sözlüğü** — `customer` turizmde "Firma", lojistikte "Müşteri",
   pilateste "Üye", oto serviste "Araç Sahibi". Sayfalar sabit metin yazmaz.
2. **Özel alanlar** — lojistik faturasında `irsaliye_no` zorunlu, turizmde yok.
3. **Alt yetenekler** — `muhasebe.irsaliye` lojistikte açık, turizmde kapalı;
   `muhasebe.hakedis` turizmde açık, lojistikte kapalı. Hem menü hem sayfa hem
   sunucu aksiyonu bu bayrağa bakar.
4. **Sektör paketi** — modül listesi, terimler, alanlar, numaralar ve roller
   tek bir TypeScript kaydında. Yeni sektör eklemek = yeni kayıt; modül kodu
   değişmez.

Kurulu paketler: turizm, lojistik, pilates, oto servis.

---

## aycanops'tan düzeltilenler

| aycanops'ta | Platformda |
|---|---|
| Rol httpOnly çerezte; DB'de değişince çerez eskide kalıyor | Rol ve izin her istekte DB'den çözülüyor |
| `isleten` ve `cari_tedarikci` ayrı tablolar | İkisi de `companies` satırı; mali alanlar uzantıda |
| `finans_gider` ve `finans_hareket` aynı şeyi tutan iki tablo | Tek tablo, tür alanı ayırıyor |
| Rota planlama OSRM'nin halka açık sunucusuna bağımlı | Mesafe yerelde hesaplanıyor; dış servis yok |
| Portal talepleri ayrı tabloda, ayrı kuyrukta | Tek tablo, `source` alanı ayırıyor; tek SLA |
| Tutarlar float | Kuruş tam sayısı; float hiç kullanılmıyor |

---

## Veri bütünlüğü şemada garanti altında

Kod değil, veritabanı zorluyor:

- Aynı araç, aynı gün, aynı vardiyada ikinci geliş kaydı açılamaz
- Bir çetele yalnız bir hakedişe girer (çift ödeme imkânsız)
- Plaka ve barkod kiracı içinde tekil
- Her tabloda `tenant_id` ve RLS politikası; `db:sync` korumasız tablo bulursa durur
- Onaylanmış çetele düzenlenemez ve silinemez; onay geri alınırken neden zorunlu

---

## Bekleyenler

**Güvenlik (sizin yapmanız gerekenler):**
- aycanops deposundaki GitHub kişisel erişim anahtarı hâlâ geçerli, iptal edilmeli
- Terk edilmiş Filovio compose dosyasındaki Resend anahtarı döndürülmeli
- aycanops canlısındaki `admin123` / `kayra123` şifreleri değiştirilmeli
- platform.agno.digital'deki demo şifresi `Demo1234!` değiştirilmeli

**Ürün tarafı:**
- Fatura/e-belge (GİB entegrasyonu)
- Depo/stok modülü
- Pazarlama modülü (telemarketing, lead)
- KVKK paketi: veri işleme sözleşmesi, dışa aktarım ve silme akışı
- PSYS ve OSYS'nin (Fixy) pilates ve oto servis paketlerine oturtulması
