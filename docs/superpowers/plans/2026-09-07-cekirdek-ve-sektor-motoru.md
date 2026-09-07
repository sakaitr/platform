# Agno Platform — Çekirdek + Sektör Paketi Motoru (Faz 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Çok kiracılı platform çekirdeği + sektör paketi motoru. Aynı kod tabanı, sektöre göre farklı yüz: terminoloji, özel alanlar, alt-yetenekler ve modül seti sektör paketiyle gelir. Yeni sektör = yeni paket, yeni kod değil.

**Architecture:** Tek Next.js 16 App Router uygulaması, modüler monolit (`src/modules/<key>/`). Postgres + Drizzle. İzolasyon iki katmanlı: uygulama seviyesinde `withTenant()` sarmalayıcı + veritabanı seviyesinde **Row Level Security** (uygulama non-owner rolle bağlanır, her transaction'da `SET LOCAL app.tenant_id`). Sektör farkı **veri**: terminoloji sözlüğü, `entity_fields` özel alan tanımları, `tenant_capabilities` alt-yetenek anahtarları — hepsi kod içinde tanımlı, versiyonlanmış **sektör paketi** tarafından kurulur.

**Tech Stack:** Next.js 16 · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Tailwind · Radix UI · bcryptjs · Zod · BullMQ + Redis · Vitest · Playwright · Docker

## Global Constraints

- Node 22 LTS. Docker tabanı `node:22-alpine`.
- TypeScript `strict: true`. `any` yasak.
- Kullanıcıya dönen metin **Türkçe**; kod/tablo/dosya adı **İngilizce**; log İngilizce.
- **Hiçbir kiracı verisi `withTenant()` dışından okunmaz/yazılmaz.** RLS bunu veritabanında da zorlar.
- Uygulama Postgres'e `agno_app` rolüyle bağlanır — **owner değil, superuser değil** (owner RLS'i baypas eder).
- Tenant context'i **daima** `SET LOCAL` ile transaction içinde kurulur. Düz `SET` yasak — bağlantı havuzu kiracı sızdırır.
- Para: `numeric(14,2)`. Oran: `numeric(5,2)`. **Float yasak.**
- Zaman: kolonlar `timestamptz`. İş günü hesabı daima `Europe/Istanbul`.
- Her tabloda `id uuid primary key default gen_random_uuid()`, `created_at`/`updated_at` `timestamptz not null default now()`.
- Kiracı tablolarında `tenant_id uuid not null` + **indeks zorunlu** (RLS policy'si indekssiz yavaşlar).
- Cache anahtarları kiracıya kapsanır: `revalidateTag(\`t:${tenantId}:<kaynak>\`)`. Çıplak `revalidatePath` kiracı verisi taşıyan sayfalarda yasak.
- Migration `drizzle-kit generate` ile üretilir; RLS policy'leri elle SQL migration olarak eklenir.
- Her task sonunda commit, Conventional Commits.
- Sır repoya girmez. `.env` gitignore'da.

---

## Kapsam

**Bu plan:** çekirdek şema, izolasyon (RLS), kimlik (giriş/şifre sıfırlama/davet), rol-izin, modül kayıt defteri + süreli lisans, **sektör paketi motoru** (terminoloji + özel alanlar + alt-yetenekler + paket kurulumu), kabuk UI, worker iskeleti, yardımcılar (para/zaman/numaralandırma), provizyon, deploy.

**Bu plan değil (ayrı planlar):**
- `plan-2-faturalama.md` — fatura, tahsilat, cari, yaşlandırma, operatör paneli
- `plan-3-modul-muhasebe.md` — cari/fatura çekirdeği + turizm paketi (hakediş/çetele/mutabakat) + lojistik paketi (irsaliye/sevkiyat)
- `plan-4-modul-randevu.md` — randevu-hizmet çekirdeği + pilates (PSYS) + oto servis (OSYS) paketleri
- `plan-5-modul-operasyon.md`, `plan-6-modul-filo.md`, `plan-7-modul-depo.md`

---

## File Structure

```
agno-platform/
├─ docker-compose.dev.yml
├─ Dockerfile
├─ drizzle.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ drizzle/                        Üretilen migration'lar + elle RLS SQL'leri
├─ src/
│  ├─ db/
│  │  ├─ index.ts                  Pool + drizzle client (agno_app rolü)
│  │  ├─ admin.ts                  Platform operatörü client (BYPASSRLS rolü)
│  │  ├─ tenant.ts                 withTenant() — SET LOCAL + transaction
│  │  └─ schema/
│  │     ├─ index.ts
│  │     ├─ tenants.ts             tenants, tenant_modules, tenant_capabilities, subscriptions
│  │     ├─ auth.ts                users, sessions, password_resets, invites, audit_logs
│  │     └─ sector.ts              terminology_overrides, entity_fields, numbering_sequences
│  ├─ lib/
│  │  ├─ auth/                     password, session, guards, reset, invite
│  │  ├─ permissions.ts
│  │  ├─ modules/registry.ts       Modül kataloğu + erişim çözümleme
│  │  ├─ licensing.ts              getTenantAccess() — lisans durum makinesi
│  │  ├─ sector/
│  │  │  ├─ packs.ts               Sektör paketi tanımları (TS, versiyonlu)
│  │  │  ├─ install.ts             applySectorPack()
│  │  │  ├─ terminology.ts         getTerms() / t()
│  │  │  └─ fields.ts              Özel alan okuma/doğrulama
│  │  ├─ money.ts                  TRY biçimleme, KDV/tevkifat
│  │  ├─ time.ts                   İstanbul günü, dönem hesapları
│  │  ├─ numbering.ts              Boşluksuz belge numarası
│  │  ├─ cache.ts                  tenantTag()
│  │  └─ audit.ts
│  ├─ modules/admin/               Kiracı yöneticisi modülü
│  ├─ components/layout/           sidebar, topbar
│  └─ app/
│     ├─ login/, sifre-sifirla/, davet/
│     ├─ (app)/                    Kabuk: layout, dashboard, admin
│     └─ api/
├─ worker/
│  ├─ index.ts                     BullMQ worker + cron
│  └─ jobs/                        license-expiry, email
├─ scripts/provision.ts            Kiracı açma (paket uygulayarak)
└─ tests/
```

---

### Task 1: Proje iskeleti

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `docker-compose.dev.yml`, `vitest.config.ts`, `src/lib/utils.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `tests/smoke.test.ts`

**Interfaces:**
- Consumes: yok
- Produces: `npm run dev|build|test`, `cn(...inputs: ClassValue[]): string`, Postgres 5433'te çalışır

- [ ] **Step 1: Dizin + git**

```bash
cd ~/claude/agno-platform && git init
```

- [ ] **Step 2: `package.json`**

```json
{
  "name": "agno-platform",
  "version": "0.1.0",
  "private": true,
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx scripts/seed.ts",
    "provision": "tsx scripts/provision.ts",
    "worker": "tsx worker/index.ts"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "drizzle-orm": "^0.36.0",
    "pg": "^8.13.0",
    "bcryptjs": "^2.4.3",
    "zod": "^3.23.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.460.0",
    "bullmq": "^5.25.0",
    "ioredis": "^5.4.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/pg": "^8.11.0",
    "@types/bcryptjs": "^2.4.6",
    "drizzle-kit": "^0.28.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "^2.1.0",
    "@playwright/test": "^1.48.0",
    "dotenv": "^16.4.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Yapılandırma dosyaları**

`next.config.ts`:
```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

`tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";
export default { content: ["./src/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] } satisfies Config;
```

`postcss.config.mjs`:
```javascript
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`.gitignore`:
```
node_modules/
.next/
out/
*.log
.env
.env*.local
.DS_Store
tsconfig.tsbuildinfo
playwright-report/
test-results/
```

`.env.example`:
```
DATABASE_URL="postgresql://agno_app:app_dev@localhost:5433/agno_platform"
DATABASE_ADMIN_URL="postgresql://agno_owner:owner_dev@localhost:5433/agno_platform"
REDIS_URL="redis://localhost:6380"
AUTH_COOKIE_NAME="agno_platform_session"
APP_URL="http://localhost:3000"
NODE_ENV="development"
```

- [ ] **Step 5: `docker-compose.dev.yml` + servisleri başlat**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: agno_platform_pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: agno_owner
      POSTGRES_PASSWORD: owner_dev
      POSTGRES_DB: agno_platform
    ports: ["5433:5432"]
    volumes: [pg_data:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    container_name: agno_platform_redis
    restart: unless-stopped
    ports: ["6380:6379"]
volumes:
  pg_data:
```

Run:
```bash
docker compose -f docker-compose.dev.yml up -d
docker exec agno_platform_pg psql -U agno_owner -d agno_platform -c "CREATE ROLE agno_app LOGIN PASSWORD 'app_dev';"
docker exec agno_platform_pg psql -U agno_owner -d agno_platform -c "GRANT USAGE ON SCHEMA public TO agno_app;"
docker exec agno_platform_pg psql -U agno_owner -d agno_platform -c "CREATE DATABASE agno_platform_test OWNER agno_owner;"
```
Expected: `CREATE ROLE`, `GRANT`, `CREATE DATABASE`

- [ ] **Step 6: Kök dosyalar + duman testi**

`src/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Agno Platform" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
```

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

`tests/smoke.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("çakışan tailwind sınıflarını birleştirir", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
```

- [ ] **Step 7: Kur, test et, build et**

Run: `npm install && npm test && npm run build`
Expected: `1 passed`, build `EXIT=0`

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: proje iskeleti — Next 16, Tailwind, Vitest, Postgres+Redis dev

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Çekirdek şema

**Files:**
- Create: `src/db/schema/tenants.ts`, `src/db/schema/auth.ts`, `src/db/schema/sector.ts`, `src/db/schema/index.ts`, `src/db/index.ts`, `src/db/admin.ts`, `drizzle.config.ts`, `tests/setup.ts`, `tests/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 ortam değişkenleri
- Produces:
  - `db` (agno_app rolü), `dbAdmin` (owner rolü, RLS baypas — sadece platform operasyonları)
  - Tablolar: `tenants`, `tenantModules`, `tenantCapabilities`, `subscriptions`, `users`, `sessions`, `passwordResets`, `invites`, `auditLogs`, `terminologyOverrides`, `entityFields`, `numberingSequences`
  - Tipler: `Tenant`, `User`, `Session`, `UserRole`, `LicenseStatus`
  - `userRoleEnum`: `"owner" | "admin" | "manager" | "member" | "viewer"`
  - `licenseStatusEnum`: `"trial" | "active" | "grace" | "expired" | "suspended"`

- [ ] **Step 1: `src/db/schema/tenants.ts`**

```typescript
import { boolean, index, jsonb, numeric, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const licenseStatusEnum = pgEnum("license_status", ["trial", "active", "grace", "expired", "suspended"]);

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

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  planKey: varchar("plan_key", { length: 50 }).notNull().default("standart"),
  status: licenseStatusEnum("status").notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  graceDays: numeric("grace_days", { precision: 3, scale: 0 }).notNull().default("7"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("subscriptions_tenant_idx").on(t.tenantId) }));

/** Kiracının hangi modülleri kullanabildiği + modül bazlı süre. */
export const tenantModules = pgTable("tenant_modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  moduleKey: varchar("module_key", { length: 50 }).notNull(),
  status: licenseStatusEnum("status").notNull().default("active"),
  /** null = aboneliğin dönemine bağlı. Dolu = modüle özel bitiş. */
  endsAt: timestamp("ends_at", { withTimezone: true }),
  limits: jsonb("limits").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("tenant_modules_uniq").on(t.tenantId, t.moduleKey),
  tenantIdx: index("tenant_modules_tenant_idx").on(t.tenantId),
}));

/** Modül içi alt-yetenekler — örn. "muhasebe.irsaliye", "muhasebe.hakedis". */
export const tenantCapabilities = pgTable("tenant_capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  capabilityKey: varchar("capability_key", { length: 100 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("tenant_capabilities_uniq").on(t.tenantId, t.capabilityKey),
  tenantIdx: index("tenant_capabilities_tenant_idx").on(t.tenantId),
}));

export type Tenant = typeof tenants.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type TenantModule = typeof tenantModules.$inferSelect;
export type LicenseStatus = (typeof licenseStatusEnum.enumValues)[number];
```

- [ ] **Step 2: `src/db/schema/auth.ts`**

```typescript
import { boolean, index, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "manager", "member", "viewer"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("users_tenant_idx").on(t.tenantId) }));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("sessions_tenant_idx").on(t.tenantId) }));

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("password_resets_tenant_idx").on(t.tenantId) }));

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("invites_tenant_idx").on(t.tenantId) }));

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  event: varchar("event", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: uuid("entity_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tenantIdx: index("audit_logs_tenant_idx").on(t.tenantId) }));

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type UserRole = (typeof userRoleEnum.enumValues)[number];
```

- [ ] **Step 3: `src/db/schema/sector.ts`**

```typescript
import { boolean, index, integer, jsonb, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Kiracıya özel terim ezmeleri. Çözüm sırası: bu tablo → paket varsayılanı → sistem varsayılanı. */
export const terminologyOverrides = pgTable("terminology_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  termKey: varchar("term_key", { length: 100 }).notNull(),
  value: varchar("value", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("terminology_overrides_uniq").on(t.tenantId, t.termKey),
  tenantIdx: index("terminology_overrides_tenant_idx").on(t.tenantId),
}));

export const fieldTypeEnum = pgEnum("field_type", ["text", "number", "date", "select", "boolean"]);

/** Sektöre/kiracıya özel ek alanlar. Değerler ilgili varlığın `custom` jsonb kolonunda tutulur. */
export const entityFields = pgTable("entity_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  entityKey: varchar("entity_key", { length: 50 }).notNull(),
  fieldKey: varchar("field_key", { length: 50 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  type: fieldTypeEnum("type").notNull().default("text"),
  options: jsonb("options").notNull().default([]),
  required: boolean("required").notNull().default(false),
  position: integer("position").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("entity_fields_uniq").on(t.tenantId, t.entityKey, t.fieldKey),
  tenantIdx: index("entity_fields_tenant_idx").on(t.tenantId),
}));

export const periodResetEnum = pgEnum("period_reset", ["none", "yearly", "monthly"]);

/** Boşluksuz belge numarası dizileri. Yasal belgeler için kritik. */
export const numberingSequences = pgTable("numbering_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sequenceKey: varchar("sequence_key", { length: 50 }).notNull(),
  prefix: varchar("prefix", { length: 20 }).notNull().default(""),
  nextValue: integer("next_value").notNull().default(1),
  padding: integer("padding").notNull().default(6),
  periodReset: periodResetEnum("period_reset").notNull().default("yearly"),
  periodKey: varchar("period_key", { length: 10 }).notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex("numbering_sequences_uniq").on(t.tenantId, t.sequenceKey),
  tenantIdx: index("numbering_sequences_tenant_idx").on(t.tenantId),
}));

export type EntityField = typeof entityFields.$inferSelect;
```

- [ ] **Step 4: `src/db/schema/index.ts`, `src/db/index.ts`, `src/db/admin.ts`, `drizzle.config.ts`**

`src/db/schema/index.ts`:
```typescript
export * from "./tenants";
export * from "./auth";
export * from "./sector";
```

`src/db/index.ts`:
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString, max: 10 });

/** Uygulama client'ı — agno_app rolü, RLS'e tabi. */
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
```

`src/db/admin.ts`:
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is not set");

const pool = new Pool({ connectionString, max: 4 });

/**
 * Platform operatörü client'ı — owner rolü, RLS'i baypas eder.
 * SADECE kiracılar-üstü işlemler: provizyon, lisans yönetimi, çapraz raporlama.
 * Kiracı iş verisi için ASLA kullanılmaz.
 */
export const dbAdmin = drizzle(pool, { schema });
```

`drizzle.config.ts`:
```typescript
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL! },
});
```

- [ ] **Step 5: Migration üret ve uygula**

Run:
```bash
cp .env.example .env
npm run db:generate && npm run db:push
```
Expected: migration üretilir, "Changes applied"

- [ ] **Step 6: `tests/setup.ts`**

```typescript
import "dotenv/config";
import { sql } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";

export async function resetDatabase(): Promise<void> {
  await dbAdmin.execute(sql`
    TRUNCATE TABLE audit_logs, invites, password_resets, sessions, users,
      numbering_sequences, entity_fields, terminology_overrides,
      tenant_capabilities, tenant_modules, subscriptions, tenants
    RESTART IDENTITY CASCADE
  `);
}
```

- [ ] **Step 7: `tests/schema.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenantModules, tenants } from "@/db/schema";
import { resetDatabase } from "./setup";

describe("çekirdek şema", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kiracı oluşturur, slug benzersizdir", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "Aycan", slug: "aycan", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    expect(tenant!.sectorPack).toBe("turizm");

    await expect(
      dbAdmin.insert(tenants).values({ name: "X", slug: "aycan", sectorPack: "lojistik", sectorPackVersion: "1.0.0" }),
    ).rejects.toThrow();
  });

  it("aynı kiracıya aynı modül iki kez eklenemez", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    await dbAdmin.insert(tenantModules).values({ tenantId: tenant!.id, moduleKey: "muhasebe" });
    await expect(
      dbAdmin.insert(tenantModules).values({ tenantId: tenant!.id, moduleKey: "muhasebe" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Test + commit**

Run: `npm test`
Expected: `3 passed`

```bash
git add -A && git commit -m "feat: çekirdek şema — kiracı, lisans, yetenek, kimlik, sektör tabloları

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Row Level Security + withTenant

**Files:**
- Create: `drizzle/9000_rls.sql`, `src/db/tenant.ts`, `tests/rls.test.ts`

**Interfaces:**
- Consumes: Task 2'den `db`, `dbAdmin`, şemalar
- Produces:
  - `withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>` — transaction açar, `SET LOCAL app.tenant_id` kurar
  - `TenantTx` — transaction client tipi
  - Tüm kiracı tablolarında RLS aktif ve zorunlu

- [ ] **Step 1: Başarısız RLS testini yaz — `tests/rls.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { resetDatabase } from "./setup";

async function seedTwoTenants() {
  const [a] = await dbAdmin.insert(tenants)
    .values({ name: "A", slug: "a", sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
  const [b] = await dbAdmin.insert(tenants)
    .values({ name: "B", slug: "b", sectorPack: "lojistik", sectorPackVersion: "1.0.0" }).returning();
  await dbAdmin.insert(users).values([
    { tenantId: a!.id, email: "a@x.com", name: "A", passwordHash: "x" },
    { tenantId: b!.id, email: "b@x.com", name: "B", passwordHash: "x" },
  ]);
  return { a: a!, b: b! };
}

describe("row level security", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("withTenant sadece kendi kiracısının satırlarını görür", async () => {
    const { a } = await seedTwoTenants();
    const rows = await withTenant(a.id, (tx) => tx.select().from(users));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("a@x.com");
  });

  it("tenant context olmadan uygulama rolü hiçbir satır göremez", async () => {
    await seedTwoTenants();
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(0);
  });

  it("ham SQL ile bile başka kiracının satırı okunamaz", async () => {
    const { a } = await seedTwoTenants();
    const result = await withTenant(a.id, (tx) => tx.execute(sql`SELECT email FROM users`));
    expect(result.rows).toHaveLength(1);
  });

  it("tenant context transaction dışına sızmaz", async () => {
    const { a } = await seedTwoTenants();
    await withTenant(a.id, (tx) => tx.select().from(users));
    const after = await db.select().from(users);
    expect(after).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/rls.test.ts`
Expected: FAIL — `Cannot find module '@/db/tenant'`

- [ ] **Step 3: `drizzle/9000_rls.sql` yaz**

```sql
-- Uygulama rolüne tablo hakları (RLS ayrıca süzer)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agno_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agno_app;

-- tenant_id taşıyan her tabloya RLS
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'subscriptions','tenant_modules','tenant_capabilities',
    'users','sessions','password_resets','invites','audit_logs',
    'terminology_overrides','entity_fields','numbering_sequences'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: tablo sahibi de policy'ye uyar (owner baypasını kapatır)
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;

-- tenants tablosu: kendi satırı
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Owner (agno_owner) provizyon için baypas edebilmeli
ALTER ROLE agno_owner BYPASSRLS;
```

- [ ] **Step 4: RLS migration'ını uygula**

Run:
```bash
docker exec -i agno_platform_pg psql -U agno_owner -d agno_platform < drizzle/9000_rls.sql
docker exec -i agno_platform_pg psql -U agno_owner -d agno_platform_test < drizzle/9000_rls.sql
```
Expected: `GRANT`, `DO`, `ALTER TABLE`, `CREATE POLICY`, `ALTER ROLE` — hata yok

- [ ] **Step 5: `src/db/tenant.ts` yaz**

```typescript
import { sql } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { db, schema } from "./index";

export type TenantTx = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/**
 * Kiracı kapsamlı iş birimi.
 *
 * `set_config(..., true)` = SET LOCAL: ayar SADECE bu transaction'da geçerli.
 * Bağlantı havuza döndüğünde context sıfırlanır — kiracı sızıntısı olmaz.
 * Düz `SET` kullanmak havuzda bir kiracının context'ini diğerine taşır.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as TenantTx);
  });
}
```

- [ ] **Step 6: Testi çalıştır — geçmeli**

Run: `npm test tests/rls.test.ts`
Expected: `4 passed`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: Postgres RLS + withTenant — SET LOCAL ile havuz güvenli kiracı izolasyonu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Yardımcılar — para, zaman, numaralandırma, cache etiketi

**Files:**
- Create: `src/lib/money.ts`, `src/lib/time.ts`, `src/lib/numbering.ts`, `src/lib/cache.ts`, `tests/helpers.test.ts`

**Interfaces:**
- Consumes: Task 3'ten `withTenant`, `TenantTx`; Task 2'den `numberingSequences`
- Produces:
  - `formatTRY(amount: string | number): string`
  - `calcVat(net: string, rate: string): { vat: string; gross: string }`
  - `calcWithholding(vat: string, rate: string): string`
  - `istanbulDayKey(date?: Date): string` — `"2026-09-07"`
  - `istanbulPeriodKey(reset: "none" | "yearly" | "monthly", date?: Date): string`
  - `nextNumber(tx: TenantTx, tenantId: string, sequenceKey: string): Promise<string>`
  - `tenantTag(tenantId: string, resource: string): string`

- [ ] **Step 1: Başarısız testi yaz — `tests/helpers.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { numberingSequences, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { calcVat, calcWithholding, formatTRY } from "@/lib/money";
import { istanbulDayKey, istanbulPeriodKey } from "@/lib/time";
import { nextNumber } from "@/lib/numbering";
import { tenantTag } from "@/lib/cache";
import { resetDatabase } from "./setup";

describe("para", () => {
  it("TRY biçimler", () => {
    expect(formatTRY("1234.5")).toBe("₺1.234,50");
  });

  it("KDV hesaplar — kuruş kaybı yok", () => {
    expect(calcVat("1000.00", "20.00")).toEqual({ vat: "200.00", gross: "1200.00" });
    expect(calcVat("333.33", "20.00")).toEqual({ vat: "66.67", gross: "400.00" });
  });

  it("tevkifat hesaplar", () => {
    expect(calcWithholding("200.00", "50.00")).toBe("100.00");
  });
});

describe("zaman", () => {
  it("İstanbul gününü döner — UTC gece yarısı kayması yok", () => {
    // 2026-09-07 21:30 UTC = 2026-09-08 00:30 İstanbul
    expect(istanbulDayKey(new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-08");
  });

  it("dönem anahtarı üretir", () => {
    const d = new Date("2026-09-07T10:00:00Z");
    expect(istanbulPeriodKey("yearly", d)).toBe("2026");
    expect(istanbulPeriodKey("monthly", d)).toBe("2026-09");
    expect(istanbulPeriodKey("none", d)).toBe("");
  });
});

describe("numaralandırma", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("boşluksuz artan numara üretir", async () => {
    const [tenant] = await dbAdmin.insert(tenants)
      .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
    await dbAdmin.insert(numberingSequences).values({
      tenantId: tenant!.id, sequenceKey: "fatura", prefix: "FT", padding: 5, periodReset: "yearly",
    });

    const first = await withTenant(tenant!.id, (tx) => nextNumber(tx, tenant!.id, "fatura"));
    const second = await withTenant(tenant!.id, (tx) => nextNumber(tx, tenant!.id, "fatura"));

    expect(first).toBe("FT2026-00001");
    expect(second).toBe("FT2026-00002");
  });
});

describe("cache etiketi", () => {
  it("kiracıya kapsanmış etiket üretir", () => {
    expect(tenantTag("abc", "modules")).toBe("t:abc:modules");
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/helpers.test.ts`
Expected: FAIL — modüller bulunamaz

- [ ] **Step 3: `src/lib/money.ts`**

```typescript
/** Tutarlar string olarak taşınır (numeric). Float asla kullanılmaz. */

function toCents(value: string | number): bigint {
  const normalized = typeof value === "number" ? value.toFixed(2) : value.trim();
  const [whole, frac = ""] = normalized.split(".");
  const cents = `${whole}${frac.padEnd(2, "0").slice(0, 2)}`;
  return BigInt(cents);
}

function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatTRY(amount: string | number): string {
  const value = Number(typeof amount === "number" ? amount : amount.replace(",", "."));
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);
}

/** Yarıyı yukarı yuvarlar — muhasebe standardı. */
export function calcVat(net: string, ratePercent: string): { vat: string; gross: string } {
  const netCents = toCents(net);
  const rateBasis = toCents(ratePercent); // %20.00 -> 2000
  const vatCents = (netCents * rateBasis + 5000n) / 10000n;
  return { vat: fromCents(vatCents), gross: fromCents(netCents + vatCents) };
}

/** Tevkifat: KDV'nin belirtilen yüzdesi alıcıda kalır. */
export function calcWithholding(vat: string, ratePercent: string): string {
  const vatCents = toCents(vat);
  const rateBasis = toCents(ratePercent);
  return fromCents((vatCents * rateBasis + 5000n) / 10000n);
}
```

- [ ] **Step 4: `src/lib/time.ts`**

```typescript
const TZ = "Europe/Istanbul";

/** İstanbul yerel gününü YYYY-MM-DD olarak döner. UTC toISOString() gün kaydırır — kullanma. */
export function istanbulDayKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function istanbulPeriodKey(reset: "none" | "yearly" | "monthly", date: Date = new Date()): string {
  if (reset === "none") return "";
  const day = istanbulDayKey(date);
  return reset === "yearly" ? day.slice(0, 4) : day.slice(0, 7);
}
```

- [ ] **Step 5: `src/lib/numbering.ts`**

```typescript
import { and, eq, sql } from "drizzle-orm";
import { numberingSequences } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { istanbulPeriodKey } from "./time";

/**
 * Boşluksuz belge numarası üretir.
 * Satır `FOR UPDATE` ile kilitlenir — eşzamanlı çağrılarda numara atlamaz/çakışmaz.
 * DAİMA çağıranın transaction'ı içinde çalışır.
 */
export async function nextNumber(tx: TenantTx, tenantId: string, sequenceKey: string): Promise<string> {
  const locked = await tx.execute(sql`
    SELECT id, prefix, next_value, padding, period_reset, period_key
    FROM numbering_sequences
    WHERE tenant_id = ${tenantId} AND sequence_key = ${sequenceKey}
    FOR UPDATE
  `);

  const row = locked.rows[0] as
    | { id: string; prefix: string; next_value: number; padding: number; period_reset: "none" | "yearly" | "monthly"; period_key: string }
    | undefined;
  if (!row) throw new Error(`Numbering sequence not found: ${sequenceKey}`);

  const currentPeriod = istanbulPeriodKey(row.period_reset);
  const periodChanged = currentPeriod !== row.period_key;
  const value = periodChanged ? 1 : row.next_value;

  await tx
    .update(numberingSequences)
    .set({ nextValue: value + 1, periodKey: currentPeriod })
    .where(and(eq(numberingSequences.tenantId, tenantId), eq(numberingSequences.sequenceKey, sequenceKey)));

  const padded = String(value).padStart(row.padding, "0");
  return `${row.prefix}${currentPeriod}${currentPeriod ? "-" : ""}${padded}`;
}
```

- [ ] **Step 6: `src/lib/cache.ts`**

```typescript
/**
 * Kiracıya kapsanmış cache etiketi.
 * Çıplak revalidatePath() TÜM kiracıların cache'ini düşürür ve
 * kiracı anahtarı içermeyen cache girdileri çapraz veri sızdırır.
 */
export function tenantTag(tenantId: string, resource: string): string {
  return `t:${tenantId}:${resource}`;
}
```

- [ ] **Step 7: Test + commit**

Run: `npm test tests/helpers.test.ts`
Expected: `7 passed`

```bash
git add -A && git commit -m "feat: para/zaman/numaralandırma/cache yardımcıları

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Kimlik — şifre, oturum, guard

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/index.ts`, `src/lib/permissions.ts`, `tests/auth.test.ts`

**Interfaces:**
- Consumes: Task 2 şemalar, Task 3 `withTenant`
- Produces:
  - `hashPassword(plain): Promise<string>` / `verifyPassword(plain, hash): Promise<boolean>`
  - `createSession(userId, tenantId): Promise<string>` / `getSessionByToken(token): Promise<SessionUser | null>` / `destroySessionByToken(token): Promise<void>` / `revokeUserSessions(tenantId, userId): Promise<void>`
  - `SessionUser = { userId, tenantId, email, name, role }`
  - `Permission` tipi, `ROLE_PERMISSIONS`, `hasPermission(role, permission)`
  - `getCurrentSession()`, `requireAuth()`, `requirePermission(p)`, `AUTH_COOKIE_NAME`

- [ ] **Step 1: `tests/auth.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { createSession, destroySessionByToken, getSessionByToken, hashPassword, revokeUserSessions, verifyPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { resetDatabase } from "./setup";

async function seedUser() {
  const [tenant] = await dbAdmin.insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
  const [user] = await dbAdmin.insert(users).values({
    tenantId: tenant!.id, email: "a@x.com", name: "A",
    passwordHash: await hashPassword("Gizli1234!"), role: "admin",
  }).returning();
  return { tenant: tenant!, user: user! };
}

describe("şifre", () => {
  it("hash üretir ve doğrular", async () => {
    const hash = await hashPassword("Gizli1234!");
    expect(hash).not.toBe("Gizli1234!");
    expect(await verifyPassword("Gizli1234!", hash)).toBe(true);
    expect(await verifyPassword("yanlis", hash)).toBe(false);
  });
});

describe("oturum", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("oturum açar ve token ile çözer", async () => {
    const { tenant, user } = await seedUser();
    const token = await createSession(user.id, tenant.id);
    const s = await getSessionByToken(token);
    expect(s?.userId).toBe(user.id);
    expect(s?.role).toBe("admin");
  });

  it("geçersiz ve iptal edilmiş token null döner", async () => {
    const { tenant, user } = await seedUser();
    expect(await getSessionByToken("yok")).toBeNull();
    const token = await createSession(user.id, tenant.id);
    await destroySessionByToken(token);
    expect(await getSessionByToken(token)).toBeNull();
  });

  it("rol değişince tüm oturumlar iptal edilebilir", async () => {
    const { tenant, user } = await seedUser();
    const t1 = await createSession(user.id, tenant.id);
    const t2 = await createSession(user.id, tenant.id);
    await revokeUserSessions(tenant.id, user.id);
    expect(await getSessionByToken(t1)).toBeNull();
    expect(await getSessionByToken(t2)).toBeNull();
  });
});

describe("izinler", () => {
  it("owner yönetir, viewer yönetemez", () => {
    expect(hasPermission("owner", "users.manage")).toBe(true);
    expect(hasPermission("viewer", "users.manage")).toBe(false);
    expect(hasPermission("viewer", "dashboard.read")).toBe(true);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/permissions.ts`**

```typescript
import type { UserRole } from "@/db/schema";

/** Çekirdek izinler. İş modülleri `<modul>.read|write|approve` deseniyle ekler. */
export type Permission =
  | "dashboard.read"
  | "users.manage"
  | "settings.manage"
  | "terminology.manage"
  | "fields.manage";

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  owner: ["dashboard.read", "users.manage", "settings.manage", "terminology.manage", "fields.manage"],
  admin: ["dashboard.read", "users.manage", "settings.manage", "terminology.manage", "fields.manage"],
  manager: ["dashboard.read"],
  member: ["dashboard.read"],
  viewer: ["dashboard.read"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
```

- [ ] **Step 4: `src/lib/auth/password.ts` ve `session.ts`**

`password.ts`:
```typescript
import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

`session.ts`:
```typescript
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { sessions, users, type UserRole } from "@/db/schema";

export const SESSION_DURATION_DAYS = 30;

export type SessionUser = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Oturum tabloları dbAdmin ile okunur: giriş anında henüz tenant context'i YOK
 * (token'dan tenant'ı öğreniyoruz). Bu tek istisna, denetlenmiş ve dar kapsamlı.
 */
export async function createSession(userId: string, tenantId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 86_400_000);
  await dbAdmin.insert(sessions).values({ userId, tenantId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export async function getSessionByToken(token: string): Promise<SessionUser | null> {
  const rows = await dbAdmin
    .select({
      userId: users.id, tenantId: users.tenantId, email: users.email,
      name: users.name, role: users.role, isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, hashToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ))
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;
  return { userId: row.userId, tenantId: row.tenantId, email: row.email, name: row.name, role: row.role };
}

export async function destroySessionByToken(token: string): Promise<void> {
  await dbAdmin.update(sessions).set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** Rol/yetki değişiminde çağrılır — eski oturumlar eski yetkiyle devam etmesin. */
export async function revokeUserSessions(tenantId: string, userId: string): Promise<void> {
  await dbAdmin.update(sessions).set({ revokedAt: new Date() })
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
```

- [ ] **Step 5: `src/lib/auth/guards.ts` ve `index.ts`**

`guards.ts`:
```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/permissions";
import { getSessionByToken, type SessionUser } from "./session";

export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "agno_platform_session";

export async function getCurrentSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionByToken(token);
}

export async function requireAuth(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = await requireAuth();
  if (!hasPermission(session.role, permission)) redirect("/dashboard");
  return session;
}
```

`index.ts`:
```typescript
export { hashPassword, verifyPassword } from "./password";
export {
  createSession, getSessionByToken, destroySessionByToken,
  revokeUserSessions, hashToken, SESSION_DURATION_DAYS,
} from "./session";
export type { SessionUser } from "./session";
export { getCurrentSession, requireAuth, requirePermission, AUTH_COOKIE_NAME } from "./guards";
```

- [ ] **Step 6: Test + commit**

Run: `npm test tests/auth.test.ts`
Expected: `5 passed`

```bash
git add -A && git commit -m "feat: kimlik — şifre, oturum, oturum iptali, izin matrisi, guard'lar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Sektör paketi — terminoloji

**Files:**
- Create: `src/lib/sector/terminology.ts`, `tests/terminology.test.ts`

**Interfaces:**
- Consumes: Task 2 `terminologyOverrides`; Task 3 `withTenant`
- Produces:
  - `SYSTEM_TERMS: Record<string, string>` — sistem varsayılanları
  - `getTerms(tenantId: string, packTerms: Record<string, string>): Promise<Terms>`
  - `Terms = { t: (key: string) => string; all: Record<string, string> }`

- [ ] **Step 1: `tests/terminology.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, terminologyOverrides } from "@/db/schema";
import { getTerms, SYSTEM_TERMS } from "@/lib/sector/terminology";
import { resetDatabase } from "./setup";

async function seedTenant() {
  const [t] = await dbAdmin.insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "pilates", sectorPackVersion: "1.0.0" }).returning();
  return t!;
}

describe("terminoloji", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("sistem varsayılanını döner", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, {});
    expect(terms.t("customer")).toBe(SYSTEM_TERMS["customer"]);
  });

  it("paket varsayılanı sistemi ezer", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, { customer: "Üye" });
    expect(terms.t("customer")).toBe("Üye");
  });

  it("kiracı ezmesi paketi ezer", async () => {
    const tenant = await seedTenant();
    await dbAdmin.insert(terminologyOverrides)
      .values({ tenantId: tenant.id, termKey: "customer", value: "Sporcu" });
    const terms = await getTerms(tenant.id, { customer: "Üye" });
    expect(terms.t("customer")).toBe("Sporcu");
  });

  it("tanımsız anahtar için anahtarın kendisini döner", async () => {
    const tenant = await seedTenant();
    const terms = await getTerms(tenant.id, {});
    expect(terms.t("bilinmeyen_anahtar")).toBe("bilinmeyen_anahtar");
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/terminology.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/sector/terminology.ts`**

```typescript
import { eq } from "drizzle-orm";
import { terminologyOverrides } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Sistem varsayılan terimleri. Sektör paketi bunları ezer,
 * kiracı da paketi ezer. UI'da sabit metin yerine t("...") kullanılır.
 */
export const SYSTEM_TERMS: Record<string, string> = {
  customer: "Müşteri",
  customer_plural: "Müşteriler",
  resource: "Kaynak",
  resource_plural: "Kaynaklar",
  appointment: "Randevu",
  appointment_plural: "Randevular",
  service: "Hizmet",
  service_plural: "Hizmetler",
  package: "Paket",
  package_plural: "Paketler",
  staff: "Personel",
  staff_plural: "Personeller",
  asset: "Varlık",
  asset_plural: "Varlıklar",
  document: "Belge",
  document_plural: "Belgeler",
};

export type Terms = {
  t: (key: string) => string;
  all: Record<string, string>;
};

/** Çözüm sırası: kiracı ezmesi → paket varsayılanı → sistem varsayılanı → anahtarın kendisi. */
export async function getTerms(tenantId: string, packTerms: Record<string, string>): Promise<Terms> {
  const overrides = await withTenant(tenantId, (tx) =>
    tx.select({ termKey: terminologyOverrides.termKey, value: terminologyOverrides.value })
      .from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId)),
  );

  const all: Record<string, string> = { ...SYSTEM_TERMS, ...packTerms };
  for (const row of overrides) all[row.termKey] = row.value;

  return { t: (key: string): string => all[key] ?? key, all };
}
```

- [ ] **Step 4: Test + commit**

Run: `npm test tests/terminology.test.ts`
Expected: `4 passed`

```bash
git add -A && git commit -m "feat: sektör terminoloji motoru — 3 katmanlı terim çözümlemesi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Sektör paketi — özel alanlar

**Files:**
- Create: `src/lib/sector/fields.ts`, `tests/fields.test.ts`

**Interfaces:**
- Consumes: Task 2 `entityFields`; Task 3 `withTenant`
- Produces:
  - `getEntityFields(tenantId: string, entityKey: string): Promise<EntityField[]>`
  - `buildCustomSchema(fields: EntityField[]): z.ZodType<Record<string, unknown>>`
  - `parseCustomValues(fields: EntityField[], input: Record<string, unknown>): Record<string, unknown>`

- [ ] **Step 1: `tests/fields.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { entityFields, tenants } from "@/db/schema";
import { buildCustomSchema, getEntityFields } from "@/lib/sector/fields";
import { resetDatabase } from "./setup";

async function seed() {
  const [t] = await dbAdmin.insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "lojistik", sectorPackVersion: "1.0.0" }).returning();
  await dbAdmin.insert(entityFields).values([
    { tenantId: t!.id, entityKey: "invoice", fieldKey: "irsaliye_no", label: "İrsaliye No", type: "text", required: true, position: 1 },
    { tenantId: t!.id, entityKey: "invoice", fieldKey: "sevk_tarihi", label: "Sevk Tarihi", type: "date", position: 2 },
    { tenantId: t!.id, entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
  ]);
  return t!;
}

describe("özel alanlar", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("varlığa göre alanları sırayla getirir", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "invoice");
    expect(fields.map((f) => f.fieldKey)).toEqual(["irsaliye_no", "sevk_tarihi"]);
  });

  it("zorunlu alan boşsa doğrulama hata verir", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "invoice");
    const schema = buildCustomSchema(fields);
    expect(schema.safeParse({ sevk_tarihi: "2026-09-07" }).success).toBe(false);
    expect(schema.safeParse({ irsaliye_no: "A-123" }).success).toBe(true);
  });

  it("tanımsız alanı reddetmez, yok sayar", async () => {
    const tenant = await seed();
    const fields = await getEntityFields(tenant.id, "customer");
    const schema = buildCustomSchema(fields);
    const result = schema.safeParse({ vergi_no: "123", uydurma: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("uydurma");
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/fields.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/sector/fields.ts`**

```typescript
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { entityFields, type EntityField } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function getEntityFields(tenantId: string, entityKey: string): Promise<EntityField[]> {
  return withTenant(tenantId, (tx) =>
    tx.select().from(entityFields)
      .where(and(
        eq(entityFields.tenantId, tenantId),
        eq(entityFields.entityKey, entityKey),
        eq(entityFields.isActive, true),
      ))
      .orderBy(asc(entityFields.position)),
  );
}

function fieldToZod(field: EntityField): z.ZodTypeAny {
  const base = ((): z.ZodTypeAny => {
    switch (field.type) {
      case "number":
        return z.coerce.number();
      case "date":
        return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${field.label} geçerli bir tarih olmalı.`);
      case "boolean":
        return z.coerce.boolean();
      case "select": {
        const options = (field.options as string[]) ?? [];
        return options.length > 0
          ? z.string().refine((v) => options.includes(v), `${field.label} geçersiz seçim.`)
          : z.string();
      }
      default:
        return z.string();
    }
  })();

  return field.required
    ? base.refine((v) => v !== "" && v !== undefined && v !== null, `${field.label} zorunlu.`)
    : base.optional();
}

/** Tanımlı alanlardan Zod şeması üretir. Tanımsız anahtarlar sessizce düşer (strip). */
export function buildCustomSchema(fields: EntityField[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) shape[field.fieldKey] = fieldToZod(field);
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}

export function parseCustomValues(
  fields: EntityField[],
  input: Record<string, unknown>,
): Record<string, unknown> {
  return buildCustomSchema(fields).parse(input);
}
```

- [ ] **Step 4: Test + commit**

Run: `npm test tests/fields.test.ts`
Expected: `3 passed`

```bash
git add -A && git commit -m "feat: sektör özel alan motoru — tanım, doğrulama, şema üretimi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Modül kayıt defteri + lisans durum makinesi

**Files:**
- Create: `src/lib/modules/registry.ts`, `src/lib/licensing.ts`, `tests/licensing.test.ts`

**Interfaces:**
- Consumes: Task 2 `tenants`/`subscriptions`/`tenantModules`/`tenantCapabilities`; Task 5 `hasPermission`
- Produces:
  - `ModuleDefinition = { key, label, icon, href, permission, dependsOn?, capabilities?, children? }`
  - `MODULE_REGISTRY: readonly ModuleDefinition[]`
  - `ModuleAccess = { allowed: true; limits; warning? } | { allowed: false; reason }`
  - `TenantAccess = { tenant, subscription, state, modules: Map<string, ModuleAccess>, capabilities: Set<string> }`
  - `getTenantAccess(tenantId): Promise<TenantAccess>`
  - `buildNavigation(role, access): ModuleDefinition[]`

- [ ] **Step 1: `tests/licensing.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenantCapabilities, tenantModules, tenants } from "@/db/schema";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation } from "@/lib/modules/registry";
import { resetDatabase } from "./setup";

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

async function seed(opts: { subEnd: Date; moduleEnds?: Date | null; graceDays?: string }) {
  const [t] = await dbAdmin.insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
  await dbAdmin.insert(subscriptions).values({
    tenantId: t!.id, status: "active", currentPeriodEnd: opts.subEnd, graceDays: opts.graceDays ?? "7",
  });
  await dbAdmin.insert(tenantModules).values({
    tenantId: t!.id, moduleKey: "muhasebe", status: "active", endsAt: opts.moduleEnds ?? null,
  });
  await dbAdmin.insert(tenantCapabilities)
    .values({ tenantId: t!.id, capabilityKey: "muhasebe.irsaliye", enabled: true });
  return t!;
}

describe("lisans durum makinesi", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("dönem içindeyse erişim açık", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("active");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: true });
  });

  it("dönem bitti ama grace içinde — erişim açık, uyarı var", async () => {
    const tenant = await seed({ subEnd: daysFromNow(-3), graceDays: "7" });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("grace");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: true, warning: "grace" });
  });

  it("grace bitti — erişim kapalı", async () => {
    const tenant = await seed({ subEnd: daysFromNow(-30), graceDays: "7" });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("locked");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("modüle özel süre dolduysa sadece o modül kapanır", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20), moduleEnds: daysFromNow(-1) });
    const access = await getTenantAccess(tenant.id);
    expect(access.state).toBe("active");
    expect(access.modules.get("muhasebe")).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("lisanssız modül not_licensed döner", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.modules.get("filo")).toMatchObject({ allowed: false, reason: "not_licensed" });
  });

  it("alt-yetenekleri okur", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(access.capabilities.has("muhasebe.irsaliye")).toBe(true);
  });

  it("navigasyon lisans ve izne göre süzülür", async () => {
    const tenant = await seed({ subEnd: daysFromNow(20) });
    const access = await getTenantAccess(tenant.id);
    expect(buildNavigation("owner", access).map((m) => m.key)).toContain("muhasebe");
    expect(buildNavigation("owner", access).map((m) => m.key)).not.toContain("filo");
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/licensing.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/modules/keys.ts` — döngüyü kıran tek doğruluk kaynağı**

```typescript
/**
 * Modül anahtarları. registry.ts ve licensing.ts birbirine bağımlı olduğu için
 * anahtarlar burada durur — iki taraf da buradan okur, döngü oluşmaz.
 * YENİ MODÜL EKLERKEN: hem buraya hem MODULE_REGISTRY'ye eklenir.
 * Task 8 Step 6'daki test bu ikisinin senkronunu doğrular.
 */
export const MODULE_KEYS = ["dashboard", "muhasebe", "filo", "admin"] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
```

- [ ] **Step 4: `src/lib/modules/registry.ts`**

```typescript
import { hasPermission, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/db/schema";
import type { TenantAccess } from "@/lib/licensing";

export type ModuleNavChild = { label: string; href: string; capability?: string };

export type ModuleDefinition = {
  key: string;
  label: string;
  /** lucide-react ikon adı */
  icon: string;
  href: string;
  permission: Permission;
  /** Bu modül çalışmak için başka modüle muhtaçsa — örn. muhasebe → filo (araç verisi) */
  dependsOn?: readonly string[];
  /** Modül içinde sektöre göre açılıp kapanan alt-yetenekler */
  capabilities?: readonly string[];
  children?: readonly ModuleNavChild[];
};

/** Platformdaki tüm modüllerin tek doğruluk kaynağı. */
export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", href: "/dashboard", permission: "dashboard.read" },
  {
    key: "muhasebe",
    label: "Muhasebe",
    icon: "Calculator",
    href: "/muhasebe",
    permission: "dashboard.read",
    capabilities: ["muhasebe.irsaliye", "muhasebe.hakedis", "muhasebe.mutabakat"],
    children: [
      { label: "Cari", href: "/muhasebe/cari" },
      { label: "Faturalar", href: "/muhasebe/faturalar" },
      { label: "İrsaliyeler", href: "/muhasebe/irsaliyeler", capability: "muhasebe.irsaliye" },
      { label: "Hakedişler", href: "/muhasebe/hakedis", capability: "muhasebe.hakedis" },
    ],
  },
  { key: "filo", label: "Filo", icon: "Truck", href: "/filo", permission: "dashboard.read" },
  {
    key: "admin",
    label: "Yönetim",
    icon: "Settings",
    href: "/admin",
    permission: "users.manage",
    children: [
      { label: "Kullanıcılar", href: "/admin/users" },
      { label: "Terimler", href: "/admin/terminoloji" },
      { label: "Özel Alanlar", href: "/admin/alanlar" },
    ],
  },
];

export function getModule(key: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((m) => m.key === key);
}

/** Hem lisans hem izin süzgecinden geçen modüller. */
export function buildNavigation(role: UserRole, access: TenantAccess): ModuleDefinition[] {
  return MODULE_REGISTRY.filter((module) => {
    if (!hasPermission(role, module.permission)) return false;
    if (module.key === "dashboard") return true;
    return access.modules.get(module.key)?.allowed === true;
  });
}

/** Alt menüden, kapalı alt-yeteneklere ait olanları eler. */
export function visibleChildren(module: ModuleDefinition, access: TenantAccess): ModuleNavChild[] {
  return (module.children ?? []).filter(
    (child) => !child.capability || access.capabilities.has(child.capability),
  );
}
```

- [ ] **Step 5: `src/lib/licensing.ts`**

```typescript
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import {
  subscriptions, tenantCapabilities, tenantModules, tenants,
  type Subscription, type Tenant,
} from "@/db/schema";
import { MODULE_KEYS } from "@/lib/modules/keys";

export type ModuleAccess =
  | { allowed: true; limits: Record<string, number>; warning?: "trial_ending" | "grace" }
  | { allowed: false; reason: "not_licensed" | "expired" | "suspended" | "tenant_inactive" };

export type TenantState = "trial" | "active" | "grace" | "locked";

export type TenantAccess = {
  tenant: Tenant;
  subscription: Subscription;
  state: TenantState;
  modules: Map<string, ModuleAccess>;
  capabilities: Set<string>;
};

function resolveState(sub: Subscription, now: Date): TenantState {
  if (sub.status === "suspended" || sub.status === "expired") return "locked";
  if (sub.status === "trial") {
    return sub.trialEndsAt && sub.trialEndsAt.getTime() < now.getTime() ? "locked" : "trial";
  }
  if (!sub.currentPeriodEnd) return "active";
  if (sub.currentPeriodEnd.getTime() >= now.getTime()) return "active";

  const graceMs = Number(sub.graceDays) * 86_400_000;
  return now.getTime() <= sub.currentPeriodEnd.getTime() + graceMs ? "grace" : "locked";
}

/**
 * Kiracının tüm erişim durumunu tek seferde çözer.
 * İstek başına bir kez çağrılır; sonuç kabuk layout'unda taşınır.
 */
export async function getTenantAccess(tenantId: string): Promise<TenantAccess> {
  const now = new Date();

  const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const [subscription] = await dbAdmin.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId)).limit(1);
  if (!subscription) throw new Error(`Subscription not found for tenant: ${tenantId}`);

  const licenses = await dbAdmin.select().from(tenantModules)
    .where(eq(tenantModules.tenantId, tenantId));
  const caps = await dbAdmin.select().from(tenantCapabilities)
    .where(eq(tenantCapabilities.tenantId, tenantId));

  const state = tenant.isActive ? resolveState(subscription, now) : "locked";
  const modules = new Map<string, ModuleAccess>();

  for (const license of licenses) {
    if (!tenant.isActive) {
      modules.set(license.moduleKey, { allowed: false, reason: "tenant_inactive" });
      continue;
    }
    if (license.status === "suspended") {
      modules.set(license.moduleKey, { allowed: false, reason: "suspended" });
      continue;
    }
    // Modüle özel bitiş tarihi aboneliği ezer
    if (license.endsAt && license.endsAt.getTime() < now.getTime()) {
      modules.set(license.moduleKey, { allowed: false, reason: "expired" });
      continue;
    }
    if (state === "locked") {
      modules.set(license.moduleKey, { allowed: false, reason: "expired" });
      continue;
    }

    const limits = (license.limits as Record<string, number>) ?? {};
    modules.set(
      license.moduleKey,
      state === "grace" ? { allowed: true, limits, warning: "grace" } : { allowed: true, limits },
    );
  }

  for (const moduleKey of MODULE_KEYS) {
    if (!modules.has(moduleKey)) modules.set(moduleKey, { allowed: false, reason: "not_licensed" });
  }

  return {
    tenant,
    subscription,
    state,
    modules,
    capabilities: new Set(caps.filter((c) => c.enabled).map((c) => c.capabilityKey)),
  };
}
```

> **Döngüsel bağımlılık notu:** `registry.ts` → `licensing.ts` (tip için) ve `licensing.ts` → modül anahtarları. Bunu kırmak için anahtarlar **ayrı bir dosyada** tutulur (`src/lib/modules/keys.ts`); iki taraf da oradan okur. Step 3.5'te oluşturulur.

- [ ] **Step 6: Senkronizasyon testini ekle — `tests/licensing.test.ts` sonuna**

```typescript
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { MODULE_KEYS } from "@/lib/modules/keys";

describe("kayıt defteri senkronu", () => {
  it("licensing.ts modül anahtarları registry ile aynı", async () => {
    const tenant = await (async () => {
      await resetDatabase();
      const [t] = await dbAdmin.insert(tenants)
        .values({ name: "S", slug: "s", sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
      await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active", currentPeriodEnd: daysFromNow(10) });
      return t!;
    })();

    const access = await getTenantAccess(tenant.id);
    for (const module of MODULE_REGISTRY) {
      expect(access.modules.has(module.key)).toBe(true);
    }
  });

  it("MODULE_KEYS ile MODULE_REGISTRY birebir aynı", () => {
    expect([...MODULE_KEYS].sort()).toEqual(MODULE_REGISTRY.map((m) => m.key).sort());
  });
});
```

- [ ] **Step 7: Test + commit**

Run: `npm test tests/licensing.test.ts`
Expected: `8 passed`

```bash
git add -A && git commit -m "feat: modül kayıt defteri + süreli lisans durum makinesi (trial/active/grace/locked)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Sektör paketi tanımları + kurulum

**Files:**
- Create: `src/lib/sector/packs.ts`, `src/lib/sector/install.ts`, `tests/sector-pack.test.ts`

**Interfaces:**
- Consumes: Task 2 tüm şemalar; Task 4 `istanbulPeriodKey`
- Produces:
  - `SectorPack = { key, name, version, modules, capabilities, terminology, entityFields, numbering, defaultRole }`
  - `SECTOR_PACKS: Record<string, SectorPack>` — `turizm`, `lojistik`, `pilates`, `oto_servis`
  - `applySectorPack(tenantId: string, packKey: string): Promise<void>` — idempotent
  - `getPack(packKey: string): SectorPack`

- [ ] **Step 1: `tests/sector-pack.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { entityFields, numberingSequences, tenantCapabilities, tenantModules, tenants, subscriptions } from "@/db/schema";
import { applySectorPack, getPack, SECTOR_PACKS } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";
import { resetDatabase } from "./setup";

async function seedTenant(pack: string) {
  const [t] = await dbAdmin.insert(tenants)
    .values({ name: "T", slug: `t-${pack}`, sectorPack: pack, sectorPackVersion: "1.0.0" }).returning();
  await dbAdmin.insert(subscriptions).values({ tenantId: t!.id, status: "active" });
  return t!;
}

describe("sektör paketi", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("tanımlı tüm paketler benzersiz anahtara ve içeriğe sahip", () => {
    const keys = Object.keys(SECTOR_PACKS);
    expect(keys).toContain("turizm");
    expect(keys).toContain("lojistik");
    expect(keys).toContain("pilates");
    expect(keys).toContain("oto_servis");
    for (const key of keys) {
      const pack = getPack(key);
      expect(pack.key).toBe(key);
      expect(pack.modules.length).toBeGreaterThan(0);
    }
  });

  it("lojistik paketi irsaliye yeteneğini açar, turizm açmaz", async () => {
    const loj = await seedTenant("lojistik");
    await applySectorPack(loj.id, "lojistik");
    const lojCaps = await dbAdmin.select().from(tenantCapabilities).where(eq(tenantCapabilities.tenantId, loj.id));
    expect(lojCaps.map((c) => c.capabilityKey)).toContain("muhasebe.irsaliye");

    const tur = await seedTenant("turizm");
    await applySectorPack(tur.id, "turizm");
    const turCaps = await dbAdmin.select().from(tenantCapabilities).where(eq(tenantCapabilities.tenantId, tur.id));
    expect(turCaps.map((c) => c.capabilityKey)).not.toContain("muhasebe.irsaliye");
    expect(turCaps.map((c) => c.capabilityKey)).toContain("muhasebe.hakedis");
  });

  it("lojistik paketi irsaliye özel alanlarını kurar", async () => {
    const tenant = await seedTenant("lojistik");
    await applySectorPack(tenant.id, "lojistik");
    const fields = await dbAdmin.select().from(entityFields).where(eq(entityFields.tenantId, tenant.id));
    expect(fields.map((f) => f.fieldKey)).toContain("irsaliye_no");
  });

  it("pilates paketi terminolojiyi değiştirir", async () => {
    const tenant = await seedTenant("pilates");
    await applySectorPack(tenant.id, "pilates");
    const terms = await getTerms(tenant.id, getPack("pilates").terminology);
    expect(terms.t("customer")).toBe("Üye");
    expect(terms.t("appointment")).toBe("Ders");
    expect(terms.t("staff")).toBe("Eğitmen");
  });

  it("oto servis paketi aynı çekirdeği farklı terimlerle kurar", async () => {
    const tenant = await seedTenant("oto_servis");
    await applySectorPack(tenant.id, "oto_servis");
    const terms = await getTerms(tenant.id, getPack("oto_servis").terminology);
    expect(terms.t("customer")).toBe("Araç Sahibi");
    expect(terms.t("appointment")).toBe("Servis Randevusu");
    expect(terms.t("staff")).toBe("Usta");
  });

  it("modülleri ve numaralandırma dizilerini kurar", async () => {
    const tenant = await seedTenant("turizm");
    await applySectorPack(tenant.id, "turizm");
    const mods = await dbAdmin.select().from(tenantModules).where(eq(tenantModules.tenantId, tenant.id));
    expect(mods.map((m) => m.moduleKey)).toContain("muhasebe");
    const seqs = await dbAdmin.select().from(numberingSequences).where(eq(numberingSequences.tenantId, tenant.id));
    expect(seqs.map((s) => s.sequenceKey)).toContain("fatura");
  });

  it("iki kez uygulanınca kayıt çoğaltmaz (idempotent)", async () => {
    const tenant = await seedTenant("lojistik");
    await applySectorPack(tenant.id, "lojistik");
    await applySectorPack(tenant.id, "lojistik");
    const fields = await dbAdmin.select().from(entityFields).where(eq(entityFields.tenantId, tenant.id));
    const keys = fields.map((f) => `${f.entityKey}.${f.fieldKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/sector-pack.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/sector/packs.ts`**

```typescript
export type PackField = {
  entityKey: string;
  fieldKey: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  options?: string[];
  required?: boolean;
  position: number;
};

export type PackSequence = {
  sequenceKey: string;
  prefix: string;
  padding: number;
  periodReset: "none" | "yearly" | "monthly";
};

export type SectorPack = {
  key: string;
  name: string;
  version: string;
  /** Kurulacak modüller */
  modules: readonly string[];
  /** Açılacak alt-yetenekler */
  capabilities: readonly string[];
  /** Terim ezmeleri — sistem varsayılanını ezer */
  terminology: Record<string, string>;
  /** Kurulacak özel alanlar */
  entityFields: readonly PackField[];
  /** Belge numarası dizileri */
  numbering: readonly PackSequence[];
};

const COMMON_NUMBERING: readonly PackSequence[] = [
  { sequenceKey: "fatura", prefix: "FT", padding: 6, periodReset: "yearly" },
];

/**
 * Sektör paketleri. Kod içinde tanımlı: versiyonlanır, tip güvenli, test edilir.
 * YENİ SEKTÖR EKLEMEK = buraya yeni kayıt. Modül kodu değişmez.
 */
export const SECTOR_PACKS: Record<string, SectorPack> = {
  turizm: {
    key: "turizm",
    name: "Turizm / Personel Taşıma",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "filo", "admin"],
    capabilities: ["muhasebe.hakedis", "muhasebe.mutabakat"],
    terminology: {
      customer: "Firma",
      customer_plural: "Firmalar",
      asset: "Araç",
      asset_plural: "Araçlar",
      staff: "Sürücü",
      staff_plural: "Sürücüler",
      service: "Sefer",
      service_plural: "Seferler",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
      { entityKey: "asset", fieldKey: "kapasite", label: "Koltuk Kapasitesi", type: "number", position: 1 },
    ],
    numbering: [...COMMON_NUMBERING, { sequenceKey: "hakedis", prefix: "HK", padding: 6, periodReset: "yearly" }],
  },

  lojistik: {
    key: "lojistik",
    name: "Lojistik / Nakliye",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "filo", "admin"],
    capabilities: ["muhasebe.irsaliye"],
    terminology: {
      customer: "Müşteri",
      customer_plural: "Müşteriler",
      asset: "Araç",
      asset_plural: "Araçlar",
      staff: "Şoför",
      staff_plural: "Şoförler",
      service: "Sevkiyat",
      service_plural: "Sevkiyatlar",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "vergi_no", label: "Vergi No", type: "text", position: 1 },
      { entityKey: "invoice", fieldKey: "irsaliye_no", label: "İrsaliye No", type: "text", required: true, position: 1 },
      { entityKey: "invoice", fieldKey: "sevk_tarihi", label: "Sevk Tarihi", type: "date", position: 2 },
    ],
    numbering: [...COMMON_NUMBERING, { sequenceKey: "irsaliye", prefix: "IR", padding: 6, periodReset: "yearly" }],
  },

  pilates: {
    key: "pilates",
    name: "Pilates / Fitness Stüdyo",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "admin"],
    capabilities: ["randevu.paket", "randevu.bekleme_listesi"],
    terminology: {
      customer: "Üye",
      customer_plural: "Üyeler",
      appointment: "Ders",
      appointment_plural: "Dersler",
      staff: "Eğitmen",
      staff_plural: "Eğitmenler",
      resource: "Salon",
      resource_plural: "Salonlar",
      package: "Ders Paketi",
      package_plural: "Ders Paketleri",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "dogum_tarihi", label: "Doğum Tarihi", type: "date", position: 1 },
      { entityKey: "customer", fieldKey: "saglik_notu", label: "Sağlık Notu", type: "text", position: 2 },
    ],
    numbering: COMMON_NUMBERING,
  },

  oto_servis: {
    key: "oto_servis",
    name: "Oto Servis",
    version: "1.0.0",
    modules: ["dashboard", "muhasebe", "admin"],
    capabilities: ["randevu.parca_stok", "randevu.proforma"],
    terminology: {
      customer: "Araç Sahibi",
      customer_plural: "Araç Sahipleri",
      appointment: "Servis Randevusu",
      appointment_plural: "Servis Randevuları",
      staff: "Usta",
      staff_plural: "Ustalar",
      resource: "Lift",
      resource_plural: "Liftler",
      package: "İş Emri",
      package_plural: "İş Emirleri",
    },
    entityFields: [
      { entityKey: "customer", fieldKey: "plaka", label: "Plaka", type: "text", required: true, position: 1 },
      { entityKey: "customer", fieldKey: "sasi_no", label: "Şasi No", type: "text", position: 2 },
    ],
    numbering: [...COMMON_NUMBERING, { sequenceKey: "is_emri", prefix: "IE", padding: 6, periodReset: "yearly" }],
  },
};
```

- [ ] **Step 4: `src/lib/sector/install.ts`**

```typescript
import { and, eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { entityFields, numberingSequences, tenantCapabilities, tenantModules, tenants } from "@/db/schema";
import { SECTOR_PACKS, type SectorPack } from "./packs";

export { SECTOR_PACKS };
export type { SectorPack };

export function getPack(packKey: string): SectorPack {
  const pack = SECTOR_PACKS[packKey];
  if (!pack) throw new Error(`Unknown sector pack: ${packKey}`);
  return pack;
}

/**
 * Sektör paketini kiracıya uygular. Idempotent — tekrar çağrılabilir,
 * mevcut kayıtları çoğaltmaz (paket sürümü yükseltmede de kullanılır).
 * Provizyon kritik yolu olduğu için dbAdmin (RLS baypas) kullanır.
 */
export async function applySectorPack(tenantId: string, packKey: string): Promise<void> {
  const pack = getPack(packKey);

  for (const moduleKey of pack.modules) {
    const existing = await dbAdmin.select({ id: tenantModules.id }).from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey))).limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(tenantModules).values({ tenantId, moduleKey, status: "active" });
    }
  }

  for (const capabilityKey of pack.capabilities) {
    const existing = await dbAdmin.select({ id: tenantCapabilities.id }).from(tenantCapabilities)
      .where(and(eq(tenantCapabilities.tenantId, tenantId), eq(tenantCapabilities.capabilityKey, capabilityKey))).limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(tenantCapabilities).values({ tenantId, capabilityKey, enabled: true });
    }
  }

  for (const field of pack.entityFields) {
    const existing = await dbAdmin.select({ id: entityFields.id }).from(entityFields)
      .where(and(
        eq(entityFields.tenantId, tenantId),
        eq(entityFields.entityKey, field.entityKey),
        eq(entityFields.fieldKey, field.fieldKey),
      )).limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(entityFields).values({
        tenantId,
        entityKey: field.entityKey,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        options: field.options ?? [],
        required: field.required ?? false,
        position: field.position,
      });
    }
  }

  for (const seq of pack.numbering) {
    const existing = await dbAdmin.select({ id: numberingSequences.id }).from(numberingSequences)
      .where(and(
        eq(numberingSequences.tenantId, tenantId),
        eq(numberingSequences.sequenceKey, seq.sequenceKey),
      )).limit(1);
    if (existing.length === 0) {
      await dbAdmin.insert(numberingSequences).values({
        tenantId,
        sequenceKey: seq.sequenceKey,
        prefix: seq.prefix,
        padding: seq.padding,
        periodReset: seq.periodReset,
      });
    }
  }

  await dbAdmin.update(tenants)
    .set({ sectorPack: pack.key, sectorPackVersion: pack.version, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}
```

- [ ] **Step 5: Test + commit**

Run: `npm test tests/sector-pack.test.ts`
Expected: `7 passed`

```bash
git add -A && git commit -m "feat: sektör paketi motoru — turizm/lojistik/pilates/oto_servis, idempotent kurulum

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Provizyon betiği

**Files:**
- Create: `scripts/provision.ts`, `tests/provision.test.ts`
- Modify: `src/lib/sector/install.ts` (provisionTenant ekle)

**Interfaces:**
- Consumes: Task 5 `hashPassword`; Task 9 `applySectorPack`
- Produces:
  - `provisionTenant(input: { name; slug; sectorPack; ownerEmail; ownerName; ownerPassword; trialDays? }): Promise<{ tenantId: string; userId: string }>`
  - `npm run provision -- --name "X" --slug x --pack turizm --email a@b.com --password ...`

- [ ] **Step 1: `tests/provision.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenantModules, tenants, users } from "@/db/schema";
import { provisionTenant } from "@/lib/sector/install";
import { verifyPassword } from "@/lib/auth";
import { resetDatabase } from "./setup";

describe("provizyon", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("kiracı, owner kullanıcı, abonelik ve paketi tek seferde kurar", async () => {
    const { tenantId, userId } = await provisionTenant({
      name: "Demo Lojistik", slug: "demo-lojistik", sectorPack: "lojistik",
      ownerEmail: "owner@demo.com", ownerName: "Demo Owner", ownerPassword: "Gizli1234!",
      trialDays: 14,
    });

    const [tenant] = await dbAdmin.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(tenant!.sectorPack).toBe("lojistik");

    const [user] = await dbAdmin.select().from(users).where(eq(users.id, userId));
    expect(user!.role).toBe("owner");
    expect(await verifyPassword("Gizli1234!", user!.passwordHash)).toBe(true);

    const [sub] = await dbAdmin.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    expect(sub!.status).toBe("trial");
    expect(sub!.trialEndsAt).not.toBeNull();

    const mods = await dbAdmin.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
    expect(mods.map((m) => m.moduleKey)).toContain("muhasebe");
  });

  it("aynı slug ile ikinci kez provizyon hata verir", async () => {
    const input = {
      name: "X", slug: "ayni", sectorPack: "turizm",
      ownerEmail: "a@x.com", ownerName: "A", ownerPassword: "Gizli1234!",
    };
    await provisionTenant(input);
    await expect(provisionTenant({ ...input, ownerEmail: "b@x.com" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/provision.test.ts`
Expected: FAIL — `provisionTenant` yok

- [ ] **Step 3: `src/lib/sector/install.ts` sonuna `provisionTenant` ekle**

```typescript
import { hashPassword } from "@/lib/auth";
import { subscriptions, users } from "@/db/schema";

export type ProvisionInput = {
  name: string;
  slug: string;
  sectorPack: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
  trialDays?: number;
};

/**
 * Yeni kiracıyı uçtan uca kurar: kiracı + owner kullanıcı + abonelik + sektör paketi.
 * Provizyon çekirdek yetenektir — elle script'le yapılmaz, hep buradan geçer.
 */
export async function provisionTenant(input: ProvisionInput): Promise<{ tenantId: string; userId: string }> {
  const pack = getPack(input.sectorPack);
  const trialDays = input.trialDays ?? 14;

  const [tenant] = await dbAdmin.insert(tenants).values({
    name: input.name,
    slug: input.slug,
    sectorPack: pack.key,
    sectorPackVersion: pack.version,
  }).returning({ id: tenants.id });

  const tenantId = tenant!.id;

  await dbAdmin.insert(subscriptions).values({
    tenantId,
    status: "trial",
    trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
  });

  const [user] = await dbAdmin.insert(users).values({
    tenantId,
    email: input.ownerEmail,
    name: input.ownerName,
    passwordHash: await hashPassword(input.ownerPassword),
    role: "owner",
  }).returning({ id: users.id });

  await applySectorPack(tenantId, pack.key);

  return { tenantId, userId: user!.id };
}
```

- [ ] **Step 4: `scripts/provision.ts`**

```typescript
import "dotenv/config";
import { parseArgs } from "node:util";
import { provisionTenant } from "@/lib/sector/install";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      slug: { type: "string" },
      pack: { type: "string" },
      email: { type: "string" },
      "owner-name": { type: "string" },
      password: { type: "string" },
      "trial-days": { type: "string" },
    },
  });

  const required = ["name", "slug", "pack", "email", "password"] as const;
  for (const key of required) {
    if (!values[key]) {
      console.error(`Missing --${key}`);
      process.exit(1);
    }
  }

  const result = await provisionTenant({
    name: values.name!,
    slug: values.slug!,
    sectorPack: values.pack!,
    ownerEmail: values.email!,
    ownerName: values["owner-name"] ?? values.email!,
    ownerPassword: values.password!,
    trialDays: values["trial-days"] ? Number(values["trial-days"]) : undefined,
  });

  console.log(`Provisioned tenant ${result.tenantId} (owner ${result.userId})`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Provision failed:", error);
  process.exit(1);
});
```

- [ ] **Step 5: Test + gerçek provizyon + commit**

Run:
```bash
npm test tests/provision.test.ts
npm run provision -- --name "Demo Lojistik" --slug demo-lojistik --pack lojistik --email owner@demo.com --owner-name "Demo Owner" --password "Demo1234!"
```
Expected: `2 passed`, ardından `Provisioned tenant <uuid>`

```bash
git add -A && git commit -m "feat: kiracı provizyonu — tek atomik akış, sektör paketi uygulanarak

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Giriş / şifre sıfırlama / davet akışı

**Files:**
- Create: `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/sifre-sifirla/page.tsx`, `src/app/sifre-sifirla/actions.ts`, `src/app/davet/[token]/page.tsx`, `src/app/davet/actions.ts`, `src/app/api/auth/logout/route.ts`, `src/lib/auth/tokens.ts`
- Modify: `src/lib/auth/index.ts`

**Interfaces:**
- Consumes: Task 5 kimlik; Task 4 `tenantTag`
- Produces:
  - `createPasswordReset(email): Promise<string | null>` — token döner (e-posta worker'a bırakılır)
  - `consumePasswordReset(token, newPassword): Promise<boolean>`
  - `createInvite(tenantId, input): Promise<string>`
  - `acceptInvite(token, password): Promise<boolean>`

- [ ] **Step 1: `src/lib/auth/tokens.ts`**

```typescript
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { invites, passwordResets, users, type UserRole } from "@/db/schema";
import { hashPassword } from "./password";
import { hashToken, revokeUserSessions } from "./session";

const RESET_TTL_MS = 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 86_400_000;

/** Kullanıcı yoksa da null döner — e-posta varlığını sızdırmamak için çağıran aynı mesajı gösterir. */
export async function createPasswordReset(email: string): Promise<string | null> {
  const [user] = await dbAdmin.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive) return null;

  const token = randomBytes(32).toString("hex");
  await dbAdmin.insert(passwordResets).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });
  return token;
}

export async function consumePasswordReset(token: string, newPassword: string): Promise<boolean> {
  const [row] = await dbAdmin.select().from(passwordResets)
    .where(and(
      eq(passwordResets.tokenHash, hashToken(token)),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, new Date()),
    )).limit(1);
  if (!row) return false;

  await dbAdmin.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
    .where(eq(users.id, row.userId));
  await dbAdmin.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
  // Şifre değişti — eski oturumlar geçersiz
  await revokeUserSessions(row.tenantId, row.userId);
  return true;
}

export async function createInvite(
  tenantId: string,
  input: { email: string; name: string; role: UserRole },
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await dbAdmin.insert(invites).values({
    tenantId,
    email: input.email,
    name: input.name,
    role: input.role,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return token;
}

export async function acceptInvite(token: string, password: string): Promise<boolean> {
  const [invite] = await dbAdmin.select().from(invites)
    .where(and(
      eq(invites.tokenHash, hashToken(token)),
      isNull(invites.acceptedAt),
      gt(invites.expiresAt, new Date()),
    )).limit(1);
  if (!invite) return false;

  await dbAdmin.insert(users).values({
    tenantId: invite.tenantId,
    email: invite.email,
    name: invite.name,
    role: invite.role,
    passwordHash: await hashPassword(password),
  });
  await dbAdmin.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  return true;
}
```

- [ ] **Step 2: `src/lib/auth/index.ts`'e ekle**

```typescript
export { createPasswordReset, consumePasswordReset, createInvite, acceptInvite } from "./tokens";
```

- [ ] **Step 3: `src/app/login/actions.ts`**

```typescript
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbAdmin } from "@/db/admin";
import { users } from "@/db/schema";
import { AUTH_COOKIE_NAME, createSession, SESSION_DURATION_DAYS, verifyPassword } from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  password: z.string().min(1, "Şifre boş olamaz."),
});

export type LoginState = { error: string } | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const [user] = await dbAdmin.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "E-posta veya şifre hatalı." };
  }

  const token = await createSession(user.id, user.tenantId);
  const store = await cookies();
  store.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_DAYS * 86_400,
  });

  await dbAdmin.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  redirect("/dashboard");
}
```

- [ ] **Step 4: `src/app/login/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Agno Platform</h1>
          <p className="text-sm text-neutral-500">Hesabınıza giriş yapın</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">E-posta</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900" />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Şifre</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900" />
        </div>

        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>

        <Link href="/sifre-sifirla" className="block text-center text-xs text-neutral-500 hover:text-neutral-900">
          Şifremi unuttum
        </Link>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: `src/app/api/auth/logout/route.ts`**

```typescript
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, destroySessionByToken } from "@/lib/auth";

export async function POST(): Promise<NextResponse> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE_NAME)?.value;
  if (token) await destroySessionByToken(token);
  store.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: `src/app/sifre-sifirla/actions.ts` ve `page.tsx`**

`actions.ts`:
```typescript
"use server";

import { z } from "zod";
import { consumePasswordReset, createPasswordReset } from "@/lib/auth";
import { enqueueEmail } from "@/lib/queue";

const RequestSchema = z.object({ email: z.string().email("Geçerli bir e-posta adresi girin.") });
const ResetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

export type ResetState = { error: string } | { ok: string } | null;

export async function requestResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = RequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const token = await createPasswordReset(parsed.data.email);
  if (token) {
    await enqueueEmail({
      to: parsed.data.email,
      subject: "Şifre sıfırlama",
      body: `Şifrenizi sıfırlamak için: ${process.env.APP_URL}/sifre-sifirla?token=${token}`,
    });
  }
  // Hesap varlığını sızdırma — her durumda aynı mesaj
  return { ok: "Eğer bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi." };
}

export async function performResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = ResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const success = await consumePasswordReset(parsed.data.token, parsed.data.password);
  return success
    ? { ok: "Şifreniz güncellendi. Giriş yapabilirsiniz." }
    : { error: "Bağlantı geçersiz veya süresi dolmuş." };
}
```

`page.tsx`:
```tsx
"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { performResetAction, requestResetAction, type ResetState } from "./actions";

export default function ResetPage() {
  const token = useSearchParams().get("token");
  const action = token ? performResetAction : requestResetAction;
  const [state, formAction, pending] = useActionState<ResetState, FormData>(action, null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8">
        <h1 className="text-lg font-semibold">{token ? "Yeni şifre belirle" : "Şifremi unuttum"}</h1>

        {token ? (
          <>
            <input type="hidden" name="token" value={token} />
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium">Yeni şifre</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </div>
          </>
        ) : (
          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium">E-posta</label>
            <input id="email" name="email" type="email" autoComplete="username" required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
        )}

        {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {state && "ok" in state ? <p className="text-sm text-green-700">{state.ok}</p> : null}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Gönderiliyor..." : token ? "Şifreyi güncelle" : "Sıfırlama bağlantısı gönder"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: `src/app/davet/actions.ts` ve `src/app/davet/[token]/page.tsx`**

`actions.ts`:
```typescript
"use server";

import { z } from "zod";
import { acceptInvite } from "@/lib/auth";

const AcceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});

export type InviteState = { error: string } | { ok: string } | null;

export async function acceptInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = AcceptSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const success = await acceptInvite(parsed.data.token, parsed.data.password);
  return success
    ? { ok: "Hesabınız oluşturuldu. Giriş yapabilirsiniz." }
    : { error: "Davet geçersiz, kullanılmış veya süresi dolmuş." };
}
```

`[token]/page.tsx`:
```tsx
"use client";

import Link from "next/link";
import { use, useActionState } from "react";
import { acceptInviteAction, type InviteState } from "../actions";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, formAction, pending] = useActionState<InviteState, FormData>(acceptInviteAction, null);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8">
        <h1 className="text-lg font-semibold">Hesabınızı oluşturun</h1>
        <p className="text-sm text-neutral-500">Devam etmek için bir şifre belirleyin.</p>

        <input type="hidden" name="token" value={token} />
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">Şifre</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        </div>

        {state && "error" in state ? <p className="text-sm text-red-600">{state.error}</p> : null}
        {state && "ok" in state ? (
          <div className="space-y-2">
            <p className="text-sm text-green-700">{state.ok}</p>
            <Link href="/login" className="block text-center text-sm font-medium text-neutral-900 underline">
              Giriş yap
            </Link>
          </div>
        ) : null}

        <button type="submit" disabled={pending}
          className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Oluşturuluyor..." : "Hesabı oluştur"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Build doğrula + commit**

Run: `npm run build`
Expected: `EXIT=0` (Task 12'de `@/lib/queue` yazılacak — bu adımda geçici olarak `enqueueEmail` stub'ı `src/lib/queue.ts` içine konur)

`src/lib/queue.ts` (geçici stub, Task 12'de gerçek BullMQ ile değişir):
```typescript
export type EmailJob = { to: string; subject: string; body: string };

export async function enqueueEmail(job: EmailJob): Promise<void> {
  console.log("[queue] email queued (stub):", job.to, job.subject);
}
```

```bash
git add -A && git commit -m "feat: giriş, çıkış, şifre sıfırlama ve davet token akışları

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Worker + kuyruk + lisans süre kontrolü

**Files:**
- Create: `worker/index.ts`, `worker/jobs/license-expiry.ts`, `worker/jobs/email.ts`
- Modify: `src/lib/queue.ts` (gerçek BullMQ)
- Create: `tests/license-expiry.test.ts`

**Interfaces:**
- Consumes: Task 8 lisans; Task 2 şemalar
- Produces:
  - `enqueueEmail(job: EmailJob): Promise<void>` — BullMQ
  - `runLicenseExpiryCheck(now?: Date): Promise<{ warned: number; expired: number }>`
  - `npm run worker`

- [ ] **Step 1: `tests/license-expiry.test.ts`**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants } from "@/db/schema";
import { runLicenseExpiryCheck } from "../worker/jobs/license-expiry";
import { resetDatabase } from "./setup";

async function seedTenant(slug: string, periodEnd: Date, status: "active" | "trial" = "active") {
  const [t] = await dbAdmin.insert(tenants)
    .values({ name: slug, slug, sectorPack: "turizm", sectorPackVersion: "1.0.0" }).returning();
  await dbAdmin.insert(subscriptions)
    .values({ tenantId: t!.id, status, currentPeriodEnd: periodEnd, graceDays: "7" });
  return t!;
}

describe("lisans süre kontrolü", () => {
  beforeEach(async () => { await resetDatabase(); });

  it("grace süresi biten aboneliği expired yapar", async () => {
    const tenant = await seedTenant("bitmis", new Date(Date.now() - 30 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.expired).toBe(1);

    const [sub] = await dbAdmin.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.id));
    expect(sub!.status).toBe("expired");
  });

  it("dönemi devam eden aboneliğe dokunmaz", async () => {
    const tenant = await seedTenant("aktif", new Date(Date.now() + 20 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.expired).toBe(0);

    const [sub] = await dbAdmin.select().from(subscriptions).where(eq(subscriptions.tenantId, tenant.id));
    expect(sub!.status).toBe("active");
  });

  it("yaklaşan bitişleri uyarı olarak sayar", async () => {
    await seedTenant("yaklasan", new Date(Date.now() + 5 * 86_400_000));
    const result = await runLicenseExpiryCheck();
    expect(result.warned).toBe(1);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/license-expiry.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/lib/queue.ts` — gerçek BullMQ**

```typescript
import { Queue } from "bullmq";
import IORedis from "ioredis";

export type EmailJob = { to: string; subject: string; body: string };

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6380", {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue<EmailJob>("email", { connection });

export async function enqueueEmail(job: EmailJob): Promise<void> {
  await emailQueue.add("send", job, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
```

- [ ] **Step 4: `worker/jobs/license-expiry.ts`**

```typescript
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { dbAdmin } from "@/db/admin";
import { subscriptions, tenants, users } from "@/db/schema";
import { enqueueEmail } from "@/lib/queue";

const WARN_WINDOW_DAYS = 15;

/**
 * Günlük çalışır. Grace süresi dolan abonelikleri expired yapar,
 * bitişi yaklaşanlar için kiracı sahibine uyarı kuyruğa atar.
 */
export async function runLicenseExpiryCheck(now: Date = new Date()): Promise<{ warned: number; expired: number }> {
  const rows = await dbAdmin
    .select({
      subId: subscriptions.id,
      tenantId: subscriptions.tenantId,
      status: subscriptions.status,
      periodEnd: subscriptions.currentPeriodEnd,
      graceDays: subscriptions.graceDays,
      tenantName: tenants.name,
    })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(and(isNotNull(subscriptions.currentPeriodEnd), eq(tenants.isActive, true)));

  let warned = 0;
  let expired = 0;

  for (const row of rows) {
    if (!row.periodEnd || row.status === "expired" || row.status === "suspended") continue;

    const graceEnd = row.periodEnd.getTime() + Number(row.graceDays) * 86_400_000;

    if (now.getTime() > graceEnd) {
      await dbAdmin.update(subscriptions)
        .set({ status: "expired", updatedAt: now })
        .where(eq(subscriptions.id, row.subId));
      expired += 1;
      continue;
    }

    const daysLeft = Math.ceil((row.periodEnd.getTime() - now.getTime()) / 86_400_000);
    if (daysLeft >= 0 && daysLeft <= WARN_WINDOW_DAYS) {
      const owners = await dbAdmin.select({ email: users.email }).from(users)
        .where(and(eq(users.tenantId, row.tenantId), eq(users.role, "owner"), eq(users.isActive, true)));
      for (const owner of owners) {
        await enqueueEmail({
          to: owner.email,
          subject: `${row.tenantName} — aboneliğinizin bitişine ${daysLeft} gün kaldı`,
          body: `Aboneliğiniz ${row.periodEnd.toLocaleDateString("tr-TR")} tarihinde sona eriyor. Kesintisiz kullanım için lütfen yenileyin.`,
        });
      }
      warned += 1;
    }
  }

  return { warned, expired };
}
```

- [ ] **Step 5: `worker/jobs/email.ts` ve `worker/index.ts`**

`worker/jobs/email.ts`:
```typescript
import type { EmailJob } from "@/lib/queue";

/** Gerçek gönderim sağlayıcısı sonraki planda bağlanır. Şimdilik log. */
export async function sendEmail(job: EmailJob): Promise<void> {
  console.log(`[email] to=${job.to} subject="${job.subject}"`);
}
```

`worker/index.ts`:
```typescript
import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import type { EmailJob } from "@/lib/queue";
import { sendEmail } from "./jobs/email";
import { runLicenseExpiryCheck } from "./jobs/license-expiry";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6380", {
  maxRetriesPerRequest: null,
});

new Worker<EmailJob>("email", async (job) => sendEmail(job.data), { connection, concurrency: 5 });

const ONE_HOUR_MS = 60 * 60 * 1000;

async function licenseLoop(): Promise<void> {
  try {
    const result = await runLicenseExpiryCheck();
    console.log(`[license] warned=${result.warned} expired=${result.expired}`);
  } catch (error: unknown) {
    console.error("[license] check failed:", error);
  }
  setTimeout(() => void licenseLoop(), ONE_HOUR_MS);
}

console.log("Agno Platform worker started");
void licenseLoop();
```

- [ ] **Step 6: Test + worker'ı çalıştır + commit**

Run:
```bash
npm test tests/license-expiry.test.ts
timeout 5 npm run worker || true
```
Expected: `3 passed`; worker `Agno Platform worker started` yazar

```bash
git add -A && git commit -m "feat: BullMQ worker, e-posta kuyruğu, lisans süre kontrolü cron'u

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Kabuk UI — sidebar, topbar, dashboard, kilit ekranı

**Files:**
- Create: `src/components/layout/sidebar.tsx`, `src/components/layout/topbar.tsx`, `src/components/layout/grace-banner.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/kilitli/page.tsx`

**Interfaces:**
- Consumes: Task 8 `getTenantAccess`/`buildNavigation`/`visibleChildren`; Task 6 `getTerms`; Task 9 `getPack`; Task 5 `requireAuth`
- Produces: `/dashboard` altında terminoloji ve lisans farkında kabuk

- [ ] **Step 1: `src/components/layout/sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  children: { label: string; href: string }[];
};

function Icon({ name }: { name: string }) {
  const Component = (Icons as unknown as Record<string, React.ElementType>)[name] ?? Icons.Circle;
  return <Component className="h-4 w-4" />;
}

export function Sidebar({ items, tenantName }: { items: NavItem[]; tenantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-4">
        <p className="text-sm font-semibold">Agno Platform</p>
        <p className="truncate text-xs text-neutral-500">{tenantName}</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <div key={item.key}>
            <Link href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100",
                pathname === item.href && "bg-neutral-900 text-white hover:bg-neutral-900",
              )}>
              <Icon name={item.icon} />
              {item.label}
            </Link>
            {item.children.length > 0 ? (
              <div className="ml-4 mt-1 space-y-0.5 border-l border-neutral-200 pl-3">
                {item.children.map((child) => (
                  <Link key={child.href} href={child.href}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100",
                      pathname === child.href && "font-medium text-neutral-900",
                    )}>
                    {child.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: `src/components/layout/topbar.tsx` ve `grace-banner.tsx`**

`topbar.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";

export function Topbar({ name, email }: { name: string; email: string }) {
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6">
      <div />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium leading-tight">{name}</p>
          <p className="text-xs leading-tight text-neutral-500">{email}</p>
        </div>
        <button onClick={handleLogout}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
          Çıkış
        </button>
      </div>
    </header>
  );
}
```

`grace-banner.tsx`:
```tsx
export function GraceBanner({ periodEnd }: { periodEnd: Date | null }) {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      Aboneliğinizin dönemi
      {periodEnd ? ` ${periodEnd.toLocaleDateString("tr-TR")} tarihinde ` : " "}
      sona erdi. Ödemeniz işlenene kadar erişiminiz kısa süre daha açık kalacak.
    </div>
  );
}
```

- [ ] **Step 3: `src/app/(app)/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { GraceBanner } from "@/components/layout/grace-banner";
import { Sidebar, type NavItem } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation, visibleChildren } from "@/lib/modules/registry";
import { getPack } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);

  if (access.state === "locked") redirect("/kilitli");

  const pack = getPack(access.tenant.sectorPack);
  const terms = await getTerms(session.tenantId, pack.terminology);

  const items: NavItem[] = buildNavigation(session.role, access).map((module) => ({
    key: module.key,
    label: terms.t(`module.${module.key}`) === `module.${module.key}` ? module.label : terms.t(`module.${module.key}`),
    icon: module.icon,
    href: module.href,
    children: visibleChildren(module, access).map((c) => ({ label: c.label, href: c.href })),
  }));

  return (
    <div className="flex h-screen">
      <Sidebar items={items} tenantName={access.tenant.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={session.name} email={session.email} />
        {access.state === "grace" ? <GraceBanner periodEnd={access.subscription.currentPeriodEnd} /> : null}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `src/app/(app)/dashboard/page.tsx` ve `src/app/kilitli/page.tsx`**

> **Konum dikkat:** `kilitli` sayfası `(app)` grubunun **dışında** — `src/app/kilitli/page.tsx`. Çünkü `(app)/layout.tsx` `locked` durumunda oraya yönlendiriyor; grup içinde olsaydı sonsuz yönlendirme döngüsü olurdu.

`dashboard/page.tsx`:
```tsx
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { buildNavigation } from "@/lib/modules/registry";
import { getPack } from "@/lib/sector/install";

export default async function DashboardPage() {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);
  const pack = getPack(access.tenant.sectorPack);
  const modules = buildNavigation(session.role, access).filter((m) => m.key !== "dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Merhaba, {session.name}</h1>
        <p className="text-sm text-neutral-500">
          {pack.name} · {new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <Link key={module.key} href={module.href}
            className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-neutral-400">
            <p className="font-medium">{module.label}</p>
            <p className="mt-1 text-sm text-neutral-500">Modüle git</p>
          </Link>
        ))}
        {modules.length === 0 ? (
          <p className="text-sm text-neutral-500">Henüz size açılmış bir modül yok.</p>
        ) : null}
      </div>
    </div>
  );
}
```

`src/app/kilitli/page.tsx`:
```tsx
import { requireAuth } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";

export default async function LockedPage() {
  const session = await requireAuth();
  const access = await getTenantAccess(session.tenantId);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-3 rounded-2xl border border-neutral-200 bg-white p-8 text-center">
        <h1 className="text-lg font-semibold">Erişiminiz kısıtlandı</h1>
        <p className="text-sm text-neutral-600">
          {access.tenant.name} için abonelik süresi sona erdi. Verileriniz korunuyor;
          aboneliğiniz yenilendiğinde her şey olduğu gibi geri gelecek.
        </p>
        <p className="text-sm text-neutral-500">Lütfen bizimle iletişime geçin.</p>
        <form action="/api/auth/logout" method="POST">
          <button type="submit" className="mt-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm">
            Çıkış yap
          </button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Yönlendirme döngüsü olmadığını doğrula**

Run:
```bash
test -f src/app/kilitli/page.tsx && echo "konum dogru"
test ! -d "src/app/(app)/kilitli" && echo "grup icinde kopya yok"
```
Expected: `konum dogru` ve `grup icinde kopya yok`

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: `EXIT=0`

```bash
git add -A && git commit -m "feat: kabuk UI — lisans ve terminoloji farkında sidebar, grace bandı, kilit ekranı

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Yönetim modülü — kullanıcı, terminoloji, alan

**Files:**
- Create: `src/modules/admin/queries.ts`, `src/modules/admin/actions.ts`, `src/modules/admin/validators.ts`, `src/app/(app)/admin/page.tsx`, `src/app/(app)/admin/users/page.tsx`, `src/app/(app)/admin/terminoloji/page.tsx`, `src/app/(app)/admin/alanlar/page.tsx`, `src/lib/audit.ts`

**Interfaces:**
- Consumes: Task 3 `withTenant`; Task 5 `requirePermission`; Task 6 terminoloji; Task 7 alanlar; Task 11 `createInvite`
- Produces:
  - `writeAuditLog(input): Promise<void>`
  - `listUsers(tenantId)`, `listOverrides(tenantId)`, `listAllFields(tenantId)`
  - `inviteUserAction`, `setTermAction`, `changeRoleAction`

- [ ] **Step 1: `src/lib/audit.ts`**

```typescript
import { auditLogs } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function writeAuditLog(input: {
  tenantId: string;
  userId: string | null;
  event: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await withTenant(input.tenantId, (tx) =>
    tx.insert(auditLogs).values({
      tenantId: input.tenantId,
      userId: input.userId,
      event: input.event,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    }),
  );
}
```

- [ ] **Step 2: `src/modules/admin/queries.ts`**

```typescript
import { asc, eq } from "drizzle-orm";
import { entityFields, terminologyOverrides, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function listUsers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.select({
      id: users.id, email: users.email, name: users.name,
      role: users.role, isActive: users.isActive,
    }).from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(users.name)),
  );
}

export async function listOverrides(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.select().from(terminologyOverrides)
      .where(eq(terminologyOverrides.tenantId, tenantId))
      .orderBy(asc(terminologyOverrides.termKey)),
  );
}

export async function listAllFields(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.select().from(entityFields)
      .where(eq(entityFields.tenantId, tenantId))
      .orderBy(asc(entityFields.entityKey), asc(entityFields.position)),
  );
}
```

- [ ] **Step 3: `src/modules/admin/validators.ts` ve `actions.ts`**

`validators.ts`:
```typescript
import { z } from "zod";

export const InviteSchema = z.object({
  email: z.string().email("Geçerli bir e-posta adresi girin."),
  name: z.string().min(2, "İsim en az 2 karakter olmalı."),
  role: z.enum(["owner", "admin", "manager", "member", "viewer"]),
});

export const SetTermSchema = z.object({
  termKey: z.string().min(1, "Terim anahtarı gerekli."),
  value: z.string().min(1, "Değer boş olamaz."),
});
```

`actions.ts`:
```typescript
"use server";

import { revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { terminologyOverrides } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createInvite, requirePermission } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { tenantTag } from "@/lib/cache";
import { enqueueEmail } from "@/lib/queue";
import { InviteSchema, SetTermSchema } from "./validators";

export type ActionState = { error: string } | { ok: string } | null;

export async function inviteUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("users.manage");

  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const token = await createInvite(session.tenantId, parsed.data);
  await enqueueEmail({
    to: parsed.data.email,
    subject: "Agno Platform davetiniz",
    body: `Hesabınızı oluşturmak için: ${process.env.APP_URL}/davet/${token}`,
  });
  await writeAuditLog({
    tenantId: session.tenantId, userId: session.userId,
    event: "user.invited", entityType: "user",
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidateTag(tenantTag(session.tenantId, "users"));
  return { ok: "Davet gönderildi." };
}

export async function setTermAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("terminology.manage");

  const parsed = SetTermSchema.safeParse({
    termKey: formData.get("termKey"),
    value: formData.get("value"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, async (tx) => {
    const existing = await tx.select({ id: terminologyOverrides.id }).from(terminologyOverrides)
      .where(and(
        eq(terminologyOverrides.tenantId, session.tenantId),
        eq(terminologyOverrides.termKey, parsed.data.termKey),
      )).limit(1);

    if (existing.length > 0) {
      await tx.update(terminologyOverrides).set({ value: parsed.data.value })
        .where(eq(terminologyOverrides.id, existing[0]!.id));
    } else {
      await tx.insert(terminologyOverrides).values({
        tenantId: session.tenantId, termKey: parsed.data.termKey, value: parsed.data.value,
      });
    }
  });

  await writeAuditLog({
    tenantId: session.tenantId, userId: session.userId,
    event: "terminology.changed", metadata: { ...parsed.data },
  });

  revalidateTag(tenantTag(session.tenantId, "terminology"));
  return { ok: "Terim güncellendi." };
}
```

- [ ] **Step 4: Yönetim sayfaları**

`src/app/(app)/admin/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/users");
}
```

`src/app/(app)/admin/users/page.tsx`:
```tsx
import { requirePermission } from "@/lib/auth";
import { listUsers } from "@/modules/admin/queries";

const ROLE_LABELS: Record<string, string> = {
  owner: "Sahip", admin: "Yönetici", manager: "Müdür", member: "Üye", viewer: "İzleyici",
};

export default async function AdminUsersPage() {
  const session = await requirePermission("users.manage");
  const rows = await listUsers(session.tenantId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Kullanıcılar</h1>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {rows.map((user) => (
          <div key={user.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-neutral-500">{user.email}</p>
            </div>
            <span className="text-xs text-neutral-600">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`src/app/(app)/admin/terminoloji/page.tsx`:
```tsx
import { requirePermission } from "@/lib/auth";
import { getTenantAccess } from "@/lib/licensing";
import { getPack } from "@/lib/sector/install";
import { getTerms } from "@/lib/sector/terminology";

export default async function AdminTerminologyPage() {
  const session = await requirePermission("terminology.manage");
  const access = await getTenantAccess(session.tenantId);
  const pack = getPack(access.tenant.sectorPack);
  const terms = await getTerms(session.tenantId, pack.terminology);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Terimler</h1>
      <p className="text-sm text-neutral-500">
        {pack.name} paketinden gelen terimler. Kendi sözcüklerinizle değiştirebilirsiniz.
      </p>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {Object.entries(terms.all).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between px-5 py-2.5">
            <span className="text-xs text-neutral-500">{key}</span>
            <span className="text-sm">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`src/app/(app)/admin/alanlar/page.tsx`:
```tsx
import { requirePermission } from "@/lib/auth";
import { listAllFields } from "@/modules/admin/queries";

const TYPE_LABELS: Record<string, string> = {
  text: "Metin", number: "Sayı", date: "Tarih", select: "Seçim", boolean: "Evet/Hayır",
};

export default async function AdminFieldsPage() {
  const session = await requirePermission("fields.manage");
  const fields = await listAllFields(session.tenantId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Özel Alanlar</h1>
      <p className="text-sm text-neutral-500">Sektör paketinizle gelen ve size özel eklenen alanlar.</p>
      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium">{field.label}</p>
              <p className="text-xs text-neutral-500">
                {field.entityKey}.{field.fieldKey}
                {field.required ? " · zorunlu" : ""}
              </p>
            </div>
            <span className="text-xs text-neutral-600">{TYPE_LABELS[field.type] ?? field.type}</span>
          </div>
        ))}
        {fields.length === 0 ? (
          <p className="px-5 py-3 text-sm text-neutral-500">Tanımlı özel alan yok.</p>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Build + tüm testler + commit**

Run: `npm run build && npm test`
Expected: build `EXIT=0`, tüm testler geçer

```bash
git add -A && git commit -m "feat: yönetim modülü — kullanıcı, terminoloji, özel alan ekranları + audit

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: E2E — iki sektör aynı kod, farklı yüz

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/sector.spec.ts`, `scripts/seed-e2e.ts`

**Interfaces:**
- Consumes: Task 10 `provisionTenant`
- Produces: Aynı kod tabanının iki sektörde farklı davrandığını kanıtlayan E2E

- [ ] **Step 1: `scripts/seed-e2e.ts`**

```typescript
import "dotenv/config";
import { provisionTenant } from "@/lib/sector/install";

async function main(): Promise<void> {
  await provisionTenant({
    name: "E2E Lojistik", slug: "e2e-lojistik", sectorPack: "lojistik",
    ownerEmail: "lojistik@e2e.test", ownerName: "Lojistik Owner", ownerPassword: "E2eTest1234!",
  });
  await provisionTenant({
    name: "E2E Pilates", slug: "e2e-pilates", sectorPack: "pilates",
    ownerEmail: "pilates@e2e.test", ownerName: "Pilates Owner", ownerPassword: "E2eTest1234!",
  });
  console.log("E2E tenants provisioned");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: `playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: `tests/e2e/sector.spec.ts`**

```typescript
import { expect, test } from "@playwright/test";

async function login(page: import("@playwright/test").Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("lojistik kiracısı irsaliye menüsünü görür", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await expect(page.getByText("Lojistik / Nakliye")).toBeVisible();
  await page.getByRole("link", { name: "Muhasebe", exact: true }).click();
  await expect(page.getByRole("link", { name: "İrsaliyeler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Hakedişler" })).toHaveCount(0);
});

test("pilates kiracısı irsaliye görmez, terimleri farklıdır", async ({ page }) => {
  await login(page, "pilates@e2e.test");
  await expect(page.getByText("Pilates / Fitness Stüdyo")).toBeVisible();
  await page.goto("/admin/terminoloji");
  await expect(page.getByText("Üye", { exact: true })).toBeVisible();
  await expect(page.getByText("Eğitmen", { exact: true })).toBeVisible();
});

test("lojistik kiracısında özel alan irsaliye_no tanımlıdır", async ({ page }) => {
  await login(page, "lojistik@e2e.test");
  await page.goto("/admin/alanlar");
  await expect(page.getByText("invoice.irsaliye_no")).toBeVisible();
  await expect(page.getByText("İrsaliye No")).toBeVisible();
});
```

- [ ] **Step 4: Seed + E2E çalıştır**

Run:
```bash
npm run db:push
npx tsx scripts/seed-e2e.ts
npx playwright install chromium
npm run test:e2e
```
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: E2E — aynı kod tabanı iki sektörde farklı yüz gösteriyor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Prod imajı + VPS deploy

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`

**Ön koşul (Kayra yapacak):** `platform.agno.digital` A kaydı → `93.177.102.72`

- [ ] **Step 1: `.dockerignore`**

```
node_modules
.next
.git
tests
playwright-report
test-results
*.log
.env
```

- [ ] **Step 2: `Dockerfile`**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

- [ ] **Step 3: `docker-compose.prod.yml`**

```yaml
name: agno-platform

services:
  app:
    build: .
    image: agno-platform:latest
    container_name: agno_platform_app
    restart: unless-stopped
    env_file: .env.production
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    networks: [coolify]
    labels:
      - traefik.enable=true
      - traefik.docker.network=coolify
      - traefik.http.routers.agno-platform-http.entryPoints=http
      - traefik.http.routers.agno-platform-http.rule=Host(`platform.agno.digital`)
      - traefik.http.routers.agno-platform-http.middlewares=agno-platform-redir
      - traefik.http.middlewares.agno-platform-redir.redirectscheme.scheme=https
      - traefik.http.routers.agno-platform-https.entryPoints=https
      - traefik.http.routers.agno-platform-https.rule=Host(`platform.agno.digital`)
      - traefik.http.routers.agno-platform-https.tls=true
      - traefik.http.routers.agno-platform-https.tls.certresolver=letsencrypt
      - traefik.http.services.agno-platform.loadbalancer.server.port=3000

  worker:
    build: .
    image: agno-platform:latest
    container_name: agno_platform_worker
    restart: unless-stopped
    env_file: .env.production
    command: ["node", "--experimental-strip-types", "worker/index.ts"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    networks: [coolify]

  postgres:
    image: postgres:16-alpine
    container_name: agno_platform_pg
    restart: unless-stopped
    environment:
      POSTGRES_USER: agno_owner
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: agno_platform
    volumes: [pg_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agno_owner"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks: [coolify]

  redis:
    image: redis:7-alpine
    container_name: agno_platform_redis
    restart: unless-stopped
    volumes: [redis_data:/data]
    networks: [coolify]

volumes:
  pg_data:
  redis_data:

networks:
  coolify:
    external: true
```

> **Not:** Worker `tsx` yerine Node'un tip sıyırma modunu kullanamaz (`@/` alias). Prod imajında worker için `tsx` gerekir — `Dockerfile` runner aşamasına `RUN npm i -g tsx` eklenir ve komut `["tsx", "worker/index.ts"]` olur.

- [ ] **Step 4: Dockerfile'ı worker için düzelt**

`Dockerfile` runner aşamasına ekle (USER satırından ÖNCE):
```dockerfile
RUN npm install -g tsx
COPY --from=builder --chown=nextjs:nodejs /app/worker ./worker
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
```

`docker-compose.prod.yml` worker komutunu değiştir:
```yaml
    command: ["tsx", "worker/index.ts"]
```

- [ ] **Step 5: VPS'e gönder ve ortamı hazırla**

Run:
```bash
ssh agno-new-vps 'mkdir -p /data/agno-platform'
rsync -az --exclude node_modules --exclude .next --exclude .git \
  ~/claude/agno-platform/ agno-new-vps:/data/agno-platform/
ssh agno-new-vps 'cd /data/agno-platform && \
  PGPASS=$(openssl rand -hex 20) && APPPASS=$(openssl rand -hex 20) && \
  cat > .env.production <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://agno_app:${APPPASS}@postgres:5432/agno_platform
DATABASE_ADMIN_URL=postgresql://agno_owner:${PGPASS}@postgres:5432/agno_platform
REDIS_URL=redis://redis:6379
AUTH_COOKIE_NAME=agno_platform_session
APP_URL=https://platform.agno.digital
EOF
  echo "POSTGRES_PASSWORD=${PGPASS}" > .env
  echo "APP_ROLE_PASSWORD=${APPPASS}" >> .env
  echo "env hazır"'
```
Expected: `env hazır`

- [ ] **Step 6: Build, başlat, şema + RLS uygula**

Run:
```bash
ssh agno-new-vps 'cd /data/agno-platform && \
  docker compose -f docker-compose.prod.yml build && \
  docker compose -f docker-compose.prod.yml up -d postgres redis && sleep 15 && \
  APPPASS=$(grep APP_ROLE_PASSWORD .env | cut -d= -f2) && \
  docker exec agno_platform_pg psql -U agno_owner -d agno_platform -c "CREATE ROLE agno_app LOGIN PASSWORD '"'"'${APPPASS}'"'"';" && \
  docker exec agno_platform_pg psql -U agno_owner -d agno_platform -c "GRANT USAGE ON SCHEMA public TO agno_app;"'

ssh agno-new-vps 'cd /data/agno-platform && \
  docker run --rm --network coolify -v /data/agno-platform:/w -w /w --env-file .env.production \
  node:22-alpine sh -c "npm ci --silent && npm run db:push"'

ssh agno-new-vps 'cd /data/agno-platform && \
  docker exec -i agno_platform_pg psql -U agno_owner -d agno_platform < drizzle/9000_rls.sql && \
  docker compose -f docker-compose.prod.yml up -d'
```
Expected: `CREATE ROLE`, `Changes applied`, RLS policy'leri kurulur, tüm servisler `Up`

- [ ] **Step 7: İlk kiracıyı provizyonla ve doğrula**

Run:
```bash
ssh agno-new-vps 'cd /data/agno-platform && \
  docker run --rm --network coolify -v /data/agno-platform:/w -w /w --env-file .env.production \
  node:22-alpine sh -c "npm run provision -- --name \"Demo Lojistik\" --slug demo-lojistik --pack lojistik --email owner@demo.com --owner-name \"Demo Owner\" --password \"Demo1234!\""'

curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://platform.agno.digital/login
```
Expected: `Provisioned tenant <uuid>`, `HTTP 200`

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: prod imajı, worker servisi, Traefik compose — platform.agno.digital

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faz 1 Tamamlanma Kriterleri

- [ ] `platform.agno.digital` üzerinden giriş yapılabiliyor
- [ ] **RLS testi yeşil:** tenant context'i olmadan uygulama rolü sıfır satır görüyor
- [ ] **Sektör kanıtı:** lojistik kiracısı "İrsaliyeler" görüyor, pilates kiracısı görmüyor; terimler farklı
- [ ] Sol menü lisans + izin + alt-yetenek üçlü süzgecinden geçiyor
- [ ] Grace durumunda uyarı bandı, locked durumunda kilit ekranı çıkıyor
- [ ] `npm run provision` ile yeni kiracı tek komutla kuruluyor, paketi uygulanıyor
- [ ] Worker ayakta, lisans süre kontrolü saatlik çalışıyor
- [ ] Belge numarası boşluksuz artıyor
- [ ] `npm test` ve `npm run test:e2e` yeşil

---

## Sonraki Planlar

| Plan | İçerik |
|---|---|
| `plan-2-faturalama.md` | Fatura, tahsilat, cari, yaşlandırma, operatör paneli (`/platform`), impersonation, 2FA |
| `plan-3-modul-muhasebe.md` | Cari/fatura çekirdeği + turizm paketi (hakediş/çetele/mutabakat) + lojistik paketi (irsaliye/sevkiyat) |
| `plan-4-modul-randevu.md` | Randevu-hizmet çekirdeği + pilates (PSYS) + oto servis (OSYS) paketleri |
| `plan-5-modul-operasyon.md` | Giriş kontrol, sefer, güzergah, rota planlama, operasyon haritası |
| `plan-6-modul-filo.md` | Araç, bakım, kaza/ceza/arıza/sigorta/lastik, GPS, yakıt kartı |
| `plan-7-modul-depo.md` | Stok giriş/çıkış, sayım, varyant, barkod |
| `plan-8-kvkk.md` | Veri dışa aktarma, kalıcı silme, saklama süresi, DPA akışı |
