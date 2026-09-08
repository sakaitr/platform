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
    key: "muhasebe",
    label: "Muhasebe",
    icon: "Calculator",
    href: "/muhasebe",
    permission: "dashboard:read",
    capabilities: ["muhasebe.irsaliye", "muhasebe.hakedis", "muhasebe.mutabakat"],
    children: [
      { label: "Cari", href: "/muhasebe/cari" },
      { label: "Faturalar", href: "/muhasebe/faturalar" },
      { label: "İrsaliyeler", href: "/muhasebe/irsaliyeler", capability: "muhasebe.irsaliye" },
      { label: "Hakedişler", href: "/muhasebe/hakedis", capability: "muhasebe.hakedis" },
    ],
  },
  { key: "filo", label: "Filo", icon: "Truck", href: "/filo", permission: "dashboard:read" },
  {
    key: "admin",
    label: "Yönetim",
    icon: "Settings",
    href: "/admin",
    permission: "users:read",
    children: [
      { label: "Kullanıcılar", href: "/admin/users" },
      { label: "Roller", href: "/admin/roller" },
      { label: "Firma Kapsamı", href: "/admin/kapsam" },
      { label: "Terimler", href: "/admin/terminoloji" },
      { label: "Özel Alanlar", href: "/admin/alanlar" },
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
