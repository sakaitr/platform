# Agno CRM verisini AtriCRM'e taşıma

Betik: `scripts/import-agno-crm.ts`. Agno CRM'in kapatılması **ayrı bir karardır**; bu betik kaynağa bağlanmaz, hiçbir şeyi silmez ya da kesmez.

## Nasıl çalışır

1. Agno CRM'den bir **JSON dışa aktarım dosyası** alınır (`agno-crm-export`, sürüm 1; biçim aşağıda).
2. Betik dosyayı okur ve **Agno'nun kendi kiracısına** yazar. Kaynak veritabanı (MySQL) ile doğrudan konuşmaz: böylece salt okur kalır ve Agno CRM şemasından bağımsızdır.
3. Varsayılan **DENEME**'dir: her şey gerçek veritabanına karşı bir transaction içinde çalıştırılır (yinelenenler, eşleşmeler dahil) ve geri alınır. Rapor gerçek sonucu gösterir, hiçbir şey yazılmaz. Yazmak için `--apply`.
4. **İdempotenttir:** aynı dosya ikinci kez içe aktarılınca yeni kayıt açmaz.
5. Giden webhook olayı **üretmez** (toplu taşıma olay yağmuru yaratmasın).

```bash
# 0) Agno kiracısı yoksa kur (satis_crm paketi): önce Agno CRM'deki kullanıcıların e-postalarıyla kullanıcılar eklenmeli
npx tsx scripts/provision.ts --name "Agno" --slug agno --pack satis_crm --email kayra@agno.digital --password '<güçlü-parola>'

# 1) Deneme (varsayılan): ne olacağını gösterir, yazmaz
npx tsx scripts/import-agno-crm.ts --file agno-export.json --tenant agno --report deneme-raporu.json

# 2) Rapora bakın, sonra gerçekten yazın
npx tsx scripts/import-agno-crm.ts --file agno-export.json --tenant agno --apply --report rapor.json

# 3) (isteğe bağlı) Kiracının aday sınırı varsa: --ignore-limit
```

Çıkış kodu: `0` başarılı, `2` raporda hata var (ör. geçersiz satır), `1` betik çalışamadı (kiracı yok, modül kapalı, dosya bozuk).

## Dışa aktarım biçimi (`agno-crm-export` v1)

```json
{
  "format": "agno-crm-export",
  "version": 1,
  "leads": [
    {
      "id": 1, "name": "Mavi Tur", "contactName": "Deniz Yılmaz", "phone": "0532 000 00 00",
      "email": "d@mavitur.com", "website": "mavitur.com", "address": "Çankaya", "city": "Ankara",
      "sector": "Turizm", "note": "…", "source": "ATRICARD", "externalId": "<atricard lead uuid>",
      "interestedService": "Web sitesi", "score": 80, "status": "CONTACTED",
      "ownerEmail": "satis@agno.digital", "followUpAt": null, "createdAt": "2026-03-01T09:00:00Z"
    }
  ],
  "deals": [
    { "id": 10, "leadId": 1, "title": "Mavi Tur: Web", "stage": "Teklif", "value": 5000,
      "lostReason": null, "ownerEmail": "satis@agno.digital", "createdAt": "…", "closedAt": null }
  ],
  "activities": [
    { "id": 100, "leadId": 1, "dealId": null, "type": "CALL", "subject": "İlk görüşme", "note": "…",
      "assigneeEmail": null, "createdAt": "…", "dueAt": null, "doneAt": null }
  ],
  "deletedExternal": [ { "source": "ATRICARD", "externalId": "<silinen atricard lead uuid>" } ]
}
```

- Zorunlu: `format`, `version`, `leads` (ve her adayda `id`, `name`). Diğer her alan isteğe bağlıdır; `id`'ler sayı ya da metin olabilir.
- `deals`, `activities`, `deletedExternal` isteğe bağlıdır. Fırsat ve aktivite, `leadId` ile aday dosyadaki `id`'ye bağlanır.
- **`deletedExternal` önemlidir:** Agno CRM'deki "silinenler" (mezar taşı) tablosu buraya konmalı. Bu kimliklere ait aday, fırsat ve aktiviteler atlanır; böylece silinmiş kişiler yeniden doğmaz (KVKK).
- Üst sınırlar: 200.000 aday, 200.000 fırsat, 500.000 aktivite.

### Agno CRM tarafında dışa aktarma (taslak, UYARLANMALI)

Bu oturumda Agno CRM deposuna erişilemedi; alan adları Atricard görev belgesindeki bilinen alanlara dayanır ve **gerçek Prisma şemasına göre uyarlanmalıdır**. Agno CRM deposunda geçici bir betik olarak çalıştırın:

```ts
// agno-crm: apps/api/scripts/export-for-atricrm.ts (taslak)
import { writeFileSync } from "node:fs";
import { prisma } from "@agno/db";

const leads = await prisma.lead.findMany({ include: { owner: { select: { email: true } } } });
const out = {
  format: "agno-crm-export",
  version: 1,
  leads: leads.map((l) => ({
    id: l.id, name: l.name, contactName: l.contactName, phone: l.phone, email: l.email,
    website: l.website, address: l.address, note: l.note, source: l.source, externalId: l.externalId,
    interestedService: l.interestedService, score: l.score, createdAt: l.createdAt.toISOString(),
    ownerEmail: l.owner?.email ?? null,
  })),
  // deals / activities: aynı biçimde; silinenler tablosu: prisma.deletedExternalLead.findMany()
  deletedExternal: (await prisma.deletedExternalLead.findMany()).map((d) => ({ source: d.source, externalId: d.externalId })),
};
writeFileSync("agno-export.json", JSON.stringify(out));
```

## Eşleme

### Kaynak

| Agno CRM | AtriCRM |
|---|---|
| `source = ATRICARD` ve `externalId` dolu | `source = atricard`, `externalId` aynen korunur (sonradan gelen `lead.deleted` ve mezar taşı tutarlı kalır) |
| Diğer kaynaklar (Google Maps avcısı, elle, web formu…) | `source = api`, `externalId = agno:<id>`. Özgün kaynak adı nota "Agno CRM kaynağı: X" olarak eklenir |

### Durum

Büyük/küçük harf ve Türkçe karakter fark etmez.

| Agno CRM durumu | AtriCRM |
|---|---|
| NEW, Yeni, OPEN | `new` |
| CONTACTED, Arandı, Görüşüldü | `contacted` |
| QUALIFIED, Nitelikli, QUOTED, Teklif | `qualified` |
| LOST, Kaybedildi, Elendi | `disqualified` |
| WON, Kazanıldı, Converted | `converted` (firma kaydı açılmaz) |
| Tanınmayan | `new`, raporda "tanınmayan durumlar" altında sayılır |

### Diğer alanlar

- `name` → aday adı, `contactName` → yetkili, telefon/e-posta/web için tekilleştirme anahtarları yeniden üretilir.
- `score`: 0-100'e sıkıştırılır; yoksa alan doluluğundan hesaplanır.
- `address` nota "Adres: …" olarak eklenir (AtriCRM adayında adres alanı yoktur).
- `ownerEmail` kiracıdaki etkin bir kullanıcıyla (büyük/küçük harf fark etmez) eşleşirse sahip olur; eşleşmeyenler **sahipsiz** aktarılır ve raporda listelenir.
- `createdAt` korunur. Fırsat aşaması ada göre eşlenir; eşleşmezse ilk açık aşamaya konur ("eşleşmeyen aşamalar" raporda). `WON`/`LOST` eş anlamlıları kazanıldı/kaybedildi aşamasına gider; kapalı aşamadaki fırsatın `closedAt` değeri yoksa oluşturma tarihi kullanılır.
- Aktivite türü: CALL/Arama → arama, MEETING/Toplantı → görüşme, EMAIL → e-posta, TASK/Görev → görev, diğerleri not.

### Tekilleştirme

- `(source, externalId)` zaten varsa atlanır ("zaten var").
- Telefon, e-posta, web sitesi ya da ad+şehir kiracıdaki başka bir adayla eşleşirse yeni aday açılmaz ("yinelenen"); o adayın fırsat ve aktiviteleri **eşleşen adaya bağlanır**. Mevcut adaya Agno kimliği bağlanmaz.
- Fırsat: (aday, başlık) aynıysa atlanır. Aktivite: (üst kayıt, konu, oluşturma zamanı) aynıysa atlanır; kaynakta tarih yoksa (üst kayıt, konu) ile eşleşir.

## Eşleme raporu

Betik ekrana yazar, `--report` ile JSON dosyasına da kaydeder: aday/fırsat/aktivite için toplam, oluşturulan, zaten var, yinelenen, mezar taşı, geçersiz sayıları; eşleşmeyen aşamalar; tanınmayan durumlar; eşleşmeyen sahip e-postaları; uyarılar ve ilk 50 hata.

## Sonrası

- Taşıma, Agno CRM'i **kapatmaz**. İki sistem paralel yaşarsa bakım ikiye katlanır; kapatma kararını pilot sonrası verin.
- Sahipsiz kalan adayları Satış CRM, Adaylar listesinde "Sahipsiz" süzgeciyle bulup toplu atayabilirsiniz.
- Atricard'dan gelen adaylar için Atricard webhook'unu önce AtriCRM'e, sonra (gerekirse) Agno CRM'e yönlendirin; ikisini aynı anda açık tutarsanız aynı lead iki sistemde de oluşur.
