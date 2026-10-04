/**
 * İzin kataloğu — `kaynak:eylem` deseni.
 *
 * aycanops'ta 330 izin anahtarı vardı; buraya modül portları sırasında eklenir.
 * Roller VERİTABANINDA (kiracı bazlı) tutulur; bu dosya sadece hangi
 * anahtarların var olabileceğini tanımlar.
 */

const READ_WRITE = ["read", "create", "update", "delete"] as const;
const READ_ONLY = ["read"] as const;

export const PERMISSION_CATALOG: Record<string, readonly string[]> = {
  // Çekirdek
  dashboard: READ_ONLY,
  users: [...READ_WRITE, "invite"],
  roles: [...READ_WRITE, "assign"],
  scopes: ["read", "assign"],
  settings: ["read", "update"],
  terminology: ["read", "update"],
  fields: [...READ_WRITE],
  audit: ["read", "export"],
  modules: ["read", "assign"],

  // Operasyon (Plan 4)
  arrivals: [...READ_WRITE, "bulk", "export"],
  gunluk: [...READ_WRITE, "approve"],
  guzergahlar: [...READ_WRITE, "assign"],
  rota_planlama: [...READ_WRITE, "publish"],
  transferler: [...READ_WRITE],
  yolcular: [...READ_WRITE, "import", "export"],
  ziyaretci: [...READ_WRITE],
  cetele: [...READ_WRITE, "approve", "bulk"],

  // Filo (Plan 5)
  araclar: [...READ_WRITE, "import", "export"],
  bakim: [...READ_WRITE],
  belgeler: [...READ_WRITE],
  denetimler: [...READ_WRITE, "approve"],
  suruculer: [...READ_WRITE, "import"],
  filo_kaza: [...READ_WRITE],
  filo_ceza: [...READ_WRITE],
  filo_ariza: [...READ_WRITE],
  filo_sigorta: [...READ_WRITE],
  filo_lastik: [...READ_WRITE],
  yakit_kartlari: [...READ_WRITE],

  // Muhasebe (Plan 6)
  finans_gider: [...READ_WRITE, "approve"],
  finans_hareket: [...READ_WRITE],
  isletenler: [...READ_WRITE],
  cari: ["read", "create"],
  hakedis: [...READ_WRITE, "approve"],
  mutabakat: [...READ_WRITE, "approve"],
  kar_zarar: READ_ONLY,
  butce: [...READ_WRITE],

  // CRM / portal (Plan 7)
  firmalar: [...READ_WRITE],
  musteriler: [...READ_WRITE],
  portal: ["read", "manage"],

  // Görev / ticket (Plan 8)
  gorevler: [...READ_WRITE, "assign"],
  sorunlar: [...READ_WRITE, "assign"],
  notlar: [...READ_WRITE],
  oneriler: [...READ_WRITE],

  // Raporlar (Plan 3)
  raporlar: ["read", "export"],
  imports: ["read", "create", "execute", "rollback"],
};

export const ALL_PERMISSIONS: readonly string[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([resource, actions]) => actions.map((action) => `${resource}:${action}`),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

export function isValidPermission(key: string): boolean {
  return PERMISSION_SET.has(key);
}

export function permissionsFor(resource: string): string[] {
  const actions = PERMISSION_CATALOG[resource];
  return actions ? actions.map((a) => `${resource}:${a}`) : [];
}
