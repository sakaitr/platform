import {
  boolean,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies, vehicles } from "./core";
import { routes, tripLogs } from "./guzergah";
import { tenants } from "./tenants";
import { users } from "./auth";

export const withholdingPolicyEnum = pgEnum("withholding_policy", [
  "tum_araclar",
  "sadece_ozmal",
  "uygulanmasin",
]);

/**
 * Firmanın mali kimliği. Ayrı tablo, çünkü her firma cari/işleten değil;
 * aycanops'ta isleten ve cari_tedarikci ayrı tablolardı — burada ikisi de
 * companies satırı, mali alanlar bu uzantıda.
 */
export const companyFinance = pgTable(
  "company_finance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    accountCode: varchar("account_code", { length: 50 }),
    idNumber: varchar("id_number", { length: 11 }),
    bankName: varchar("bank_name", { length: 100 }),
    bankBranch: varchar("bank_branch", { length: 100 }),
    iban: varchar("iban", { length: 34 }),
    contractStart: date("contract_start"),
    contractEnd: date("contract_end"),
    /** İşletenin kendi aracı mı, sürücü mü, ruhsat sahibi mi. */
    isPrimaryOperator: boolean("is_primary_operator").notNull().default(false),
    isDriver: boolean("is_driver").notNull().default(false),
    isTitleHolder: boolean("is_title_holder").notNull().default(false),
    withholdingPolicy: withholdingPolicyEnum("withholding_policy").notNull().default("tum_araclar"),
    /** Yakıt kredisi yüzdesi — hakedişten düşülür. */
    fuelCreditRate: numeric("fuel_credit_rate", { precision: 5, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("company_finance_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("company_finance_company_uniq").on(t.companyId),
    codeUniq: uniqueIndex("company_finance_code_uniq").on(t.tenantId, t.accountCode),
  }),
);

export const operatorAssignmentKindEnum = pgEnum("operator_assignment_kind", [
  "atama",
  "devir",
  "iptal",
]);

/** Aracı hangi işleten hangi tarihler arasında çalıştırdı. Hakedişin dayanağı. */
export const vehicleOperators = pgTable(
  "vehicle_operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    kind: operatorAssignmentKindEnum("kind").notNull().default("atama"),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("vehicle_operators_tenant_idx").on(t.tenantId),
    vehicleIdx: index("vehicle_operators_vehicle_idx").on(t.vehicleId, t.endsOn),
  }),
);

/** Ücretlendirme form tipi — hakedişin hangi tarifeye göre hesaplandığı. */
export const pricingForms = pgTable(
  "pricing_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    groupName: varchar("group_name", { length: 100 }),
    /** Sefer başı ücret — hakediş taslağı bunu kullanır. */
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("20"),
    withholdingRate: numeric("withholding_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("pricing_forms_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("pricing_forms_uniq").on(t.tenantId, t.name),
  }),
);

/** Güzergah bazlı fiyat — dönemsel, geçmişi bozmadan güncellenir. */
export const routePrices = pgTable(
  "route_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    /** Tedarikçi/işleten fiyatı; boş = müşteriye satış fiyatı. */
    supplierId: uuid("supplier_id").references(() => companies.id, { onDelete: "set null" }),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("TRY"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("route_prices_tenant_idx").on(t.tenantId),
    routeIdx: index("route_prices_route_idx").on(t.routeId, t.validTo),
  }),
);

export const earningStatusEnum = pgEnum("earning_status", [
  "taslak",
  "tahakkuk",
  "onaylandi",
  "odendi",
  "iptal",
]);

/**
 * Hakediş. Brüt → KDV → tevkifat → net zinciri.
 * Onaylı çetelelerden üretilir; kaynak çeteleler earning_trip_logs'ta tutulur.
 */
export const earnings = pgTable(
  "earnings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentNo: varchar("document_no", { length: 30 }),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    pricingFormId: uuid("pricing_form_id").references(() => pricingForms.id, { onDelete: "set null" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    gross: numeric("gross", { precision: 14, scale: 2 }).notNull().default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("20"),
    vat: numeric("vat", { precision: 14, scale: 2 }).notNull().default("0"),
    withholdingRate: numeric("withholding_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    withholding: numeric("withholding", { precision: 14, scale: 2 }).notNull().default("0"),
    deductions: numeric("deductions", { precision: 14, scale: 2 }).notNull().default("0"),
    net: numeric("net", { precision: 14, scale: 2 }).notNull().default("0"),
    tripCount: numeric("trip_count", { precision: 8, scale: 0 }).notNull().default("0"),
    status: earningStatusEnum("status").notNull().default("taslak"),
    accruedAt: timestamp("accrued_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("earnings_tenant_idx").on(t.tenantId),
    operatorIdx: index("earnings_operator_idx").on(t.operatorId, t.periodStart),
    statusIdx: index("earnings_status_idx").on(t.tenantId, t.status),
  }),
);

/** Hakedişin hangi çetelelerden üretildiği. Bir çetele yalnız bir hakedişe girer. */
export const earningTripLogs = pgTable(
  "earning_trip_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    earningId: uuid("earning_id")
      .notNull()
      .references(() => earnings.id, { onDelete: "cascade" }),
    tripLogId: uuid("trip_log_id")
      .notNull()
      .references(() => tripLogs.id, { onDelete: "cascade" }),
  },
  (t) => ({
    tenantIdx: index("earning_trip_logs_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("earning_trip_logs_uniq").on(t.tripLogId),
  }),
);

export const ledgerKindEnum = pgEnum("ledger_kind", [
  "hakedis",
  "odeme",
  "avans",
  "kesinti",
  "diger",
]);

/** Cari hareket. Bakiye = giriş - çıkış toplamı. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    dueDate: date("due_date"),
    /** Firmadan bize (tahsilat). */
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Bizden firmaya (ödeme). */
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    kind: ledgerKindEnum("kind").notNull().default("diger"),
    description: varchar("description", { length: 500 }),
    referenceType: varchar("reference_type", { length: 50 }),
    referenceId: uuid("reference_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("ledger_entries_tenant_idx").on(t.tenantId),
    companyIdx: index("ledger_entries_company_idx").on(t.companyId, t.entryDate),
  }),
);

export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "hazirlaniyor",
  "gonderildi",
  "onaylandi",
  "itiraz",
]);

/** Firma mutabakatı — dönem sonu bakiye teyidi. */
export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Dönemin ilk günü — YYYY-MM-01. */
    period: date("period").notNull(),
    balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
    status: reconciliationStatusEnum("status").notNull().default("hazirlaniyor"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    objection: text("objection"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("reconciliations_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("reconciliations_uniq").on(t.companyId, t.period),
  }),
);

export const financeKindEnum = pgEnum("finance_kind", ["gelir", "gider"]);

export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 200 }).notNull(),
    kind: financeKindEnum("kind").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("finance_categories_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("finance_categories_uniq").on(t.tenantId, t.name, t.kind),
  }),
);

export const financeStatusEnum = pgEnum("finance_status", ["taslak", "tamamlandi"]);

/**
 * Gelir/gider hareketi. aycanops'ta finans_gider ve finans_hareket ayrıydı;
 * ikisi de aynı şeyi tutuyordu. Tek tablo: tür alanı gelir/gider ayırıyor.
 * Boyutlar (araç, güzergah, firma) kâr-zarar kırılımını besliyor.
 */
export const financeTransactions = pgTable(
  "finance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: financeKindEnum("kind").notNull(),
    entryDate: date("entry_date").notNull(),
    documentNo: varchar("document_no", { length: 100 }),
    categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
    /** Karşı taraf — müşteri ya da tedarikçi. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "set null" }),
    /** Brüt (KDV dahil). */
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    vat: numeric("vat", { precision: 14, scale: 2 }).notNull().default("0"),
    net: numeric("net", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("TRY"),
    /** Geçmiş rapor kur değişince kaymasın diye TRY karşılığı sabitlenir. */
    rate: numeric("rate", { precision: 12, scale: 6 }).notNull().default("1"),
    amountTry: numeric("amount_try", { precision: 14, scale: 2 }).notNull().default("0"),
    status: financeStatusEnum("status").notNull().default("tamamlandi"),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("finance_transactions_tenant_idx").on(t.tenantId),
    dateIdx: index("finance_transactions_date_idx").on(t.tenantId, t.entryDate),
    kindIdx: index("finance_transactions_kind_idx").on(t.tenantId, t.kind),
  }),
);

/** Aylık bütçe hedefi — kâr-zarar sayfasında gerçekleşenle karşılaştırılır. */
export const budgetEntries = pgTable(
  "budget_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
    /** YYYY-MM */
    period: varchar("period", { length: 7 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("budget_entries_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("budget_entries_uniq").on(t.tenantId, t.period, t.categoryId, t.companyId),
  }),
);

export type CompanyFinance = typeof companyFinance.$inferSelect;
export type VehicleOperator = typeof vehicleOperators.$inferSelect;
export type PricingForm = typeof pricingForms.$inferSelect;
export type Earning = typeof earnings.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Reconciliation = typeof reconciliations.$inferSelect;
export type FinanceCategory = typeof financeCategories.$inferSelect;
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
export type BudgetEntry = typeof budgetEntries.$inferSelect;

export const deliveryNoteStatusEnum = pgEnum("delivery_note_status", [
  "taslak",
  "sevk_edildi",
  "teslim_edildi",
  "iptal",
]);

/**
 * İrsaliye — malın fiziksel sevkini belgeler.
 * Lojistik sektöründe zorunlu, turizmde yok: bu yüzden ayrı tablo ve
 * "muhasebe.irsaliye" yeteneğine bağlı. Modül kodu her iki durumda da aynı.
 */
export const deliveryNotes = pgTable(
  "delivery_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentNo: varchar("document_no", { length: 30 }).notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    issueDate: date("issue_date").notNull(),
    shipDate: date("ship_date"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    /** Taşınan malın tanımı ve miktarı. */
    description: text("description"),
    quantity: numeric("quantity", { precision: 12, scale: 2 }),
    unit: varchar("unit", { length: 20 }),
    status: deliveryNoteStatusEnum("status").notNull().default("taslak"),
    /** Faturalandığında bağlanır — irsaliye faturasız kalmasın. */
    transactionId: uuid("transaction_id").references(() => financeTransactions.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("delivery_notes_tenant_idx").on(t.tenantId),
    uniq: uniqueIndex("delivery_notes_uniq").on(t.tenantId, t.documentNo),
    statusIdx: index("delivery_notes_status_idx").on(t.tenantId, t.status),
  }),
);

export type DeliveryNote = typeof deliveryNotes.$inferSelect;
