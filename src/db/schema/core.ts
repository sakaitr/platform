import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/**
 * Ortak ana veri. Birden çok modül aynı tabloya bakar:
 * firma → crm + operasyon + muhasebe, araç → filo + operasyon + muhasebe.
 * Sektöre göre adı değişir (Firma / Müşteri / Üye) — bu terminology katmanının işi,
 * tablo adı sabit kalır.
 */

export const companyTypeEnum = pgEnum("company_type", ["musteri", "tedarikci", "isleten", "diger"]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 30 }),
    name: varchar("name", { length: 255 }).notNull(),
    type: companyTypeEnum("type").notNull().default("musteri"),
    taxNumber: varchar("tax_number", { length: 20 }),
    taxOffice: varchar("tax_office", { length: 120 }),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 255 }),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("companies_tenant_idx").on(t.tenantId),
    nameIdx: index("companies_name_idx").on(t.tenantId, t.name),
  }),
);

export const vehicleStatusEnum = pgEnum("vehicle_status", ["aktif", "bakimda", "pasif"]);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Aracı işleten/kiralayan firma. Boş = kiracının kendi aracı. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    plate: varchar("plate", { length: 20 }).notNull(),
    brand: varchar("brand", { length: 80 }),
    model: varchar("model", { length: 80 }),
    modelYear: integer("model_year"),
    /** Koltuk kapasitesi — güzergah atamasında kullanılır. */
    capacity: integer("capacity"),
    vehicleType: varchar("vehicle_type", { length: 40 }),
    status: vehicleStatusEnum("status").notNull().default("aktif"),
    /** Giriş kontrol tahtasındaki sıra — kapıdaki görevlinin beklediği düzen. */
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicles_tenant_idx").on(t.tenantId),
    plateUniq: uniqueIndex("vehicles_tenant_plate_uniq").on(t.tenantId, t.plate),
    companyIdx: index("vehicles_company_idx").on(t.companyId),
  }),
);

export const driverStatusEnum = pgEnum("driver_status", ["aktif", "izinli", "pasif"]);

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    idNumber: varchar("id_number", { length: 20 }),
    licenseClass: varchar("license_class", { length: 20 }),
    licenseExpiry: date("license_expiry"),
    status: driverStatusEnum("status").notNull().default("aktif"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("drivers_tenant_idx").on(t.tenantId),
    nameIdx: index("drivers_name_idx").on(t.tenantId, t.fullName),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
