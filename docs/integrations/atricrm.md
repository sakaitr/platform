# AtriCRM entegrasyon rehberi

AtriCRM (Platform'un `satis` modülü) iki yönde konuşur:

- **Gelen:** Atricard'da bir lead oluşunca ya da silinince imzalı bir webhook AtriCRM'e gelir.
- **Giden:** AtriCRM'de bir olay olunca (aday, fırsat) müşterinin seçtiği adrese imzalı bir webhook gider.

Ek olarak yalnız okuma yapan bir API vardır (`/api/v1/leads`).

Tüm ayarlar Satış CRM, Entegrasyonlar sayfasındadır. Sayfa, `satis.entegrasyon` yeteneği açık ve `satis_entegrasyon:read` izni olan kullanıcıya görünür; değiştirmek için `satis_entegrasyon:update` gerekir.

## 1. Ortak kurallar

### İmza

İki yönde de aynı biçim kullanılır:

```
imza = "sha256=" + hex( HMAC-SHA256( gizli_anahtar, "<zaman_damgası>.<ham_gövde>" ) )
```

- `zaman_damgası`: Unix saniyesi, metin olarak.
- `ham_gövde`: isteğin gövdesi, **hiç değiştirilmeden**. JSON'u ayrıştırıp yeniden yazarsanız imza tutmaz. İmzayı mutlaka ham metin üzerinden doğrulayın.
- Karşılaştırma **sabit zamanlı** olmalıdır (`crypto.timingSafeEqual`, `hmac.compare_digest`).
- Zaman damgası **5 dakikadan eski ya da gelecekte** ise isteği reddedin (tekrar saldırısı).
- Tekrar denemelerde zaman damgası ve imza **her denemede yeniden üretilir**. Teslim kimliği aynı kalır.

### Gizli anahtar

- Biçim: `whsec_` + 64 onaltılık karakter.
- **Yalnızca oluşturulurken bir kez gösterilir.** Sonra hiçbir ekranda, günlükte ya da denetim kaydında görünmez. Kaybolursa "Anahtarı yeniden oluştur" kullanın; eski anahtar o anda geçersiz olur.
- Saklama: HMAC için ham anahtar gerektiği için hash değil **şifreli** saklanır. `INTEGRATION_SECRET_KEY` ortam değişkeninden HKDF-SHA256 ile türetilen anahtarla AES-256-GCM (`v1:iv:etiket:şifreli`). Satır kimliği şifrelemeye bağlıdır, bir satırın değeri başka satıra kopyalanırsa çözülmez.
- **`INTEGRATION_SECRET_KEY` değişirse kayıtlı tüm anahtarlar çözülemez.** Gelen webhook'lar `503`, giden teslimler "anahtar çözülemedi" hatasıyla başarısız olur. Çözüm: her bağlantıda "Anahtarı yeniden oluştur" ve yeni anahtarı karşı tarafa girmek. Ana anahtarı rastgele değiştirmeyin, yedeğini güvenli bir yerde tutun.

## 2. Gelen: Atricard → AtriCRM

Adres (Entegrasyonlar sayfasında oluşturulunca gösterilir):

```
POST https://<platform-adresi>/api/webhooks/atricard/<bağlantı-kimliği>
```

Bağlantı kimliği tahmin edilemez bir uuid'dir; kiracı bu kimlikten bulunur, istekten alınmaz.

### Başlıklar

| Başlık | Anlam |
|---|---|
| `Content-Type` | `application/json` (UTF-8) |
| `X-Atricard-Event` | `lead.created` ya da `lead.deleted` |
| `X-Atricard-Delivery` | Teslim kimliği (uuid). Aynı teslimin tekrar denemeleri aynı kimliği taşır |
| `X-Atricard-Timestamp` | Unix saniyesi |
| `X-Atricard-Signature` | `sha256=<hex>` |

### Yanıt kodları

| Kod | Ne zaman |
|---|---|
| `201` | Yeni aday oluştu (`{"status":"created","leadId":"…"}`) |
| `200` | Tekrar ya da işlenmiş: `duplicate`, `ignored`, `processed` |
| `400` | Gövde geçersiz (JSON bozuk, şema hatalı, başlıktaki olay gövdedekiyle uyuşmuyor) |
| `401` | İmza yok/yanlış ya da zaman damgası 5 dakikadan eski/gelecekte |
| `404` | Bağlantı yok, kapalı ya da lisans/yetenek kapalı |
| `413` | Gövde 256 KB'tan büyük |
| `429` | Hız sınırı (IP başına dakikada 120) |
| `503` | Sunucuda gizli anahtar çözülemiyor (yapılandırma sorunu) |

Gönderici yalnız `2xx`'i başarı sayar; diğer her yanıt tekrar denemeye girer.

### `lead.created` (v1)

```json
{
  "event": "lead.created",
  "version": 1,
  "id": "<lead uuid>",
  "occurred_at": "2026-10-04T10:15:00Z",
  "lead": {
    "name": "Deniz Yılmaz", "company": "Mavi Tur", "email": "deniz@example.com",
    "phone": "+905320000000", "message": "Teklif almak istiyoruz", "service": "Web sitesi",
    "origin": "FORM", "status": "NEW", "temperature": null, "event_name": "Fuar 2026"
  },
  "owner": { "name": "Fatma Kaya", "email": "fatma@example.com", "card": "https://atricard.com/fatma-kaya" },
  "company": { "name": "Arkın Studio" },
  "consent": { "photo": false }
}
```

İşleme sırası:

1. `(atricard, id)` mezar taşındaysa: `200 {"status":"ignored"}`.
2. `(atricard, id)` ile aday zaten varsa: `200 {"status":"duplicate","leadId":…}`.
3. Telefon ya da e-posta anahtarıyla başka bir aday eşleşirse yeni kayıt açılmaz: `200 duplicate`. **Eşleşen mevcut adaya Atricard kimliği bağlanmaz** (başka kaynaktan gelmiş olabilir, sonradan gelen bir `lead.deleted` onu silmemeli).
4. Aksi halde aday oluşur: `201`.

Alan eşlemesi: `lead.company` yoksa `lead.name` aday adı olur; `lead.name` yetkili kişi olur. `temperature` puanı belirler (HOT 80, WARM 50, COLD 20; yoksa alan doluluğundan hesaplanır). `owner.email` kiracının etkin bir kullanıcısıyla eşleşirse aday ona atanır, değilse sahipsiz kalır. Selfie ve cihaz bilgisi gönderilse de **saklanmaz**. Bilinmeyen alanlar yok sayılır.

`id` Atricard'daki lead kimliğidir ve idempotency anahtarıdır: aynı `id` iki kez gelse de ikinci kayıt açılmaz. Aynı `X-Atricard-Delivery` ikinci kez gelirse yeniden işlenmez.

Aday sınırı (`max_leads`) doluysa yeni aday açılmaz ve `200 {"status":"ignored","reason":"lead_limit"}` döner (gönderici boşuna tekrar denemesin); olay "Gelen olaylar" listesinde `lead_limit` notuyla görünür.

### `lead.deleted` (v1)

```json
{ "event": "lead.deleted", "version": 1, "id": "<lead uuid>", "occurred_at": "…", "reason": "erasure_request" }
```

`reason`: `erasure_request` (kaydımı sil), `owner_deleted`, `account_removed`. Kişisel veri taşımaz.

- Aday bulunamazsa yalnız **mezar taşı** yazılır, `200`.
- Adayın fırsatı **yoksa** aday (bağlı kişi, aktivite ve notlarla) kalıcı silinir.
- Fırsatı **varsa** silme yerine **anonimleştirilir**: ad "Silinen kayıt" olur; yetkili, telefon, e-posta, web sitesi, şehir, mesaj, not, fuar adı temizlenir; fırsat başlığı, teklif başlığı/notu ve aktivite metinleri de temizlenir. Fırsat ve teklif geçmişi (tutarlar) kalır.
- Her iki durumda mezar taşı yazılır.

**Sıra güvenliği (KVKK):** silinen bir kişi, geç gelen bir `lead.created` ile yeniden doğmaz; mezar taşındaki kimlik `200 ignored` alır.

Bilinmeyen olay tipi `200 {"status":"ignored"}` döner, böylece Atricard ileride yeni olay eklediğinde eski alıcı kırılmaz.

Her teslim "Gelen olaylar" listesine yazılır (30 gün saklanır). İmzası geçersiz istekler de `Reddedildi` olarak görünür.

## 3. Giden: AtriCRM → müşterinin sistemi

Entegrasyonlar sayfasında "Yeni giden webhook": ad, `https` adresi, olaylar, onay kutusu. En çok 5 giden webhook eklenebilir.

**Onay:** bağlantı açılırken yönetici, kişi bilgilerinin seçtiği alıcıya gideceğini onaylar; zamanı kaydedilir. Alıcı adresi değiştirilirse onay geçersiz olur, bağlantı kapanır ve yeniden onay gerekir.

### Olaylar

| Olay | Ne zaman |
|---|---|
| `lead.created` | Aday oluşunca (form, CSV, Atricard, elle) |
| `lead.updated` | Aday güncellenince (alan, durum, sıcaklık, sahip, dönüşüm) |
| `lead.deleted` | Aday silinince ya da anonimleşince |
| `deal.stage_changed` | Fırsat aşaması değişince |
| `deal.won` | Fırsat kazanıldı aşamasına geçince (ayrıca `stage_changed`) |
| `deal.lost` | Fırsat kaybedildi aşamasına geçince (ayrıca `stage_changed`) |

CSV içe aktarma her aday için `lead.created` üretir. Agno CRM taşıma betiği olay **üretmez** (toplu taşıma bir olay yağmuru yaratmasın).

### İstek

`POST`, `Content-Type: application/json; charset=utf-8`, `User-Agent: AtriCRM-Webhooks/1`. Zaman aşımı 8 saniye. **Yönlendirmeler izlenmez** (3xx başarısızdır).

| Başlık | Anlam |
|---|---|
| `X-AtriCRM-Event` | Olay adı |
| `X-AtriCRM-Delivery` | Teslim kimliği (uuid), tekrar denemelerde aynı |
| `X-AtriCRM-Timestamp` | Unix saniyesi |
| `X-AtriCRM-Signature` | `sha256=<hex>` |

### Yükler (v1)

`lead.created` / `lead.updated`:

```json
{
  "event": "lead.created", "version": 1, "id": "<aday uuid>", "occurred_at": "2026-10-04T10:15:00.000Z",
  "lead": {
    "name": "Mavi Tur", "contact_name": "Deniz Yılmaz", "phone": "+905320000000", "email": "d@example.com",
    "website": null, "city": "Ankara", "sector": null, "message": "…", "service": "Web sitesi",
    "origin": "atricard", "status": "new", "temperature": "hot", "score": 80,
    "event_name": "Fuar 2026", "estimated_value": "1500.00", "follow_up_at": null,
    "created_at": "2026-10-04T10:15:00.000Z"
  },
  "owner": { "name": "Fatma Kaya", "email": "fatma@example.com" }
}
```

Satışçının iç notu (`note`) hiçbir yükte yoktur.

`lead.deleted`:

```json
{ "event": "lead.deleted", "version": 1, "id": "<aday uuid>", "occurred_at": "…", "reason": "owner_deleted" }
```

`deal.*`:

```json
{
  "event": "deal.won", "version": 1, "id": "<fırsat uuid>", "occurred_at": "…",
  "deal": {
    "title": "Mavi Tur: Web sitesi", "value": "5000.00", "currency": "TRY",
    "stage": { "label": "Kazanıldı", "kind": "won" }, "previous_stage": { "label": "Teklif", "kind": "open" },
    "lost_reason": null, "expected_close_at": null, "closed_at": "2026-10-20T09:00:00.000Z"
  },
  "lead_id": "<aday uuid ya da null>", "company": { "name": "Mavi Tur" }, "owner": null
}
```

"Test gönder" örnek bir `lead.created` gönderir; yükte `"test": true` vardır ve gerçek kişi verisi içermez.

### Tekrar deneme

Yalnız `2xx` başarıdır. `4xx` dahil diğer her yanıt ve ağ hatası tekrar denenir (alıcı geçici olarak yanlış yapılandırılmış olabilir). En çok **6 deneme** (ilk + 5 tekrar):

| Deneme | Başarısızsa sonraki deneme |
|---|---|
| 1 | 1 dakika sonra |
| 2 | 5 dakika sonra |
| 3 | 30 dakika sonra |
| 4 | 2 saat sonra |
| 5 | 12 saat sonra |
| 6 | Teslim `Başarısız` olur |

- Başarıda "art arda başarısız" sayacı sıfırlanır. Bir teslim `Başarısız` olunca sayaç artar; **art arda 20 başarısız teslimde bağlantı kapanır** ve kiracı sahip/yöneticilerine e-posta gider. Sayfada kırmızı uyarı görünür.
- Başarısız teslim "Yeniden gönder" ile elle tekrar gönderilebilir (deneme sayacı sıfırlanır, teslim kimliği aynı kalır).
- Teslim kayıtları 30 gün sonra silinir (yükte kişisel veri vardır).

### Alıcının yapması gerekenler

1. İmzayı **ham gövde** üzerinden doğrulayın, zaman damgasını denetleyin.
2. **Idempotent** olun: aynı teslim (aynı `X-AtriCRM-Delivery`) birden fazla gelebilir. `id` ve olay türüyle de tekilleştirebilirsiniz.
3. Hızlı yanıt verin (8 saniye): işi kuyruğa alıp `2xx` dönün.
4. **Silme olayını işleyin:** `lead.deleted` geldiğinde o kimliğe ait kişisel veriyi silin ve kimliği kaydedin. **Silinmiş bir kimlik için sonradan gelen `lead.created` / `lead.updated` olaylarını yok sayın.** Sıra garantisi yoktur: özellikle yeniden denemelerde silme olayı, aynı adayın daha önce başlamış bir `created` teslimini geçebilir.
5. Gönderilen yük şemasına yeni alanlar eklenebilir (`version` aynı kalır); bilinmeyen alanları yok sayın.

### İmza doğrulama örnekleri

Node.js (Express, ham gövde ile):

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.ATRICRM_WEBHOOK_SECRET; // whsec_...
const app = express();

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const timestamp = req.get("X-AtriCRM-Timestamp") ?? "";
  const signature = req.get("X-AtriCRM-Signature") ?? "";
  const raw = req.body.toString("utf8"); // ham gövde, ayrıştırılmamış

  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return res.status(401).send("eski zaman damgası");
  }
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send("imza geçersiz");

  const event = JSON.parse(raw);
  // idempotency: req.get("X-AtriCRM-Delivery") daha önce işlendiyse 200 dönüp çık
  res.sendStatus(200);
});
```

Python (Flask):

```python
import hashlib, hmac, os, time
from flask import Flask, request, abort

SECRET = os.environ["ATRICRM_WEBHOOK_SECRET"].encode()
app = Flask(__name__)

@app.post("/webhook")
def webhook():
    timestamp = request.headers.get("X-AtriCRM-Timestamp", "")
    signature = request.headers.get("X-AtriCRM-Signature", "")
    raw = request.get_data()  # ham bayt, request.json KULLANMAYIN

    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300:
        abort(401)
    expected = "sha256=" + hmac.new(SECRET, timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        abort(401)

    event = request.get_json(force=True)
    # idempotency: request.headers["X-AtriCRM-Delivery"] daha önce işlendiyse 200 dön
    return "", 200
```

Aynı kodu Atricard webhook'unu karşılayan bir alıcı için kullanırsanız başlık adları `X-Atricard-*` olur.

### Adres (SSRF) kuralları

Alıcı adresi iç ağa istek göndermek için kullanılamaz. Kayıtta **ve** her bağlantıda denetlenir:

- Yalnız `https`. Kullanıcı adı/parola içeren adres yok.
- Engellenen adlar: `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.localdomain`, `*.home.arpa`, noktasız adlar (`sunucu`).
- Engellenen IP'ler (literal olarak yazılsa da, DNS ile çözülse de): `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (bulut metadata dahil), `172.16.0.0/12`, `192.168.0.0/16`, test/ayrılmış ve multicast aralıkları; IPv6'da yalnız küresel tekil yayın (`2000::/3`) kabul edilir, `::1`, `fc00::/7`, `fe80::/10`, **IPv4'e eşlenmiş adresler** (`::ffff:127.0.0.1`) IPv4 kurallarına göre değerlendirilir.
- Ondalık/sekizlik/onaltılık IP yazımları (`2130706433`, `0177.0.0.1`, `0x7f.1`) tarayıcı kuralıyla noktalı onluğa çevrilip denetlenir.
- Bağlantı anında DNS'in döndürdüğü **tüm** adresler denetlenir (biri bile engelliyse reddedilir) ve bağlantı doğrulanan o IP'ye kurulur; çözüm ile bağlantı arasında ikinci bir DNS sorgusu yoktur, DNS rebinding işe yaramaz.
- Adres sonradan iç ağa çevrilirse bağlantı `ssrf` nedeniyle kapanır.

## 4. Okuma API'si

Entegrasyonlar sayfasından API anahtarı oluşturun (biçim `atc_<önek>_<gizli>`, yalnız bir kez gösterilir, en çok 10 anahtar). Yalnız okuma, kapsam `leads:read`.

```
GET /api/v1/leads?limit=50&page=1&status=new&source=atricard
GET /api/v1/leads/<id>
Authorization: Bearer atc_xxxxxxxx_...
```

- `limit` 1 ile 100 arası (varsayılan 50), `page` 1'den başlar. Geçersiz sayı varsayılana düşer; geçersiz `status`/`source` `400` döner.
- Yanıt: `{ "data": [ … ], "total": 123, "page": 1, "page_size": 50 }`. Alanlar giden webhook'taki `lead` alanlarıyla aynıdır, ek olarak `id`, `owner` ve `updated_at`. İç not (`note`) yoktur.
- Anahtar yok/yanlış/iptal: hepsi aynı `401`. Lisans ya da yetenek kapalı: `403`. Hız sınırı: IP başına dakikada 120 (`429`).
- Anahtar yalnız kendi kiracısının verisini döndürür. Oturum çerezi API'yi açmaz.

## 5. İşleyiş (teknik)

- Olaylar, değişikliği yapan **aynı transaction** içinde `crm_webhook_deliveries` tablosuna yazılır (olay kutusu). Değişiklik geri alınırsa olay da gitmez.
- Worker (`npm run worker`): süpürücü 5 saniyede bir vakti gelen teslimleri BullMQ `webhooks` kuyruğuna alır; işleyici teslimi dener, başarısızsa bekleme süresi kadar **gecikmeli iş** ekler. Gerçeğin kaynağı veritabanıdır; gecikmeli iş kaybolsa bile süpürücü teslimi vakti gelince bulur.
- **Çift işleme:** teslim, tek atomik `UPDATE` ile "kiralanır" (2 dakika). Aynı teslimi iki işçi ya da hem süpürücü hem gecikmeli iş tetiklese de yalnız biri gönderir; işçi çökerse kira dolunca teslim yeniden alınır.
- Her denemeden önce lisans/yetenek ve adres kuralları yeniden denetlenir. Plan düşerse bağlantı `plan_not_allowed` ile kapanır ve teslimler bekler.
- Günlük özet e-postası ve temizlik de worker'dadır: görev özeti her gün 08:00'dan sonra (İstanbul), 30 günden eski teslim/gelen olay kayıtları 6 saatte bir silinir.

### Ortam değişkenleri

| Değişken | Zorunlu | Açıklama |
|---|---|---|
| `INTEGRATION_SECRET_KEY` | Evet | En az 32 karakter. Gizli anahtarları şifreleyen ana anahtar. Üretim: `openssl rand -base64 48`. Uygulama ve worker aynı değeri görmeli |
| `APP_URL` | Evet | Entegrasyonlar sayfasında gösterilen adresin kökü |
| `REDIS_URL` | Evet | BullMQ ve hız sınırı |
| `WEBHOOK_RETRY_SCALE` | Hayır | Yalnız test: tekrar deneme beklemelerini çarpar (örn. `0.001`). Üretimde tanımlamayın |

### Elle uçtan uca doğrulama

`scripts/verify-webhook-e2e.ts`, gerçek DNS ve TLS ile herkese açık bir echo hizmetine (httpbin.org) teslim ederek tüm hattı sınar: olay kutusu, süpürücü, BullMQ, işçi, güvenli istemci, imza.

```
DATABASE_URL=… DATABASE_ADMIN_URL=… INTEGRATION_SECRET_KEY=… npx tsx scripts/verify-webhook-e2e.ts
```
