/**
 * Modül anahtarları. registry.ts ve licensing.ts birbirine bağımlı olduğu için
 * anahtarlar burada durur — iki taraf da buradan okur, döngü oluşmaz.
 * YENİ MODÜL EKLERKEN: hem buraya hem MODULE_REGISTRY'ye eklenir.
 * tests/licensing.test.ts bu ikisinin senkronunu doğrular.
 */
export const MODULE_KEYS = ["dashboard", "muhasebe", "filo", "admin"] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
