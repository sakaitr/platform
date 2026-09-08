import type { TenantAccess } from "@/lib/licensing";

export type ModuleNavChild = { label: string; href: string; capability?: string };

export type ModuleDefinition = {
  key: string;
  label: string;
  /** lucide-react ikon adı */
  icon: string;
  href: string;
  permission: string;
  /** Bu modül çalışmak için başka modüle muhtaçsa — örn. muhasebe → filo (araç verisi) */
  dependsOn?: readonly string[];
  /** Modül içinde sektöre göre açılıp kapanan alt-yetenekler */
  capabilities?: readonly string[];
  children?: readonly ModuleNavChild[];
};

/** Platformdaki tüm modüllerin tek doğruluk kaynağı. */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    href: "/dashboard",
    permission: "dashboard:read",
  },
  {
    key: "operasyon",
    label: "Operasyon",
    icon: "Route",
    href: "/operasyon",
    permission: "arrivals:read",
    capabilities: ["operasyon.cetele", "operasyon.rota_planlama", "operasyon.transfer"],
    children: [
      { label: "Giriş Kontrol", href: "/operasyon/giris-kontrol" },
      { label: "Vardiyalar", href: "/operasyon/vardiyalar" },
      { label: "Güzergahlar", href: "/operasyon/guzergahlar" },
      { label: "Açık Güzergahlar", href: "/operasyon/acik-guzergahlar" },
      { label: "Rota Planlama", href: "/operasyon/rota-planlama", capability: "operasyon.rota_planlama" },
      { label: "Harita", href: "/operasyon/harita", capability: "operasyon.rota_planlama" },
      { label: "Çetele", href: "/operasyon/cetele", capability: "operasyon.cetele" },
      { label: "Transferler", href: "/operasyon/transferler", capability: "operasyon.transfer" },
      { label: "Yolcular", href: "/operasyon/yolcular" },
      { label: "Ziyaretçiler", href: "/operasyon/ziyaretciler" },
      { label: "Günlük", href: "/operasyon/gunluk" },
    ],
  },
  {
    key: "crm",
    label: "CRM",
    icon: "Building2",
    href: "/crm/firmalar",
    permission: "firmalar:read",
    children: [{ label: "Firmalar", href: "/crm/firmalar" }],
  },
  {
    key: "gorevler",
    label: "Görevler",
    icon: "ListChecks",
    href: "/gorevler",
    permission: "gorevler:read",
    children: [
      { label: "Görevler", href: "/gorevler" },
      { label: "Duyurular", href: "/duyurular" },
      { label: "Rehber", href: "/rehber" },
      { label: "Kara Liste", href: "/rehber/kara-liste" },
    ],
  },
  {
    key: "destek",
    label: "Destek",
    icon: "LifeBuoy",
    href: "/destek",
    permission: "sorunlar:read",
    children: [
      { label: "Talepler", href: "/destek" },
      { label: "Öneri / Şikâyet", href: "/oneriler" },
    ],
  },
  {
    key: "ik",
    label: "İnsan Kaynakları",
    icon: "Users",
    href: "/izinler",
    permission: "dashboard:read",
    children: [{ label: "İzinler", href: "/izinler" }],
  },
  {
    key: "raporlar",
    label: "Raporlar",
    icon: "FileBarChart",
    href: "/raporlar",
    permission: "raporlar:read",
  },
  {
    key: "muhasebe",
    label: "Muhasebe",
    icon: "Calculator",
    permission: "finans_gider:read",
    capabilities: ["muhasebe.irsaliye", "muhasebe.hakedis", "muhasebe.mutabakat"],
    href: "/muhasebe/hareketler",
    children: [
      { label: "Gelir / Gider", href: "/muhasebe/hareketler" },
      { label: "Kategoriler", href: "/muhasebe/kategoriler" },
      { label: "Cari", href: "/muhasebe/cari" },
      { label: "İrsaliyeler", href: "/muhasebe/irsaliyeler", capability: "muhasebe.irsaliye" },
      { label: "Kâr / Zarar", href: "/muhasebe/kar-zarar" },
      { label: "Bütçe", href: "/muhasebe/butce" },
      { label: "İşletenler", href: "/muhasebe/isletenler", capability: "muhasebe.hakedis" },
      { label: "Ücretlendirme", href: "/muhasebe/ucretlendirme", capability: "muhasebe.hakedis" },
      { label: "Güzergah Fiyatları", href: "/muhasebe/guzergah-fiyatlari", capability: "muhasebe.hakedis" },
      { label: "Hakedişler", href: "/muhasebe/hakedis", capability: "muhasebe.hakedis" },
      { label: "Mutabakat", href: "/muhasebe/mutabakat", capability: "muhasebe.mutabakat" },
    ],
  },
  {
    key: "filo",
    label: "Filo",
    icon: "Truck",
    href: "/filo/araclar",
    permission: "araclar:read",
    children: [
      { label: "Araçlar", href: "/filo/araclar" },
      { label: "Sürücüler", href: "/filo/suruculer" },
      { label: "Bakımlar", href: "/filo/bakim" },
      { label: "Belgeler", href: "/filo/belgeler" },
      { label: "Denetimler", href: "/filo/denetimler" },
      { label: "Kazalar", href: "/filo/kazalar" },
      { label: "Cezalar", href: "/filo/cezalar" },
      { label: "Arızalar", href: "/filo/arizalar" },
      { label: "Sigortalar", href: "/filo/sigortalar" },
      { label: "Lastikler", href: "/filo/lastikler" },
      { label: "Yakıt Kartları", href: "/filo/yakit-kartlari" },
      { label: "Yakıt Dolumları", href: "/filo/yakit" },
      { label: "Uyarılar", href: "/filo/uyarilar" },
      { label: "Sürücü Sicili", href: "/filo/sicil" },
      { label: "Değerlendirme", href: "/filo/degerlendirme" },
    ],
  },
  {
    key: "admin",
    label: "Yönetim",
    icon: "Settings",
    href: "/admin",
    permission: "users:read",
    children: [
      { label: "Kullanıcılar", href: "/admin/users" },
      { label: "Modüller", href: "/admin/moduller" },
      { label: "Denetim İzi", href: "/admin/denetim" },
      { label: "Roller", href: "/admin/roller" },
      { label: "Firma Kapsamı", href: "/admin/kapsam" },
      { label: "Terimler", href: "/admin/terminoloji" },
      { label: "Özel Alanlar", href: "/admin/alanlar" },
      { label: "Veri Aktarımı", href: "/veri-aktarim" },
      { label: "Portal Kullanıcıları", href: "/admin/portal" },
    ],
  },
];

export function getModule(key: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((m) => m.key === key);
}

/** Hem lisans hem izin süzgecinden geçen modüller. */
/** Hem lisans hem izin süzgecinden geçen modüller. */
export function buildNavigation(
  access: TenantAccess & { permissions: Set<string> },
): ModuleDefinition[] {
  return MODULE_REGISTRY.filter((module) => {
    if (!access.permissions.has(module.permission)) return false;
    if (module.key === "dashboard") return true;
    return access.modules.get(module.key)?.allowed === true;
  });
}

/** Alt menüden, kapalı alt-yeteneklere ait olanları eler. */
export function visibleChildren(
  module: ModuleDefinition,
  access: TenantAccess,
): ModuleNavChild[] {
  return (module.children ?? []).filter(
    (child) => !child.capability || access.capabilities.has(child.capability),
  );
}
