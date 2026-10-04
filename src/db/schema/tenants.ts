import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const licenseStatusEnum = pgEnum("license_status", [
  "trial",
  "active",
  "grace",
  "expired",
  "suspended",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  /** Kurulu sektör paketi anahtarı — örn. "turizm", "lojistik", "pilates". */
  sectorPack: varchar("sector_pack", { length: 50 }).notNull(),
  sectorPackVersion: varchar("sector_pack_version", { length: 20 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planKey: varchar("plan_key", { length: 50 }).notNull().default("standart"),
    status: licenseStatusEnum("status").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    graceDays: numeric("grace_days", { precision: 3, scale: 0 }).notNull().default("7"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("subscriptions_tenant_idx").on(t.tenantId) }),
);

/** Kiracının hangi modülleri kullanabildiği + modül bazlı süre. */
export const tenantModules = pgTable(
  "tenant_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleKey: varchar("module_key", { length: 50 }).notNull(),
    status: licenseStatusEnum("status").notNull().default("active"),
    /** null = aboneliğin dönemine bağlı. Dolu = modüle özel bitiş. */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    limits: jsonb("limits").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("tenant_modules_uniq").on(t.tenantId, t.moduleKey),
    tenantIdx: index("tenant_modules_tenant_idx").on(t.tenantId),
  }),
);

/** Modül içi alt-yetenekler — örn. "muhasebe.irsaliye", "muhasebe.hakedis". */
export const tenantCapabilities = pgTable(
  "tenant_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    capabilityKey: varchar("capability_key", { length: 100 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("tenant_capabilities_uniq").on(t.tenantId, t.capabilityKey),
    tenantIdx: index("tenant_capabilities_tenant_idx").on(t.tenantId),
  }),
);

export type Tenant = typeof tenants.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type TenantModule = typeof tenantModules.$inferSelect;
export type LicenseStatus = (typeof licenseStatusEnum.enumValues)[number];
