import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { companies } from "./core";
import { tenants } from "./tenants";

/**
 * Satış CRM (AtriCRM): `satis` modülü tabloları.
 * Hepsi `crm_` önekli: mevcut `companies` (cari) ile karışmasın.
 * Aday/fırsat/aktivite görünürlüğü (sahiplik) sorgu katmanında uygulanır, RLS'in üstüne biner.
 */

export const crmStageKindEnum = pgEnum("crm_stage_kind", ["open", "won", "lost"]);
export const crmLeadStatusEnum = pgEnum("crm_lead_status", [
  "new",
  "contacted",
  "qualified",
  "disqualified",
  "converted",
]);
export const crmTemperatureEnum = pgEnum("crm_temperature", ["hot", "warm", "cold"]);
export const crmLeadSourceEnum = pgEnum("crm_lead_source", [
  "atricard",
  "webform",
  "csv",
  "manual",
  "api",
]);
export const crmActivityTypeEnum = pgEnum("crm_activity_type", [
  "call",
  "meeting",
  "email",
  "note",
  "task",
]);
export const crmQuoteStatusEnum = pgEnum("crm_quote_status", [
  "draft",
  "sent",
  "accepted",
  "rejected",
]);
export const crmTemplateChannelEnum = pgEnum("crm_template_channel", ["whatsapp", "email"]);
export const crmIntegrationKindEnum = pgEnum("crm_integration_kind", [
  "atricard_inbound",
  "webhook_outbound",
]);
export const crmInboundStatusEnum = pgEnum("crm_inbound_status", [
  "processed",
  "duplicate",
  "ignored",
  "rejected",
]);
export const crmDeliveryStatusEnum = pgEnum("crm_delivery_status", [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
]);

const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

const stamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pipeline aşamaları, kiracıya göre düzenlenebilir. */
export const crmStages = pgTable(
  "crm_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    key: varchar("key", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    position: integer("position").notNull().default(0),
    kind: crmStageKindEnum("kind").notNull().default("open"),
    color: varchar("color", { length: 20 }),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_stages_tenant_idx").on(t.tenantId),
    keyUniq: uniqueIndex("crm_stages_tenant_key_uniq").on(t.tenantId, t.key),
  }),
);

export const crmLeads = pgTable(
  "crm_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    /** Firma ya da kişi adı. */
    name: varchar("name", { length: 255 }).notNull(),
    contactName: varchar("contact_name", { length: 255 }),
    phone: varchar("phone", { length: 40 }),
    phoneKey: varchar("phone_key", { length: 20 }),
    email: varchar("email", { length: 255 }),
    emailKey: varchar("email_key", { length: 255 }),
    website: varchar("website", { length: 255 }),
    websiteKey: varchar("website_key", { length: 255 }),
    /** ad + şehir tekilleştirme anahtarı. */
    nameKey: varchar("name_key", { length: 300 }),
    city: varchar("city", { length: 100 }),
    sector: varchar("sector", { length: 100 }),
    /** Adayın kendi yazdığı mesaj. */
    message: text("message"),
    /** İlgilendiği hizmet. */
    service: varchar("service", { length: 255 }),
    /** Satışçının notu. */
    note: text("note"),
    score: integer("score").notNull().default(0),
    temperature: crmTemperatureEnum("temperature"),
    status: crmLeadStatusEnum("status").notNull().default("new"),
    source: crmLeadSourceEnum("source").notNull().default("manual"),
    externalId: varchar("external_id", { length: 100 }),
    /** Atricard fuar adı. */
    eventName: varchar("event_name", { length: 255 }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    convertedCompanyId: uuid("converted_company_id").references(() => companies.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by"),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_leads_tenant_idx").on(t.tenantId),
    statusIdx: index("crm_leads_status_idx").on(t.tenantId, t.status),
    ownerIdx: index("crm_leads_owner_idx").on(t.tenantId, t.ownerUserId),
    phoneIdx: index("crm_leads_phone_idx").on(t.tenantId, t.phoneKey),
    emailIdx: index("crm_leads_email_idx").on(t.tenantId, t.emailKey),
    websiteIdx: index("crm_leads_website_idx").on(t.tenantId, t.websiteKey),
    nameKeyIdx: index("crm_leads_name_key_idx").on(t.tenantId, t.nameKey),
    // external_id boşsa kısıt uygulanmaz (NULL'lar çakışmaz).
    externalUniq: uniqueIndex("crm_leads_external_uniq").on(t.tenantId, t.source, t.externalId),
  }),
);

export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    title: varchar("title", { length: 150 }),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 255 }),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_contacts_tenant_idx").on(t.tenantId),
    leadIdx: index("crm_contacts_lead_idx").on(t.leadId),
    companyIdx: index("crm_contacts_company_idx").on(t.companyId),
  }),
);

export const crmDeals = pgTable(
  "crm_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    title: varchar("title", { length: 255 }).notNull(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => crmStages.id, { onDelete: "restrict" }),
    value: numeric("value", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("TRY"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    expectedCloseAt: timestamp("expected_close_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    note: text("note"),
    createdBy: uuid("created_by"),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_deals_tenant_idx").on(t.tenantId),
    stageIdx: index("crm_deals_stage_idx").on(t.tenantId, t.stageId),
    ownerIdx: index("crm_deals_owner_idx").on(t.tenantId, t.ownerUserId),
    leadIdx: index("crm_deals_lead_idx").on(t.leadId),
  }),
);

/** Aktivite ve görev tek tabloda; zaman çizelgesi buradan akar. */
export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    type: crmActivityTypeEnum("type").notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    note: text("note"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    /** Durum değişikliği gibi sistemin yazdığı kayıt. */
    isSystem: boolean("is_system").notNull().default(false),
    createdBy: uuid("created_by"),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_activities_tenant_idx").on(t.tenantId),
    leadIdx: index("crm_activities_lead_idx").on(t.leadId),
    dealIdx: index("crm_activities_deal_idx").on(t.dealId),
    assigneeIdx: index("crm_activities_assignee_idx").on(t.tenantId, t.assigneeUserId, t.dueAt),
  }),
);

export const crmQuotes = pgTable(
  "crm_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "cascade" }),
    number: varchar("number", { length: 40 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    status: crmQuoteStatusEnum("status").notNull().default("draft"),
    /** [{ name, qty, unitPrice, vatRate }] */
    items: jsonb("items").notNull().default([]),
    total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("TRY"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_quotes_tenant_idx").on(t.tenantId),
    dealIdx: index("crm_quotes_deal_idx").on(t.dealId),
    numberUniq: uniqueIndex("crm_quotes_number_uniq").on(t.tenantId, t.number),
  }),
);

export const crmTemplates = pgTable(
  "crm_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    name: varchar("name", { length: 150 }).notNull(),
    channel: crmTemplateChannelEnum("channel").notNull(),
    subject: varchar("subject", { length: 255 }),
    body: text("body").notNull(),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_templates_tenant_idx").on(t.tenantId),
    nameUniq: uniqueIndex("crm_templates_tenant_name_uniq").on(t.tenantId, t.name),
  }),
);

export const crmIntegrations = pgTable(
  "crm_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    kind: crmIntegrationKindEnum("kind").notNull(),
    name: varchar("name", { length: 150 }).notNull(),
    /** Giden webhook hedef adresi. */
    url: varchar("url", { length: 2048 }),
    /** AES-256-GCM, `v1:iv:tag:şifreli`. Düz metin asla saklanmaz. */
    secretEnc: text("secret_enc").notNull(),
    /** Giden webhook'un dinlediği olaylar. */
    events: jsonb("events").notNull().default([]),
    enabled: boolean("enabled").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    /** `manual` | `failures` | `plan_not_allowed` | `ssrf` | boş. */
    disabledReason: varchar("disabled_reason", { length: 40 }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_integrations_tenant_idx").on(t.tenantId),
  }),
);

/** Gelen teslim günlüğü ve idempotency. 30 günden eskisi silinir. */
export const crmInboundEvents = pgTable(
  "crm_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => crmIntegrations.id, { onDelete: "cascade" }),
    deliveryId: varchar("delivery_id", { length: 100 }),
    event: varchar("event", { length: 60 }).notNull(),
    externalId: varchar("external_id", { length: 100 }),
    status: crmInboundStatusEnum("status").notNull(),
    error: text("error"),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_inbound_events_tenant_idx").on(t.tenantId),
    integrationIdx: index("crm_inbound_events_integration_idx").on(t.integrationId, t.createdAt),
  }),
);

/** Mezar taşı: silinen kişi geç gelen `lead.created` ile yeniden doğmasın (KVKK). */
export const crmDeletedExternal = pgTable(
  "crm_deleted_external",
  {
    tenantId: tenantRef(),
    source: crmLeadSourceEnum("source").notNull(),
    externalId: varchar("external_id", { length: 100 }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.source, t.externalId] }),
    tenantIdx: index("crm_deleted_external_tenant_idx").on(t.tenantId),
  }),
);

/** Giden teslim günlüğü. Yükte kişisel veri var: 30 günden eskisi silinir. */
export const crmWebhookDeliveries = pgTable(
  "crm_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => crmIntegrations.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 60 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: crmDeliveryStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    lastError: text("last_error"),
    /** İptal (KVKK) için: bu teslim hangi adaya ait. */
    leadId: uuid("lead_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_webhook_deliveries_tenant_idx").on(t.tenantId),
    dueIdx: index("crm_webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    integrationIdx: index("crm_webhook_deliveries_integration_idx").on(t.integrationId, t.createdAt),
    leadIdx: index("crm_webhook_deliveries_lead_idx").on(t.leadId),
  }),
);

/** Faz E: genel okuma API'si için anahtarlar. Anahtar yalnızca oluşturulurken bir kez gösterilir. */
export const crmApiKeys = pgTable(
  "crm_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantRef(),
    name: varchar("name", { length: 150 }).notNull(),
    prefix: varchar("prefix", { length: 16 }).notNull(),
    keyHash: varchar("key_hash", { length: 128 }).notNull(),
    scopes: jsonb("scopes").notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...stamps(),
  },
  (t) => ({
    tenantIdx: index("crm_api_keys_tenant_idx").on(t.tenantId),
    prefixUniq: uniqueIndex("crm_api_keys_prefix_uniq").on(t.prefix),
  }),
);

export type CrmStage = typeof crmStages.$inferSelect;
export type CrmLead = typeof crmLeads.$inferSelect;
export type NewCrmLead = typeof crmLeads.$inferInsert;
export type CrmContact = typeof crmContacts.$inferSelect;
export type CrmDeal = typeof crmDeals.$inferSelect;
export type CrmActivity = typeof crmActivities.$inferSelect;
export type CrmQuote = typeof crmQuotes.$inferSelect;
export type CrmTemplate = typeof crmTemplates.$inferSelect;
export type CrmIntegration = typeof crmIntegrations.$inferSelect;
export type CrmWebhookDelivery = typeof crmWebhookDeliveries.$inferSelect;
