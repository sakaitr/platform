import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, drivers, vehicles } from "./core";
import { tenants } from "./tenants";
import { users } from "./auth";

/** Taşınan kişi. Turizm'de Yolcu/Personel, lojistikte Sevkiyat İlgilisi. */
export const passengerTypeEnum = pgEnum("passenger_type", ["yolcu", "personel", "musteri"]);
export const passengerServiceEnum = pgEnum("passenger_service", ["aktif", "pasif", "askida"]);

export const passengers = pgTable(
  "passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    email: varchar("email", { length: 255 }),
    idNumber: varchar("id_number", { length: 30 }),
    type: passengerTypeEnum("type").notNull().default("yolcu"),
    /** Okul taşımacılığında sınıf/şube; diğer sektörlerde boş kalır. */
    grade: varchar("grade", { length: 20 }),
    branch: varchar("branch", { length: 10 }),
    barcode: varchar("barcode", { length: 50 }),
    pickupAddress: text("pickup_address"),
    dropoffAddress: text("dropoff_address"),
    serviceStatus: passengerServiceEnum("service_status").notNull().default("aktif"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("passengers_tenant_idx").on(t.tenantId),
    companyIdx: index("passengers_company_idx").on(t.companyId),
    nameIdx: index("passengers_name_idx").on(t.tenantId, t.fullName),
    barcodeUniq: uniqueIndex("passengers_tenant_barcode_uniq").on(t.tenantId, t.barcode),
  }),
);

/**
 * Araç geliş kaydı — aycanops'un en yoğun kullanılan tablosu (canlıda 32.668 satır).
 * Aynı araç, aynı gün, aynı vardiya için tek kayıt.
 */
export const vehicleArrivals = pgTable(
  "vehicle_arrivals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    /** İstanbul yerel günü, YYYY-MM-DD. */
    arrivalDate: date("arrival_date").notNull(),
    /** Vardiya adı serbest metin — sektöre/müşteriye göre değişir (sabah, akşam, 08-16…). */
    shift: varchar("shift", { length: 100 }).notNull().default("sabah"),
    /** HH:mm — gelişin gerçekleştiği saat. */
    arrivedAt: varchar("arrived_at", { length: 5 }).notNull(),
    /** Planlanan saat; doluysa gecikme hesaplanır. */
    plannedAt: varchar("planned_at", { length: 5 }),
    latitude: varchar("latitude", { length: 30 }),
    longitude: varchar("longitude", { length: 30 }),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_arrivals_tenant_idx").on(t.tenantId),
    dateIdx: index("vehicle_arrivals_date_idx").on(t.tenantId, t.arrivalDate),
    uniq: uniqueIndex("vehicle_arrivals_uniq").on(t.vehicleId, t.arrivalDate, t.shift),
  }),
);

export const visitorLogs = pgTable(
  "visitor_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    visitorName: varchar("visitor_name", { length: 200 }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    /** Ziyaret edilen kişi. */
    hostName: varchar("host_name", { length: 200 }).notNull(),
    plate: varchar("plate", { length: 20 }),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("visitor_logs_tenant_idx").on(t.tenantId),
    openIdx: index("visitor_logs_open_idx").on(t.tenantId, t.exitedAt),
  }),
);

export const questionTypeEnum = pgEnum("question_type", [
  "evet_hayir",
  "metin",
  "uzun_metin",
  "secim",
  "checklist",
]);

/** Günlük check-in soruları — yönetici tanımlar, personel her gün cevaplar. */
export const dailyQuestions = pgTable(
  "daily_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 500 }).notNull(),
    type: questionTypeEnum("type").notNull().default("evet_hayir"),
    /** secim/checklist için seçenekler. */
    options: jsonb("options").notNull().default([]),
    required: boolean("required").notNull().default(true),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("daily_questions_tenant_idx").on(t.tenantId) }),
);

/** Bir kullanıcının bir güne ait check-in'i. Aynı gün ikinci kayıt açılamaz. */
export const dailyEntries = pgTable(
  "daily_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    /** { soruId: cevap } — soru silinse bile cevap geçmişi bozulmaz. */
    answers: jsonb("answers").notNull().default({}),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("daily_entries_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("daily_entries_uniq").on(t.userId, t.entryDate),
  }),
);

export type Passenger = typeof passengers.$inferSelect;
export type VehicleArrival = typeof vehicleArrivals.$inferSelect;
export type VisitorLog = typeof visitorLogs.$inferSelect;
export type DailyQuestion = typeof dailyQuestions.$inferSelect;
export type DailyEntry = typeof dailyEntries.$inferSelect;
