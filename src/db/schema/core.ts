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
    /** Ruhsat sahibi — araç işletenden farklı olabilir. */
    titleHolder: varchar("title_holder", { length: 200 }),
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

/**
 * Araç birden çok firmaya hizmet edebilir. `vehicles.company_id` aracın
 * bağlı olduğu ana firma; bu tablo ek atamaları tutar.
 */
export const vehicleCompanies = pgTable(
  "vehicle_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_companies_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("vehicle_companies_uniq").on(t.vehicleId, t.companyId),
  }),
);

/** Sürücü belgesi — ehliyet, SRC, psikoteknik, sağlık raporu. */
export const driverDocuments = pgTable(
  "driver_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    docType: varchar("doc_type", { length: 50 }).notNull(),
    label: varchar("label", { length: 200 }),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    fileUrl: text("file_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("driver_documents_tenant_idx").on(t.tenantId),
    expiryIdx: index("driver_documents_expiry_idx").on(t.tenantId, t.expiresOn),
  }),
);

export type VehicleCompany = typeof vehicleCompanies.$inferSelect;
export type DriverDocument = typeof driverDocuments.$inferSelect;

/**
 * Yüklenen dosya. İçerik diskte (Docker birimi), meta veri burada.
 * Dosyalar doğrudan servis edilmez; `/api/dosya/[id]` kiracı ve izin
 * kontrolünden geçirir — yol tahmin edilerek başkasının dosyası okunamaz.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Diskteki göreli yol — kiracı klasörü altında. */
    storagePath: text("storage_path").notNull(),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Hangi kayda ait: "inspection", "vehicle_document"… */
    entityType: varchar("entity_type", { length: 50 }),
    entityId: uuid("entity_id"),
    /** Denetimde hangi kritere ait; genel fotoğraflarda boş. */
    slot: varchar("slot", { length: 50 }),
    uploadedBy: uuid("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("files_tenant_idx").on(t.tenantId),
    entityIdx: index("files_entity_idx").on(t.entityType, t.entityId),
  }),
);

export type StoredFile = typeof files.$inferSelect;
