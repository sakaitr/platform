import type { UserRole } from "@/db/schema";

/** Çekirdek izinler. İş modülleri `<modul>.read|write|approve` deseniyle ekler. */
export type Permission =
  | "dashboard.read"
  | "users.manage"
  | "settings.manage"
  | "terminology.manage"
  | "fields.manage";

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: ["dashboard.read", "users.manage", "settings.manage", "terminology.manage", "fields.manage"],
  admin: ["dashboard.read", "users.manage", "settings.manage", "terminology.manage", "fields.manage"],
  manager: ["dashboard.read"],
  member: ["dashboard.read"],
  viewer: ["dashboard.read"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
