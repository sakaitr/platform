import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Kiracıya özel terim ezmeleri. Çözüm sırası: bu tablo → paket varsayılanı → sistem varsayılanı. */
export const terminologyOverrides = pgTable(
  "terminology_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    termKey: varchar("term_key", { length: 100 }).notNull(),
    value: varchar("value", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("terminology_overrides_uniq").on(t.tenantId, t.termKey),
    tenantIdx: index("terminology_overrides_tenant_idx").on(t.tenantId),
  }),
);

export const fieldTypeEnum = pgEnum("field_type", ["text", "number", "date", "select", "boolean"]);

/** Sektöre/kiracıya özel ek alanlar. Değerler ilgili varlığın `custom` jsonb kolonunda tutulur. */
export const entityFields = pgTable(
  "entity_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityKey: varchar("entity_key", { length: 50 }).notNull(),
    fieldKey: varchar("field_key", { length: 50 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    type: fieldTypeEnum("type").notNull().default("text"),
    options: jsonb("options").notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("entity_fields_uniq").on(t.tenantId, t.entityKey, t.fieldKey),
    tenantIdx: index("entity_fields_tenant_idx").on(t.tenantId),
  }),
);

export const periodResetEnum = pgEnum("period_reset", ["none", "yearly", "monthly"]);

/** Boşluksuz belge numarası dizileri. Yasal belgeler için kritik. */
export const numberingSequences = pgTable(
  "numbering_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sequenceKey: varchar("sequence_key", { length: 50 }).notNull(),
    prefix: varchar("prefix", { length: 20 }).notNull().default(""),
    nextValue: integer("next_value").notNull().default(1),
    padding: integer("padding").notNull().default(6),
    periodReset: periodResetEnum("period_reset").notNull().default("yearly"),
    periodKey: varchar("period_key", { length: 10 }).notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("numbering_sequences_uniq").on(t.tenantId, t.sequenceKey),
    tenantIdx: index("numbering_sequences_tenant_idx").on(t.tenantId),
  }),
);

export type EntityField = typeof entityFields.$inferSelect;
