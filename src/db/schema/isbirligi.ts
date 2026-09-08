import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, drivers, vehicles } from "./core";
import { tenants } from "./tenants";
import { users } from "./auth";

/* ---------- Görevler ---------- */

export const taskStatusEnum = pgEnum("task_status", ["yapilacak", "yapiliyor", "bekliyor", "bitti"]);
export const priorityEnum = pgEnum("priority", ["dusuk", "normal", "yuksek", "kritik"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("yapilacak"),
    priority: priorityEnum("priority").notNull().default("normal"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("tasks_tenant_idx").on(t.tenantId),
    statusIdx: index("tasks_status_idx").on(t.tenantId, t.status),
    assigneeIdx: index("tasks_assignee_idx").on(t.assignedTo),
  }),
);

/* ---------- Destek talepleri ---------- */

export const ticketStatusEnum = pgEnum("ticket_status", [
  "acik",
  "islemde",
  "bekliyor",
  "cozuldu",
  "kapandi",
]);

/**
 * Destek talebi. İç kullanıcı da müşteri portalı da aynı tabloya yazar;
 * `source` hangisi olduğunu söyler. Böylece tek kuyruk, tek SLA.
 */
export const ticketSourceEnum = pgEnum("ticket_source", ["ic", "portal"]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ticketNo: varchar("ticket_no", { length: 30 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    source: ticketSourceEnum("source").notNull().default("ic"),
    status: ticketStatusEnum("status").notNull().default("acik"),
    priority: priorityEnum("priority").notNull().default("normal"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    /** SLA süresi dolmadan çözülmeli; geçmişse listede kırmızı. */
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    solvedAt: timestamp("solved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Portal talebinde açan müşteri kullanıcısı. */
    portalUserId: uuid("portal_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("tickets_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("tickets_no_uniq").on(t.tenantId, t.ticketNo),
    statusIdx: index("tickets_status_idx").on(t.tenantId, t.status),
  }),
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** Personel mesajı mı, müşteri mesajı mı. */
    fromCustomer: boolean("from_customer").notNull().default(false),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    portalUserId: uuid("portal_user_id"),
    body: text("body").notNull(),
    /** Sadece personelin gördüğü not — müşteriye gösterilmez. */
    isInternal: boolean("is_internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("ticket_messages_tenant_idx").on(t.tenantId),
    ticketIdx: index("ticket_messages_ticket_idx").on(t.ticketId),
  }),
);

/* ---------- Öneri / şikâyet ---------- */

export const suggestionKindEnum = pgEnum("suggestion_kind", ["oneri", "talep", "sikayet", "istek"]);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentNo: varchar("document_no", { length: 30 }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    kind: suggestionKindEnum("kind").notNull().default("oneri"),
    isOpen: boolean("is_open").notNull().default(true),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("suggestions_tenant_idx").on(t.tenantId) }),
);

/* ---------- Uyarı tutanağı ---------- */

export const warnings = pgTable(
  "warnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentNo: varchar("document_no", { length: 30 }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    deadline: date("deadline"),
    isDone: boolean("is_done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("warnings_tenant_idx").on(t.tenantId) }),
);

/* ---------- İK: izin ---------- */

export const leaveStatusEnum = pgEnum("leave_status", ["bekliyor", "onaylandi", "reddedildi"]);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    /** Yıllık hak ediş günü — 0 = sınırsız/ücretsiz. */
    annualDays: integer("annual_days").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    tenantIdx: index("leave_types_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("leave_types_uniq").on(t.tenantId, t.name),
  }),
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id").references(() => leaveTypes.id, { onDelete: "set null" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    dayCount: smallint("day_count").notNull().default(1),
    reason: text("reason"),
    status: leaveStatusEnum("status").notNull().default("bekliyor"),
    approverId: uuid("approver_id").references(() => users.id, { onDelete: "set null" }),
    approverNote: text("approver_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("leave_requests_tenant_idx").on(t.tenantId),
    userIdx: index("leave_requests_user_idx").on(t.userId, t.startsOn),
  }),
);

/* ---------- Sürücü sicili ve değerlendirme ---------- */

export const driverRecords = pgTable(
  "driver_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    incidentDate: date("incident_date").notNull(),
    category: varchar("category", { length: 50 }).notNull().default("diger"),
    /** 1 hafif, 5 ağır. */
    severity: smallint("severity").notNull().default(1),
    description: text("description").notNull(),
    actionTaken: text("action_taken"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("driver_records_tenant_idx").on(t.tenantId),
    driverIdx: index("driver_records_driver_idx").on(t.driverId, t.incidentDate),
  }),
);

/** Şoför değerlendirme — altı başlıkta 1-5 puan, ortalaması sicile işler. */
export const driverEvaluations = pgTable(
  "driver_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    evaluationDate: date("evaluation_date").notNull(),
    punctuality: smallint("punctuality").notNull().default(3),
    driving: smallint("driving").notNull().default(3),
    communication: smallint("communication").notNull().default(3),
    cleanliness: smallint("cleanliness").notNull().default(3),
    routeCompliance: smallint("route_compliance").notNull().default(3),
    appearance: smallint("appearance").notNull().default(3),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("driver_evaluations_tenant_idx").on(t.tenantId),
    driverIdx: index("driver_evaluations_driver_idx").on(t.driverId, t.evaluationDate),
  }),
);

/* ---------- Müşteri portalı ---------- */

/**
 * Portal kullanıcısı. Personel `users` tablosundan ayrı:
 * farklı yetki modeli, farklı oturum, dışarıdan erişim.
 */
export const portalUsers = pgTable(
  "portal_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    fullName: varchar("full_name", { length: 150 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("portal_users_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("portal_users_email_uniq").on(t.tenantId, t.email),
  }),
);

/** Portal kullanıcısının erişebildiği firmalar — bir kişi birden çok firmayı görebilir. */
export const portalUserCompanies = pgTable(
  "portal_user_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    portalUserId: uuid("portal_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
  },
  (t) => ({
    tenantIdx: index("portal_user_companies_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("portal_user_companies_uniq").on(t.portalUserId, t.companyId),
  }),
);

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    portalUserId: uuid("portal_user_id")
      .notNull()
      .references(() => portalUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("portal_sessions_tenant_idx").on(t.tenantId) }),
);

export type Task = typeof tasks.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type Suggestion = typeof suggestions.$inferSelect;
export type Warning = typeof warnings.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type DriverRecord = typeof driverRecords.$inferSelect;
export type DriverEvaluation = typeof driverEvaluations.$inferSelect;
export type PortalUser = typeof portalUsers.$inferSelect;
