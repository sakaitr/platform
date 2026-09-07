import { boolean, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Kiracı bazlı rol tanımı. Sektör paketi varsayılanları kurar, kiracı üzerine ekler. */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    /** 0 = en dar, 3 = en geniş. Kullanıcı kendinden yüksek role atama yapamaz. */
    hierarchyLevel: integer("hierarchy_level").notNull().default(0),
    /** Sistem rolü silinemez/yeniden adlandırılamaz. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("roles_tenant_key_uniq").on(t.tenantId, t.key),
    tenantIdx: index("roles_tenant_idx").on(t.tenantId),
  }),
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("role_permissions_uniq").on(t.roleId, t.permissionKey),
    tenantIdx: index("role_permissions_tenant_idx").on(t.tenantId),
  }),
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
