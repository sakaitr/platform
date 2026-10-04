import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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

export const maintenanceStatusEnum = pgEnum("maintenance_status", [
  "planlandi",
  "yapildi",
  "iptal",
]);

/** Bakım kaydı. Sonraki bakım km/tarihi doluysa yaklaşan bakım uyarısı üretir. */
export const vehicleMaintenance = pgTable(
  "vehicle_maintenance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    /** periyodik, ariza, yag, fren… serbest metin — atölye jargonu müşteriye göre değişir. */
    type: varchar("type", { length: 50 }).notNull().default("periyodik"),
    maintenanceDate: date("maintenance_date").notNull(),
    kmAtService: integer("km_at_service"),
    nextServiceKm: integer("next_service_km"),
    nextServiceDate: date("next_service_date"),
    cost: numeric("cost", { precision: 12, scale: 2 }),
    technician: varchar("technician", { length: 255 }),
    status: maintenanceStatusEnum("status").notNull().default("yapildi"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_maintenance_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_maintenance_vehicle_idx").on(t.vehicleId, t.maintenanceDate),
  }),
);

/** Araç belgesi — ruhsat, muayene, K belgesi… Bitiş tarihi uyarı üretir. */
export const vehicleDocuments = pgTable(
  "vehicle_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    docType: varchar("doc_type", { length: 50 }).notNull(),
    label: varchar("label", { length: 200 }),
    issuedOn: date("issued_on"),
    expiresOn: date("expires_on"),
    fileUrl: text("file_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_documents_tenant_idx").on(t.tenantId),
    expiryIdx: index("vehicle_documents_expiry_idx").on(t.tenantId, t.expiresOn),
  }),
);

export const inspectionResultEnum = pgEnum("inspection_result", [
  "bekliyor",
  "gecti",
  "kaldi",
  "sartli",
]);

/** Araç denetimi. checklist jsonb: [{ madde, sonuc, not }]. */
export const inspections = pgTable(
  "inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    inspectorId: uuid("inspector_id").references(() => users.id, { onDelete: "set null" }),
    inspectionDate: date("inspection_date").notNull(),
    type: varchar("type", { length: 50 }).notNull().default("rutin"),
    typeId: uuid("type_id"),
    companyId: uuid("company_id"),
    /** Eksikliğin giderilmesi için verilen süre. */
    deadline: date("deadline"),
    result: inspectionResultEnum("result").notNull().default("bekliyor"),
    checklist: jsonb("checklist").notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("inspections_tenant_idx").on(t.tenantId),
    vehicleIdx: index("inspections_vehicle_idx").on(t.vehicleId, t.inspectionDate),
  }),
);

export const accidentStatusEnum = pgEnum("accident_status", ["acik", "kapali"]);

export const vehicleAccidents = pgTable(
  "vehicle_accidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    accidentDate: date("accident_date").notNull(),
    km: integer("km"),
    kind: varchar("kind", { length: 100 }),
    form: varchar("form", { length: 100 }),
    documentNo: varchar("document_no", { length: 50 }),
    /** Kusur oranı yüzde — hakediş kesintisinde kullanılır. */
    faultPercent: numeric("fault_percent", { precision: 5, scale: 2 }),
    status: accidentStatusEnum("status").notNull().default("acik"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_accidents_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_accidents_vehicle_idx").on(t.vehicleId, t.accidentDate),
  }),
);

export const vehiclePenalties = pgTable(
  "vehicle_penalties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    penaltyDate: date("penalty_date").notNull(),
    referenceNo: varchar("reference_no", { length: 100 }),
    documentNo: varchar("document_no", { length: 50 }),
    points: integer("points"),
    amount: numeric("amount", { precision: 12, scale: 2 }),
    kind: varchar("kind", { length: 100 }),
    isPaid: boolean("is_paid").notNull().default(false),
    paidAt: date("paid_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_penalties_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_penalties_vehicle_idx").on(t.vehicleId, t.penaltyDate),
    unpaidIdx: index("vehicle_penalties_unpaid_idx").on(t.tenantId, t.isPaid),
  }),
);

export const breakdownStatusEnum = pgEnum("breakdown_status", [
  "bekliyor",
  "devam_ediyor",
  "onarildi",
]);

export const vehicleBreakdowns = pgTable(
  "vehicle_breakdowns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    breakdownDate: date("breakdown_date").notNull(),
    km: integer("km"),
    detail: text("detail"),
    reportedBy: varchar("reported_by", { length: 100 }),
    reporterRole: varchar("reporter_role", { length: 100 }),
    status: breakdownStatusEnum("status").notNull().default("bekliyor"),
    resolvedAt: date("resolved_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_breakdowns_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_breakdowns_vehicle_idx").on(t.vehicleId, t.breakdownDate),
  }),
);

export const insuranceKindEnum = pgEnum("insurance_kind", [
  "kasko",
  "trafik",
  "koltuk",
  "ferdi_kaza",
]);

export const vehicleInsurances = pgTable(
  "vehicle_insurances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    policyNo: varchar("policy_no", { length: 100 }).notNull(),
    kind: insuranceKindEnum("kind").notNull(),
    insurer: varchar("insurer", { length: 100 }),
    agencyNo: varchar("agency_no", { length: 50 }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    premium: numeric("premium", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_insurances_tenant_idx").on(t.tenantId),
    expiryIdx: index("vehicle_insurances_expiry_idx").on(t.tenantId, t.endsOn),
  }),
);

export const vehicleTires = pgTable(
  "vehicle_tires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    changedOn: date("changed_on").notNull(),
    km: integer("km"),
    tireType: varchar("tire_type", { length: 50 }),
    size: varchar("size", { length: 30 }),
    quantity: integer("quantity").notNull().default(4),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    total: numeric("total", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_tires_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_tires_vehicle_idx").on(t.vehicleId, t.changedOn),
  }),
);

export const fuelLimitEnum = pgEnum("fuel_limit_kind", ["sinirsiz", "miktar", "tutar"]);

export const fuelCards = pgTable(
  "fuel_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    cardNo: varchar("card_no", { length: 50 }).notNull(),
    /** OPET, Shell, BP… serbest: sağlayıcı listesi müşteriye göre değişir. */
    provider: varchar("provider", { length: 50 }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    limitKind: fuelLimitEnum("limit_kind").notNull().default("sinirsiz"),
    limitValue: numeric("limit_value", { precision: 12, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("fuel_cards_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("fuel_cards_uniq").on(t.tenantId, t.cardNo),
  }),
);

/**
 * Yakıt dolumu. Tüketim = litre / (sonKm - oncekiKm) * 100.
 * aycanops'ta bu manuel giriliyordu; burada km farkından hesaplanıyor.
 */
export const fuelPurchases = pgTable(
  "fuel_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => fuelCards.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    purchaseDate: date("purchase_date").notNull(),
    station: varchar("station", { length: 100 }),
    liters: numeric("liters", { precision: 10, scale: 2 }),
    previousKm: integer("previous_km"),
    currentKm: integer("current_km"),
    unitPrice: numeric("unit_price", { precision: 10, scale: 3 }),
    total: numeric("total", { precision: 12, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("fuel_purchases_tenant_idx").on(t.tenantId),
    vehicleIdx: index("fuel_purchases_vehicle_idx").on(t.vehicleId, t.purchaseDate),
  }),
);

export type VehicleMaintenance = typeof vehicleMaintenance.$inferSelect;
export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type Inspection = typeof inspections.$inferSelect;
export type VehicleAccident = typeof vehicleAccidents.$inferSelect;
export type VehiclePenalty = typeof vehiclePenalties.$inferSelect;
export type VehicleBreakdown = typeof vehicleBreakdowns.$inferSelect;
export type VehicleInsurance = typeof vehicleInsurances.$inferSelect;
export type VehicleTire = typeof vehicleTires.$inferSelect;
export type FuelCard = typeof fuelCards.$inferSelect;
export type FuelPurchase = typeof fuelPurchases.$inferSelect;

/** Denetim tipi ve kriterleri — "Günlük Araç Kontrolü", "Müşteri Denetimi"… */
export const inspectionTypes = pgTable(
  "inspection_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 50 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    tenantIdx: index("inspection_types_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("inspection_types_uniq").on(t.tenantId, t.code),
  }),
);

export const inspectionCriteria = pgTable(
  "inspection_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    typeId: uuid("type_id")
      .notNull()
      .references(() => inspectionTypes.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 255 }).notNull(),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    tenantIdx: index("inspection_criteria_tenant_idx").on(t.tenantId),
    typeIdx: index("inspection_criteria_type_idx").on(t.typeId, t.position),
  }),
);

export type InspectionType = typeof inspectionTypes.$inferSelect;
export type InspectionCriterion = typeof inspectionCriteria.$inferSelect;
