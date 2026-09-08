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
import { passengers } from "./operasyon";
import { tenants } from "./tenants";
import { users } from "./auth";

/**
 * Firma vardiyası: beklenen giriş saati + tolerans.
 * Giriş kontrolde planlanan saati buradan alır — gecikme elle girilmez.
 */
export const companyShifts = pgTable(
  "company_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    /** HH:mm */
    expectedAt: varchar("expected_at", { length: 5 }).notNull(),
    toleranceEarly: integer("tolerance_early").notNull().default(15),
    toleranceLate: integer("tolerance_late").notNull().default(10),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("company_shifts_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("company_shifts_uniq").on(t.companyId, t.name),
  }),
);

export const routeDirectionEnum = pgEnum("route_direction", ["gidis", "donus", "ikisi"]);

/** Güzergah — sabit hat. Duraklar jsonb: [{ ad, lat, lng, sira }]. */
export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }),
    direction: routeDirectionEnum("direction").notNull().default("ikisi"),
    capacity: integer("capacity"),
    shiftName: varchar("shift_name", { length: 100 }),
    morningDeparture: varchar("morning_departure", { length: 5 }),
    morningArrival: varchar("morning_arrival", { length: 5 }),
    eveningDeparture: varchar("evening_departure", { length: 5 }),
    eveningArrival: varchar("evening_arrival", { length: 5 }),
    stops: jsonb("stops").notNull().default([]),
    /** Güncel atanmış araç/sürücü — geçmişi route_assignments tutar. */
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    distanceKm: numeric("distance_km", { precision: 8, scale: 2 }),
    durationMin: integer("duration_min"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("routes_tenant_idx").on(t.tenantId),
    companyIdx: index("routes_company_idx").on(t.companyId),
  }),
);

/** Güzergahın saat dilimleri — bir hat birden çok vardiyaya hizmet edebilir. */
export const routeTimeSlots = pgTable(
  "route_time_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    arriveAt: varchar("arrive_at", { length: 5 }),
    departAt: varchar("depart_at", { length: 5 }),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    tenantIdx: index("route_time_slots_tenant_idx").on(t.tenantId),
    routeIdx: index("route_time_slots_route_idx").on(t.routeId),
  }),
);

export const routeTags = pgTable(
  "route_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 50 }).notNull(),
    color: varchar("color", { length: 20 }),
  },
  (t) => ({
    tenantIdx: index("route_tags_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("route_tags_uniq").on(t.tenantId, t.name),
  }),
);

export const routeTagLinks = pgTable(
  "route_tag_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => routeTags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    tenantIdx: index("route_tag_links_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("route_tag_links_uniq").on(t.routeId, t.tagId),
  }),
);

export const assignmentKindEnum = pgEnum("assignment_kind", ["atama", "devir", "iptal"]);

/**
 * Araç/sürücü atama geçmişi. bitisTarihi null = güncel atama.
 * Kim, ne zaman, hangi araçla koştu sorusunun tek kaynağı.
 */
export const routeAssignments = pgTable(
  "route_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    /** Boş = tüm hareketler için geçerli varsayılan. */
    tripType: varchar("trip_type", { length: 40 }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    kind: assignmentKindEnum("kind").notNull().default("atama"),
    notes: varchar("notes", { length: 500 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("route_assignments_tenant_idx").on(t.tenantId),
    routeIdx: index("route_assignments_route_idx").on(t.routeId, t.endsOn),
  }),
);

/** Güzergaha sabit yolcu ataması. */
export const routePassengers = pgTable(
  "route_passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => passengers.id, { onDelete: "cascade" }),
    stopName: varchar("stop_name", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("route_passengers_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("route_passengers_uniq").on(t.routeId, t.passengerId),
  }),
);

export const openRouteStatusEnum = pgEnum("open_route_status", ["acik", "fiyatlandi", "kapandi"]);

/** Açık güzergah: henüz araç/fiyat bağlanmamış talep. */
export const openRoutes = pgTable(
  "open_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    distanceKm: numeric("distance_km", { precision: 8, scale: 2 }),
    durationMin: integer("duration_min"),
    price: numeric("price", { precision: 12, scale: 2 }),
    status: openRouteStatusEnum("status").notNull().default("acik"),
    notes: text("notes"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("open_routes_tenant_idx").on(t.tenantId),
    statusIdx: index("open_routes_status_idx").on(t.tenantId, t.status),
  }),
);

export const tripLogStatusEnum = pgEnum("trip_log_status", ["bekliyor", "onaylandi", "iptal"]);

/**
 * Çetele: bir aracın bir gündeki hareket kaydı. Hakedişin girdisi —
 * onaylanmadan faturalanmaz, onaylanınca geri alma nedeni zorunlu.
 */
export const tripLogs = pgTable(
  "trip_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    logDate: date("log_date").notNull(),
    /** sabah, akşam, ring, transfer… serbest — sektöre göre değişir. */
    tripType: varchar("trip_type", { length: 40 }).notNull(),
    direction: varchar("direction", { length: 10 }),
    status: tripLogStatusEnum("status").notNull().default("bekliyor"),
    passengerCount: integer("passenger_count"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    revertReason: varchar("revert_reason", { length: 500 }),
    notes: varchar("notes", { length: 500 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("trip_logs_tenant_idx").on(t.tenantId),
    dateIdx: index("trip_logs_date_idx").on(t.tenantId, t.logDate),
    uniq: uniqueIndex("trip_logs_uniq").on(t.vehicleId, t.logDate, t.tripType),
  }),
);

export const transferStatusEnum = pgEnum("transfer_status", [
  "istek",
  "planlandi",
  "yolda",
  "tamamlandi",
  "iptal",
]);

/** Tek seferlik taşıma. Güzergahtan farkı: tekrar etmez. */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    status: transferStatusEnum("status").notNull().default("istek"),
    pickupLocation: text("pickup_location"),
    dropoffLocation: text("dropoff_location"),
    transferDate: date("transfer_date"),
    transferTime: varchar("transfer_time", { length: 5 }),
    passengerCount: integer("passenger_count"),
    actualPassengerCount: integer("actual_passenger_count"),
    price: numeric("price", { precision: 12, scale: 2 }),
    notes: text("notes"),
    completionNotes: text("completion_notes"),
    cancellationReason: text("cancellation_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("transfers_tenant_idx").on(t.tenantId),
    statusIdx: index("transfers_status_idx").on(t.tenantId, t.status),
    dateIdx: index("transfers_date_idx").on(t.tenantId, t.transferDate),
  }),
);

export const transferPassengers = pgTable(
  "transfer_passengers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => transfers.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id").references(() => passengers.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 30 }),
    notes: text("notes"),
  },
  (t) => ({
    tenantIdx: index("transfer_passengers_tenant_idx").on(t.tenantId),
    transferIdx: index("transfer_passengers_transfer_idx").on(t.transferId),
  }),
);

export const routePlanStatusEnum = pgEnum("route_plan_status", [
  "taslak",
  "yayinlandi",
  "aktif",
  "arsiv",
]);

/** Rota planı — versiyonlanır, yayınlanana kadar operasyonu etkilemez. */
export const routePlans = pgTable(
  "route_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    shiftName: varchar("shift_name", { length: 100 }),
    direction: routeDirectionEnum("direction").notNull().default("gidis"),
    status: routePlanStatusEnum("status").notNull().default("taslak"),
    versionNo: integer("version_no").notNull().default(1),
    /** { toplamKm, toplamDakika, aracSayisi, ortalamaDoluluk } */
    metrics: jsonb("metrics").notNull().default({}),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("route_plans_tenant_idx").on(t.tenantId),
    statusIdx: index("route_plans_status_idx").on(t.tenantId, t.status),
  }),
);

export const routePlanRoutes = pgTable(
  "route_plan_routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => routePlans.id, { onDelete: "cascade" }),
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }).notNull(),
    color: varchar("color", { length: 20 }),
    position: integer("position").notNull().default(0),
    metrics: jsonb("metrics").notNull().default({}),
  },
  (t) => ({
    tenantIdx: index("route_plan_routes_tenant_idx").on(t.tenantId),
    planIdx: index("route_plan_routes_plan_idx").on(t.planId),
  }),
);

export const routePlanStops = pgTable(
  "route_plan_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    planRouteId: uuid("plan_route_id")
      .notNull()
      .references(() => routePlanRoutes.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    position: integer("position").notNull().default(0),
    /** Kilitli durak otomatik optimizasyonda yerinden oynatılmaz. */
    locked: boolean("locked").notNull().default(false),
    passengerCount: integer("passenger_count").notNull().default(0),
  },
  (t) => ({
    tenantIdx: index("route_plan_stops_tenant_idx").on(t.tenantId),
    routeIdx: index("route_plan_stops_route_idx").on(t.planRouteId),
  }),
);

export const routePlanAssignments = pgTable(
  "route_plan_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stopId: uuid("stop_id")
      .notNull()
      .references(() => routePlanStops.id, { onDelete: "cascade" }),
    passengerId: uuid("passenger_id")
      .notNull()
      .references(() => passengers.id, { onDelete: "cascade" }),
    walkingDistanceM: integer("walking_distance_m"),
  },
  (t) => ({
    tenantIdx: index("route_plan_assignments_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("route_plan_assignments_uniq").on(t.stopId, t.passengerId),
  }),
);

export type CompanyShift = typeof companyShifts.$inferSelect;
export type Route = typeof routes.$inferSelect;
export type RouteAssignment = typeof routeAssignments.$inferSelect;
export type OpenRoute = typeof openRoutes.$inferSelect;
export type TripLog = typeof tripLogs.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type RoutePlan = typeof routePlans.$inferSelect;
