# Operasyon Modülü — Çekirdek Varlıklar ve 1. Dalga

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** aycanops'un en yoğun kullanılan modülünü (32.668 araç gelişi, 3.730 yolcu) platforma taşımak; öncesinde operasyonun dayandığı ortak ana veriyi (firma, araç, sürücü) kurmak.

**Architecture:** Ortak ana veri `src/db/schema/core.ts`'te tek yerde durur; `filo`, `crm`, `operasyon` ve ileride `muhasebe` aynı tablolara bakar. Her tablo `tenant_id` taşır, `db:sync` RLS'i otomatik uygular. Sayfalar mevcut `(app)` kabuğuna girer; modül kaydı `MODULE_REGISTRY` üzerinden, izinler `PERMISSION_CATALOG` üzerinden.

**Tech Stack:** Next 16 App Router + Server Actions · Drizzle + Postgres 16 + RLS · Tailwind v4 · Vitest + Playwright

## Global Constraints

- Her yeni tabloda `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
- Şema değişikliğinden sonra `npm run db:sync` ve `npm run db:sync:test` — "0 korumasız tablo" görmeden devam yok.
- Rol/izin asla çerezden okunmaz; her istekte DB'den çözülür (aycanops'un `opsdesk_role` hatası tekrarlanmayacak).
- Yazılan her server action'ın çalışan bir UI'ı olacak.
- Firma kapsamı (`user_scopes`) olan kullanıcı yalnız kendi firmalarının kaydını görür.
- Sektör farkı koda gömülmez: terim `terminology`, ek alan `entity_fields`, alt özellik `capabilities` üzerinden.

---

### Task 1: Ortak ana veri şeması
**Files:** Create `src/db/schema/core.ts`; Modify `src/db/schema/index.ts`, `src/db/schema/auth.ts` (userScopes FK)
`companies` (kod, ünvan, vergi no/dairesi, telefon, e-posta, adres, tip, aktif), `vehicles` (plaka, marka, model, yıl, kapasite, tip, firma, durum), `drivers` (ad, telefon, TC, ehliyet sınıfı/bitiş, firma, durum). Plaka kiracı içinde tekil.
**Test:** `tests/core-schema.test.ts` — kiracı izolasyonu + plaka tekilliği.

### Task 2: Firmalar (crm modülü iskeleti)
`src/modules/crm/{queries,actions,validators}.ts` + `/crm/firmalar`. Arama + aktif/pasif filtre + ekle/düzenle/sil. Kapsamlı kullanıcı yalnız kendi firmalarını görür.

### Task 3: Araçlar (filo modülü iskeleti)
`src/modules/filo/*` + `/filo/araclar`. Firma filtresi, plaka araması, kapasite. Sürücüler `/filo/suruculer`.

### Task 4: Operasyon modülü kaydı
`operasyon` anahtarı `keys.ts` + `registry.ts` + 4 sektör paketi (turizm, lojistik). İzinler: `giris_kontrol:*`, `yolcular:*`, `ziyaretci:*`, `gunluk:*`. `/operasyon` özet sayfası.

### Task 5: Yolcular
`passengers` şeması (tip: yolcu/personel/müşteri, sınıf, şube, barkod, hizmet durumu, biniş/iniş adresi). CRUD + arama + firma/tip/durum filtresi + sayfalama.

### Task 6: Giriş kontrol
`vehicle_arrivals` (firma, araç, tarih, vardiya, geliş saati, konum, not; araç+tarih+vardiya tekil). Bugünün listesi + tarih navigasyonu + firma filtresi + hızlı kayıt + gecikme rozeti.

### Task 7: Ziyaretçi kayıt
`visitor_logs` (ziyaretçi, sebep, kime, giriş, çıkış). İçerideler üstte, "Çıkış Ver" tek tık.

### Task 8: Günlük check-in
`daily_questions` + `daily_answers`. Soru tipleri: evet_hayir, metin, uzun_metin, secim, checklist. Yönetici soru tanımlar, personel günlük doldurur, aynı gün ikinci kayıt engellenir.

### Task 9: İçe aktarım hedefleri + raporlar
`IMPORT_TARGETS`: firmalar, araclar, yolcular. `REPORT_CATALOG`: gunluk_gelisler, yolcu_listesi, arac_listesi.

### Task 10: E2E
`tests/e2e/operasyon.spec.ts` — turizm kiracısı operasyonu görür, pilates görmez; yolcu ekleme; geliş kaydı; kapsamlı kullanıcı yalnız kendi firmasını görür.
