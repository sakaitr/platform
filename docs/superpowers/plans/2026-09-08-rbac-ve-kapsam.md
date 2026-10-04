# RBAC Genişletme + Kapsam Seçici (Faz 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Çekirdeği aycanops'un 45 sayfalık modül yükünü taşıyacak yetki modeline geçirmek: sabit 5 rol yerine kiracı bazlı tanımlı roller, `kaynak:eylem` desenli izin anahtarları ve kullanıcı bazlı firma kapsamı.

**Architecture:** İzinler kodda **katalog** olarak tanımlı (`PERMISSION_CATALOG`), roller **veritabanında** kiracı bazlı (`roles` + `role_permissions`), kullanıcı role FK ile bağlı. Sektör paketi kurulumda varsayılan rolleri de yazar. Kapsam (hangi firmalar) `user_scopes` tablosunda; `withTenant` içine ikinci bir süzgeç katmanı olarak girer, RLS'in üstüne biner.

**Tech Stack:** Next.js 16 · TypeScript strict · PostgreSQL 16 · Drizzle ORM · Zod · Vitest · Playwright

## Global Constraints

- Node 22 LTS, TypeScript `strict: true`, `any` yasak.
- Kullanıcıya dönen metin **Türkçe**; kod/tablo/dosya adı **İngilizce**; log İngilizce.
- Hiçbir kiracı verisi `withTenant()` dışından okunmaz/yazılmaz. RLS veritabanında da zorlar.
- Yeni tablolar `tenant_id uuid not null` + indeks taşır ve `drizzle/9000_rls.sql`'e eklenir.
- Rol **asla çerezde taşınmaz** — her istekte oturumdan/DB'den çözülür. (aycanops'ta `opsdesk_role` çerezi rol değişiminde eskide kalıyordu; o hata tekrarlanmayacak.)
- İzin anahtarı deseni: `kaynak:eylem` — örn. `araclar:read`, `hakedis:approve`, `audit:export`.
- Migration `drizzle-kit generate` ile üretilir; RLS policy'leri elle SQL.
- Her task sonunda commit, Conventional Commits.

---

## Kapsam

**Bu plan:** izin kataloğu, kiracı bazlı rol tablosu, rol-izin eşleşmesi, kullanıcı kapsamı (firma), guard'ların yeni modele geçişi, sektör paketinden varsayılan rol kurulumu, rol/kapsam yönetim ekranları, mevcut verinin göçü.

**Bu plan değil:** import merkezi ve rapor motoru (Plan 3) · iş modülleri (Plan 4+).

---

## File Structure

```
src/
├─ db/schema/
│  ├─ auth.ts                MODIFY — users.role enum → roleId FK; user_scopes eklenir
│  └─ rbac.ts                NEW    — roles, role_permissions
├─ lib/
│  ├─ permissions.ts         REWRITE — PERMISSION_CATALOG + tip üretimi
│  ├─ rbac.ts                NEW    — DB'den rol/izin çözümleme, cache
│  ├─ scope.ts               NEW    — kullanıcı firma kapsamı çözümleme
│  ├─ auth/session.ts        MODIFY — SessionUser'a roleKey + permissions + scope
│  └─ auth/guards.ts         MODIFY — requirePermission izin anahtarıyla çalışır
├─ lib/sector/
│  ├─ packs.ts               MODIFY — SectorPack'e roles alanı
│  └─ install.ts             MODIFY — applySectorPack rolleri de kurar
├─ modules/admin/
│  ├─ queries.ts             MODIFY — listRoles, listScopes
│  └─ actions.ts             MODIFY — setUserRole, setUserScope
└─ app/(app)/admin/
   ├─ roller/page.tsx        NEW — rol listesi + izin matrisi (salt okuma)
   └─ users/page.tsx         MODIFY — rol atama + kapsam
drizzle/
└─ 9001_rbac_rls.sql         NEW — yeni tablolara RLS
tests/
├─ permissions.test.ts       REWRITE
├─ rbac.test.ts              NEW
└─ scope.test.ts             NEW
```

---

### Task 1: İzin kataloğu

**Files:**
- Rewrite: `src/lib/permissions.ts`
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Consumes: yok
- Produces:
  - `PERMISSION_CATALOG: Record<string, readonly string[]>` — kaynak → eylemler
  - `type PermissionKey = string` (runtime doğrulamalı)
  - `ALL_PERMISSIONS: readonly string[]`
  - `isValidPermission(key: string): boolean`
  - `permissionsFor(resource: string): string[]`

- [ ] **Step 1: Başarısız testi yaz — `tests/permissions.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isValidPermission, PERMISSION_CATALOG, permissionsFor } from "@/lib/permissions";

describe("izin kataloğu", () => {
  it("kaynak:eylem deseninde anahtar üretir", () => {
    expect(ALL_PERMISSIONS).toContain("araclar:read");
    expect(ALL_PERMISSIONS).toContain("hakedis:approve");
    expect(ALL_PERMISSIONS).toContain("audit:export");
  });

  it("her anahtar tam olarak bir iki nokta içerir", () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key.split(":")).toHaveLength(2);
    }
  });

  it("anahtarlar benzersizdir", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("geçerli/geçersiz anahtarı ayırt eder", () => {
    expect(isValidPermission("araclar:read")).toBe(true);
    expect(isValidPermission("uydurma:read")).toBe(false);
    expect(isValidPermission("araclar:ucmak")).toBe(false);
  });

  it("kaynağın eylemlerini döner", () => {
    expect(permissionsFor("araclar")).toContain("araclar:read");
    expect(permissionsFor("araclar")).toContain("araclar:create");
    expect(permissionsFor("uydurma")).toEqual([]);
  });

  it("çekirdek kaynaklar tanımlıdır", () => {
    for (const r of ["dashboard", "users", "roles", "settings", "terminology", "fields", "audit"]) {
      expect(PERMISSION_CATALOG[r]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/permissions.test.ts`
Expected: FAIL — `ALL_PERMISSIONS` dışa aktarılmamış

- [ ] **Step 3: `src/lib/permissions.ts` yaz**

```typescript
/**
 * İzin kataloğu — `kaynak:eylem` deseni.
 *
 * aycanops'ta 330 izin anahtarı vardı; buraya modül portları sırasında eklenir.
 * Roller VERİTABANINDA (kiracı bazlı) tutulur; bu dosya sadece hangi
 * anahtarların var olabileceğini tanımlar.
 */

const READ_WRITE = ["read", "create", "update", "delete"] as const;
const READ_ONLY = ["read"] as const;

export const PERMISSION_CATALOG: Record<string, readonly string[]> = {
  // Çekirdek
  dashboard: READ_ONLY,
  users: [...READ_WRITE, "invite"],
  roles: [...READ_WRITE, "assign"],
  scopes: ["read", "assign"],
  settings: ["read", "update"],
  terminology: ["read", "update"],
  fields: [...READ_WRITE],
  audit: ["read", "export"],
  modules: ["read", "assign"],

  // Operasyon (Plan 4)
  arrivals: [...READ_WRITE, "bulk", "export"],
  gunluk: [...READ_WRITE, "approve"],
  guzergahlar: [...READ_WRITE, "assign"],
  rota_planlama: [...READ_WRITE, "publish"],
  transferler: [...READ_WRITE],
  yolcular: [...READ_WRITE, "import", "export"],
  ziyaretci: [...READ_WRITE],
  cetele: [...READ_WRITE, "approve", "bulk"],

  // Filo (Plan 5)
  araclar: [...READ_WRITE, "import", "export"],
  bakim: [...READ_WRITE],
  belgeler: [...READ_WRITE],
  denetimler: [...READ_WRITE, "approve"],
  suruculer: [...READ_WRITE, "import"],
  filo_kaza: [...READ_WRITE],
  filo_ceza: [...READ_WRITE],
  filo_ariza: [...READ_WRITE],
  filo_sigorta: [...READ_WRITE],
  filo_lastik: [...READ_WRITE],
  yakit_kartlari: [...READ_WRITE],

  // Muhasebe (Plan 6)
  finans_gider: [...READ_WRITE, "approve"],
  finans_hareket: [...READ_WRITE],
  isletenler: [...READ_WRITE],
  cari: ["read", "create"],
  hakedis: [...READ_WRITE, "approve"],
  mutabakat: [...READ_WRITE, "approve"],
  kar_zarar: READ_ONLY,
  butce: [...READ_WRITE],

  // CRM / portal (Plan 7)
  firmalar: [...READ_WRITE],
  musteriler: [...READ_WRITE],
  portal: ["read", "manage"],

  // Görev / ticket (Plan 8)
  gorevler: [...READ_WRITE, "assign"],
  sorunlar: [...READ_WRITE, "assign"],
  notlar: [...READ_WRITE],
  oneriler: [...READ_WRITE],

  // Raporlar (Plan 3)
  raporlar: ["read", "export"],
  imports: ["read", "create", "execute", "rollback"],
};

export const ALL_PERMISSIONS: readonly string[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([resource, actions]) => actions.map((action) => `${resource}:${action}`),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

export function isValidPermission(key: string): boolean {
  return PERMISSION_SET.has(key);
}

export function permissionsFor(resource: string): string[] {
  const actions = PERMISSION_CATALOG[resource];
  return actions ? actions.map((a) => `${resource}:${a}`) : [];
}
```

- [ ] **Step 4: Testi çalıştır — geçmeli**

Run: `npm test tests/permissions.test.ts`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts tests/permissions.test.ts
git commit -m "feat: kaynak:eylem desenli izin kataloğu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Rol şeması + RLS

**Files:**
- Create: `src/db/schema/rbac.ts`, `drizzle/9001_rbac_rls.sql`
- Modify: `src/db/schema/index.ts`, `src/db/schema/auth.ts`, `tests/setup.ts`
- Test: `tests/rbac.test.ts`

**Interfaces:**
- Consumes: Task 1'den `ALL_PERMISSIONS`, `isValidPermission`
- Produces:
  - Tablolar: `roles` (id, tenantId, key, label, hierarchyLevel, isSystem), `rolePermissions` (id, tenantId, roleId, permissionKey), `userScopes` (id, tenantId, userId, companyId)
  - Tipler: `Role`, `NewRole`, `RolePermission`, `UserScope`
  - `users.roleId uuid` — `users.role` enum'u KALIR (geçiş için), yeni kod `roleId` kullanır

- [ ] **Step 1: `src/db/schema/rbac.ts` yaz**

```typescript
import { index, integer, boolean, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

/** Kiracı bazlı rol tanımı. Sektör paketi varsayılanları kurar, kiracı üzerine ekler. */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 50 }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    /** 0 = en dar, 3 = en geniş. Kullanıcı kendinden yüksek role atama yapamaz. */
    hierarchyLevel: integer("hierarchy_level").notNull().default(0),
    /** Sistem rolü silinemez/yeniden adlandırılamaz. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("roles_tenant_key_uniq").on(t.tenantId, t.key),
    tenantIdx: index("roles_tenant_idx").on(t.tenantId),
  }),
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 100 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("role_permissions_uniq").on(t.roleId, t.permissionKey),
    tenantIdx: index("role_permissions_tenant_idx").on(t.tenantId),
  }),
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
```

- [ ] **Step 2: `src/db/schema/auth.ts`'e `roleId` ve `userScopes` ekle**

`auth.ts` dosyasında `users` tanımına, `role` satırının hemen ALTINA ekle:
```typescript
    /** Yeni RBAC. `role` enum'u geçiş süresince korunur, yeni kod bunu kullanır. */
    roleId: uuid("role_id"),
```

Aynı dosyanın SONUNA, `export type User` satırından ÖNCE ekle:
```typescript
/** Kullanıcının erişebileceği firmalar. Boş = kısıtlama yok (tüm kiracı kapsamı). */
export const userScopes = pgTable(
  "user_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Firma modülü Plan 7'de gelecek; şimdilik serbest uuid, FK yok. */
    companyId: uuid("company_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("user_scopes_uniq").on(t.userId, t.companyId),
    tenantIdx: index("user_scopes_tenant_idx").on(t.tenantId),
  }),
);

export type UserScope = typeof userScopes.$inferSelect;
```

- [ ] **Step 3: `src/db/schema/index.ts`'e rbac ekle**

```typescript
export * from "./tenants";
export * from "./auth";
export * from "./sector";
export * from "./rbac";
```

- [ ] **Step 4: Migration üret ve uygula**

Run:
```bash
npm run db:generate
npm run db:push
DATABASE_ADMIN_URL="postgresql://agno_owner:owner_dev@localhost:5432/agno_platform_test" npx drizzle-kit push --force
```
Expected: her ikisinde "Changes applied"

- [ ] **Step 5: `drizzle/9001_rbac_rls.sql` yaz ve uygula**

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agno_app;

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY['roles','role_permissions','user_scopes'];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;
```

Run:
```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
for DB in agno_platform agno_platform_test; do
  psql -h localhost -p 5432 -U kayraisbilir -d "$DB" -v ON_ERROR_STOP=1 -f drizzle/9001_rbac_rls.sql
done
```
Expected: `GRANT`, `DO` — hata yok

- [ ] **Step 6: `tests/setup.ts`'i yeni tablolarla güncelle**

`resetDatabase` içindeki TRUNCATE listesini şununla değiştir:
```typescript
  await dbAdmin.execute(sql`
    TRUNCATE TABLE audit_logs, invites, password_resets, sessions,
      user_scopes, role_permissions, roles, users,
      numbering_sequences, entity_fields, terminology_overrides,
      tenant_capabilities, tenant_modules, subscriptions, tenants
    RESTART IDENTITY CASCADE
  `);
```

- [ ] **Step 7: `tests/rbac.test.ts` — şema testi**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { rolePermissions, roles, tenants } from "@/db/schema";
import { resetDatabase } from "./setup";

async function seedTenant(slug: string) {
  const [t] = await dbAdmin
    .insert(tenants)
    .values({ name: slug, slug, sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  return t!;
}

describe("rbac şeması", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("aynı kiracıda aynı rol anahtarı iki kez olamaz", async () => {
    const tenant = await seedTenant("a");
    await dbAdmin.insert(roles).values({ tenantId: tenant.id, key: "operasyon", label: "Operasyon" });
    await expect(
      dbAdmin.insert(roles).values({ tenantId: tenant.id, key: "operasyon", label: "Başka" }),
    ).rejects.toThrow();
  });

  it("farklı kiracılar aynı rol anahtarını kullanabilir", async () => {
    const a = await seedTenant("a");
    const b = await seedTenant("b");
    await dbAdmin.insert(roles).values({ tenantId: a.id, key: "operasyon", label: "Operasyon" });
    await dbAdmin.insert(roles).values({ tenantId: b.id, key: "operasyon", label: "Operasyon" });
    const rows = await dbAdmin.select().from(roles);
    expect(rows).toHaveLength(2);
  });

  it("aynı role aynı izin iki kez verilemez", async () => {
    const tenant = await seedTenant("a");
    const [role] = await dbAdmin
      .insert(roles)
      .values({ tenantId: tenant.id, key: "operasyon", label: "Operasyon" })
      .returning();
    await dbAdmin
      .insert(rolePermissions)
      .values({ tenantId: tenant.id, roleId: role!.id, permissionKey: "araclar:read" });
    await expect(
      dbAdmin
        .insert(rolePermissions)
        .values({ tenantId: tenant.id, roleId: role!.id, permissionKey: "araclar:read" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 8: Test + commit**

Run: `npm test tests/rbac.test.ts`
Expected: `3 passed`

```bash
git add -A
git commit -m "feat: kiracı bazlı rol/izin şeması + kullanıcı firma kapsamı + RLS

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Rol çözümleme (DB → izin kümesi)

**Files:**
- Create: `src/lib/rbac.ts`
- Modify: `tests/rbac.test.ts` (ekleme)

**Interfaces:**
- Consumes: Task 2 şemalar; Task 1 `isValidPermission`
- Produces:
  - `getRolePermissions(tenantId: string, roleId: string): Promise<Set<string>>`
  - `createRole(tenantId, input: { key; label; hierarchyLevel?; isSystem?; permissions: string[] }): Promise<string>` — rol id döner
  - `setRolePermissions(tenantId: string, roleId: string, permissions: string[]): Promise<void>` — tam değiştirme
  - `listRolesWithCounts(tenantId: string): Promise<Array<{ id; key; label; hierarchyLevel; isSystem; permissionCount: number }>>`

- [ ] **Step 1: Testleri `tests/rbac.test.ts` sonuna ekle**

```typescript
import { createRole, getRolePermissions, listRolesWithCounts, setRolePermissions } from "@/lib/rbac";

describe("rol çözümleme", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rol oluşturur ve izinlerini döner", async () => {
    const tenant = await seedTenant("a");
    const roleId = await createRole(tenant.id, {
      key: "operasyon",
      label: "Operasyon",
      permissions: ["araclar:read", "arrivals:create"],
    });

    const perms = await getRolePermissions(tenant.id, roleId);
    expect(perms.has("araclar:read")).toBe(true);
    expect(perms.has("arrivals:create")).toBe(true);
    expect(perms.size).toBe(2);
  });

  it("geçersiz izin anahtarını reddeder", async () => {
    const tenant = await seedTenant("a");
    await expect(
      createRole(tenant.id, { key: "x", label: "X", permissions: ["uydurma:read"] }),
    ).rejects.toThrow(/Ge.ersiz izin/);
  });

  it("izinleri tam olarak değiştirir (eskiler silinir)", async () => {
    const tenant = await seedTenant("a");
    const roleId = await createRole(tenant.id, {
      key: "operasyon",
      label: "Operasyon",
      permissions: ["araclar:read", "araclar:create"],
    });

    await setRolePermissions(tenant.id, roleId, ["yolcular:read"]);
    const perms = await getRolePermissions(tenant.id, roleId);
    expect([...perms]).toEqual(["yolcular:read"]);
  });

  it("rolleri izin sayısıyla listeler", async () => {
    const tenant = await seedTenant("a");
    await createRole(tenant.id, { key: "a", label: "A", permissions: ["araclar:read"] });
    await createRole(tenant.id, { key: "b", label: "B", permissions: ["araclar:read", "araclar:create"] });

    const list = await listRolesWithCounts(tenant.id);
    expect(list.find((r) => r.key === "a")?.permissionCount).toBe(1);
    expect(list.find((r) => r.key === "b")?.permissionCount).toBe(2);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/rbac.test.ts`
Expected: FAIL — `Cannot find module '@/lib/rbac'`

- [ ] **Step 3: `src/lib/rbac.ts` yaz**

```typescript
import { and, eq, sql } from "drizzle-orm";
import { rolePermissions, roles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isValidPermission } from "./permissions";

export type CreateRoleInput = {
  key: string;
  label: string;
  hierarchyLevel?: number;
  isSystem?: boolean;
  permissions: readonly string[];
};

function assertValidPermissions(permissions: readonly string[]): void {
  const invalid = permissions.filter((p) => !isValidPermission(p));
  if (invalid.length > 0) {
    throw new Error(`Geçersiz izin anahtarı: ${invalid.join(", ")}`);
  }
}

export async function createRole(tenantId: string, input: CreateRoleInput): Promise<string> {
  assertValidPermissions(input.permissions);

  return withTenant(tenantId, async (tx) => {
    const [role] = await tx
      .insert(roles)
      .values({
        tenantId,
        key: input.key,
        label: input.label,
        hierarchyLevel: input.hierarchyLevel ?? 0,
        isSystem: input.isSystem ?? false,
      })
      .returning({ id: roles.id });

    const roleId = role!.id;
    if (input.permissions.length > 0) {
      await tx.insert(rolePermissions).values(
        input.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })),
      );
    }
    return roleId;
  });
}

export async function getRolePermissions(tenantId: string, roleId: string): Promise<Set<string>> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ permissionKey: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId))),
  );
  return new Set(rows.map((r) => r.permissionKey));
}

/** İzin listesini TAM olarak değiştirir — mevcutlar silinir. */
export async function setRolePermissions(
  tenantId: string,
  roleId: string,
  permissions: readonly string[],
): Promise<void> {
  assertValidPermissions(permissions);

  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));

    if (permissions.length > 0) {
      await tx.insert(rolePermissions).values(
        permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })),
      );
    }
  });
}

export async function listRolesWithCounts(tenantId: string): Promise<
  Array<{ id: string; key: string; label: string; hierarchyLevel: number; isSystem: boolean; permissionCount: number }>
> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: roles.id,
        key: roles.key,
        label: roles.label,
        hierarchyLevel: roles.hierarchyLevel,
        isSystem: roles.isSystem,
        permissionCount: sql<number>`count(${rolePermissions.id})::int`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(roles.tenantId, tenantId))
      .groupBy(roles.id)
      .orderBy(roles.hierarchyLevel, roles.label),
  );
}
```

- [ ] **Step 4: Test + commit**

Run: `npm test tests/rbac.test.ts`
Expected: `7 passed`

```bash
git add -A
git commit -m "feat: rol çözümleme — oluştur, izin ata, listele; geçersiz anahtar reddi

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Kullanıcı kapsamı (firma)

**Files:**
- Create: `src/lib/scope.ts`, `tests/scope.test.ts`

**Interfaces:**
- Consumes: Task 2 `userScopes`
- Produces:
  - `getUserScope(tenantId: string, userId: string): Promise<string[] | null>` — `null` = kısıtlama yok
  - `setUserScope(tenantId: string, userId: string, companyIds: readonly string[]): Promise<void>` — boş dizi = kısıtlama kaldır
  - `isInScope(scope: string[] | null, companyId: string): boolean`

- [ ] **Step 1: `tests/scope.test.ts` yaz**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { dbAdmin } from "@/db/admin";
import { tenants, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getUserScope, isInScope, setUserScope } from "@/lib/scope";
import { resetDatabase } from "./setup";

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";

async function seedUser() {
  const [tenant] = await dbAdmin
    .insert(tenants)
    .values({ name: "T", slug: "t", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
    .returning();
  const [user] = await dbAdmin
    .insert(users)
    .values({
      tenantId: tenant!.id,
      email: "a@x.com",
      name: "A",
      passwordHash: await hashPassword("Gizli1234!"),
    })
    .returning();
  return { tenantId: tenant!.id, userId: user!.id };
}

describe("kullanıcı kapsamı", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("kapsam tanımsızsa null döner (kısıtlama yok)", async () => {
    const { tenantId, userId } = await seedUser();
    expect(await getUserScope(tenantId, userId)).toBeNull();
  });

  it("kapsam atar ve okur", async () => {
    const { tenantId, userId } = await seedUser();
    await setUserScope(tenantId, userId, [COMPANY_A, COMPANY_B]);
    const scope = await getUserScope(tenantId, userId);
    expect(scope).toHaveLength(2);
    expect(scope).toContain(COMPANY_A);
  });

  it("boş dizi kapsamı kaldırır", async () => {
    const { tenantId, userId } = await seedUser();
    await setUserScope(tenantId, userId, [COMPANY_A]);
    await setUserScope(tenantId, userId, []);
    expect(await getUserScope(tenantId, userId)).toBeNull();
  });

  it("kapsam kontrolü", () => {
    expect(isInScope(null, COMPANY_A)).toBe(true);
    expect(isInScope([COMPANY_A], COMPANY_A)).toBe(true);
    expect(isInScope([COMPANY_A], COMPANY_B)).toBe(false);
    expect(isInScope([], COMPANY_A)).toBe(false);
  });
});
```

- [ ] **Step 2: Testi çalıştır — başarısız olmalı**

Run: `npm test tests/scope.test.ts`
Expected: FAIL — `Cannot find module '@/lib/scope'`

- [ ] **Step 3: `src/lib/scope.ts` yaz**

```typescript
import { and, eq } from "drizzle-orm";
import { userScopes } from "@/db/schema";
import { withTenant } from "@/db/tenant";

/**
 * Kullanıcının erişebileceği firmalar.
 * `null` = kısıtlama yok (kiracının tamamı). Boş dizi hiçbir zaman dönmez —
 * kapsam kaydı silindiğinde null'a düşer.
 */
export async function getUserScope(tenantId: string, userId: string): Promise<string[] | null> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ companyId: userScopes.companyId })
      .from(userScopes)
      .where(and(eq(userScopes.tenantId, tenantId), eq(userScopes.userId, userId))),
  );
  return rows.length === 0 ? null : rows.map((r) => r.companyId);
}

/** Kapsamı TAM olarak değiştirir. Boş dizi = kısıtlamayı kaldır. */
export async function setUserScope(
  tenantId: string,
  userId: string,
  companyIds: readonly string[],
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .delete(userScopes)
      .where(and(eq(userScopes.tenantId, tenantId), eq(userScopes.userId, userId)));

    if (companyIds.length > 0) {
      await tx.insert(userScopes).values(
        companyIds.map((companyId) => ({ tenantId, userId, companyId })),
      );
    }
  });
}

/** `null` kapsam her firmaya izin verir; boş dizi hiçbirine. */
export function isInScope(scope: string[] | null, companyId: string): boolean {
  if (scope === null) return true;
  return scope.includes(companyId);
}
```

- [ ] **Step 4: Test + commit**

Run: `npm test tests/scope.test.ts`
Expected: `4 passed`

```bash
git add -A
git commit -m "feat: kullanıcı firma kapsamı — atama, okuma, kontrol

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Oturum ve guard'ları yeni modele geçir

**Files:**
- Modify: `src/lib/auth/session.ts`, `src/lib/auth/guards.ts`, `src/lib/auth/index.ts`
- Modify: `tests/auth.test.ts`

**Interfaces:**
- Consumes: Task 3 `getRolePermissions`; Task 4 `getUserScope`
- Produces:
  - `SessionUser` genişler: `{ userId; tenantId; email; name; role; roleId: string | null; permissions: Set<string>; scope: string[] | null }`
  - `requirePermission(permissionKey: string): Promise<SessionUser>` — artık string anahtar alır
  - `hasPermission(session: SessionUser, permissionKey: string): boolean`

> **Kritik:** rol ve izinler her istekte veritabanından çözülür. Çerezde SADECE oturum token'ı vardır. (aycanops'ta rol çerezde tutuluyordu ve DB'de rol değişince eskide kalıyordu — o hata burada tekrarlanmaz.)

- [ ] **Step 1: `src/lib/auth/session.ts` — `getSessionByToken`'ı genişlet**

`getSessionByToken` fonksiyonunun tamamını şununla değiştir:
```typescript
export async function getSessionByToken(token: string): Promise<SessionUser | null> {
  const rows = await dbAdmin
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      role: users.role,
      roleId: users.roleId,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.isActive) return null;

  // Rol ve kapsam HER İSTEKTE veritabanından çözülür — çerezde taşınmaz.
  const permissions = row.roleId
    ? await getRolePermissions(row.tenantId, row.roleId)
    : new Set<string>();
  const scope = await getUserScope(row.tenantId, row.userId);

  return {
    userId: row.userId,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    role: row.role,
    roleId: row.roleId,
    permissions,
    scope,
  };
}
```

Aynı dosyanın başındaki import bloğuna ekle:
```typescript
import { getRolePermissions } from "@/lib/rbac";
import { getUserScope } from "@/lib/scope";
```

Ve `SessionUser` tipini şununla değiştir:
```typescript
export type SessionUser = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  /** Eski enum — geçiş süresince korunur. */
  role: UserRole;
  roleId: string | null;
  permissions: Set<string>;
  /** null = tüm kiracı kapsamı */
  scope: string[] | null;
};
```

- [ ] **Step 2: `src/lib/auth/guards.ts`'i güncelle**

Dosyanın tamamını şununla değiştir:
```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

/** Oturumun izin kümesinde anahtar var mı. */
export function hasPermission(session: SessionUser, permissionKey: string): boolean {
  return session.permissions.has(permissionKey);
}

export async function requirePermission(permissionKey: string): Promise<SessionUser> {
  const session = await requireAuth();
  if (!hasPermission(session, permissionKey)) redirect("/dashboard");
  return session;
}
```

- [ ] **Step 3: `src/lib/auth/index.ts`'te `hasPermission`'ı dışa aktar**

`export { getCurrentSession, requireAuth, requirePermission, AUTH_COOKIE_NAME } from "./guards";`
satırını şununla değiştir:
```typescript
export { getCurrentSession, requireAuth, requirePermission, hasPermission, AUTH_COOKIE_NAME } from "./guards";
```

- [ ] **Step 4: `tests/auth.test.ts`'teki izin testini güncelle**

`describe("izinler", ...)` bloğunun tamamını şununla değiştir:
```typescript
describe("oturum izinleri", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rolü olan kullanıcı izinlerini oturumda taşır", async () => {
    const [tenant] = await dbAdmin
      .insert(tenants)
      .values({ name: "T", slug: "t2", sectorPack: "turizm", sectorPackVersion: "1.0.0" })
      .returning();
    const roleId = await createRole(tenant!.id, {
      key: "operasyon",
      label: "Operasyon",
      permissions: ["araclar:read"],
    });
    const [user] = await dbAdmin
      .insert(users)
      .values({
        tenantId: tenant!.id,
        email: "b@x.com",
        name: "B",
        passwordHash: await hashPassword("Gizli1234!"),
        roleId,
      })
      .returning();

    const token = await createSession(user!.id, tenant!.id);
    const session = await getSessionByToken(token);
    expect(session?.permissions.has("araclar:read")).toBe(true);
    expect(session?.permissions.has("hakedis:approve")).toBe(false);
  });

  it("rolü olmayan kullanıcının izni yoktur", async () => {
    const { tenant, user } = await seedUser();
    const token = await createSession(user.id, tenant.id);
    const session = await getSessionByToken(token);
    expect(session?.permissions.size).toBe(0);
  });
});
```

Dosyanın import bloğuna ekle:
```typescript
import { tenants } from "@/db/schema";
import { createRole } from "@/lib/rbac";
```
ve `hasPermission` import'unu `@/lib/permissions`'tan KALDIR.

- [ ] **Step 5: Test + build + commit**

Run: `npm test && npm run build`
Expected: tüm testler geçer, build `EXIT=0`

```bash
git add -A
git commit -m "feat: oturum izinleri DB'den çözülüyor — rol asla çerezde taşınmaz

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Sektör paketinden varsayılan roller

**Files:**
- Modify: `src/lib/sector/packs.ts`, `src/lib/sector/install.ts`
- Modify: `tests/sector-pack.test.ts`

**Interfaces:**
- Consumes: Task 3 `createRole`
- Produces:
  - `SectorPack.roles: readonly PackRole[]`
  - `PackRole = { key; label; hierarchyLevel; isSystem?; permissions: readonly string[] }`
  - `applySectorPack` artık rolleri de kurar (idempotent)
  - `provisionTenant` owner kullanıcıyı `owner` rolüne bağlar

- [ ] **Step 1: `src/lib/sector/packs.ts`'e rol tipi ve varsayılanlar ekle**

`PackSequence` tipinin ALTINA ekle:
```typescript
export type PackRole = {
  key: string;
  label: string;
  /** 0 = en dar, 3 = en geniş. */
  hierarchyLevel: number;
  isSystem?: boolean;
  permissions: readonly string[];
};
```

`SectorPack` tipine `numbering` satırının ALTINA ekle:
```typescript
  /** Kurulacak varsayılan roller */
  roles: readonly PackRole[];
```

`COMMON_NUMBERING` tanımının ALTINA ekle:
```typescript
import { ALL_PERMISSIONS } from "@/lib/permissions";

/** Her pakette bulunan çekirdek roller. Paket kendi rollerini üstüne ekler. */
const COMMON_ROLES: readonly PackRole[] = [
  {
    key: "owner",
    label: "Sahip",
    hierarchyLevel: 3,
    isSystem: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "admin",
    label: "Yönetici",
    hierarchyLevel: 3,
    isSystem: true,
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("roles:")),
  },
  {
    key: "viewer",
    label: "İzleyici",
    hierarchyLevel: 0,
    isSystem: true,
    permissions: ALL_PERMISSIONS.filter((p) => p.endsWith(":read")),
  },
];
```

Her paketin tanımına (`turizm`, `lojistik`, `pilates`, `oto_servis`) `numbering` satırının ALTINA ekle:

`turizm` için:
```typescript
    roles: [
      ...COMMON_ROLES,
      {
        key: "operasyon",
        label: "Operasyon",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "arrivals:read", "arrivals:create", "arrivals:update",
          "yolcular:read", "guzergahlar:read", "araclar:read", "raporlar:read",
        ],
      },
      {
        key: "muhasebe",
        label: "Muhasebe",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "finans_gider:read", "finans_gider:create", "finans_hareket:read",
          "hakedis:read", "cari:read", "raporlar:read", "raporlar:export",
        ],
      },
    ],
```

`lojistik` için:
```typescript
    roles: [
      ...COMMON_ROLES,
      {
        key: "operasyon",
        label: "Operasyon",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "guzergahlar:read", "araclar:read", "transferler:read",
          "transferler:create", "raporlar:read",
        ],
      },
      {
        key: "muhasebe",
        label: "Muhasebe",
        hierarchyLevel: 1,
        permissions: [
          "dashboard:read", "finans_gider:read", "finans_gider:create",
          "cari:read", "raporlar:read", "raporlar:export",
        ],
      },
    ],
```

`pilates` için:
```typescript
    roles: [
      ...COMMON_ROLES,
      {
        key: "egitmen",
        label: "Eğitmen",
        hierarchyLevel: 1,
        permissions: ["dashboard:read", "musteriler:read", "raporlar:read"],
      },
    ],
```

`oto_servis` için:
```typescript
    roles: [
      ...COMMON_ROLES,
      {
        key: "usta",
        label: "Usta",
        hierarchyLevel: 1,
        permissions: ["dashboard:read", "musteriler:read", "araclar:read"],
      },
    ],
```

- [ ] **Step 2: `src/lib/sector/install.ts`'e rol kurulumu ekle**

`applySectorPack` içinde, `for (const seq of pack.numbering)` döngüsünün ALTINA (tenants update'inden ÖNCE) ekle:
```typescript
  for (const packRole of pack.roles) {
    const existing = await dbAdmin
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.key, packRole.key)))
      .limit(1);

    if (existing.length === 0) {
      const [created] = await dbAdmin
        .insert(roles)
        .values({
          tenantId,
          key: packRole.key,
          label: packRole.label,
          hierarchyLevel: packRole.hierarchyLevel,
          isSystem: packRole.isSystem ?? false,
        })
        .returning({ id: roles.id });

      if (packRole.permissions.length > 0) {
        await dbAdmin.insert(rolePermissions).values(
          packRole.permissions.map((permissionKey) => ({
            tenantId,
            roleId: created!.id,
            permissionKey,
          })),
        );
      }
    }
  }
```

Dosyanın import bloğunda `@/db/schema` import'una `rolePermissions, roles` ekle.

- [ ] **Step 3: `provisionTenant`'ta owner kullanıcıyı role bağla**

`provisionTenant` içinde `await applySectorPack(tenantId, pack.key);` satırını şununla değiştir:
```typescript
  await applySectorPack(tenantId, pack.key);

  // Owner kullanıcıyı "owner" rolüne bağla — paket kurulduktan SONRA
  const [ownerRole] = await dbAdmin
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, "owner")))
    .limit(1);

  if (ownerRole) {
    await dbAdmin.update(users).set({ roleId: ownerRole.id }).where(eq(users.id, user!.id));
  }
```

- [ ] **Step 4: `tests/sector-pack.test.ts`'e rol testi ekle**

Dosyanın sonundaki `describe` bloğunun içine ekle:
```typescript
  it("paket varsayılan rollerini kurar", async () => {
    const tenant = await seedTenant("turizm");
    await applySectorPack(tenant.id, "turizm");
    const list = await listRolesWithCounts(tenant.id);
    const keys = list.map((r) => r.key);
    expect(keys).toContain("owner");
    expect(keys).toContain("admin");
    expect(keys).toContain("operasyon");
    expect(keys).toContain("muhasebe");
    expect(list.find((r) => r.key === "owner")!.permissionCount).toBeGreaterThan(50);
  });

  it("pilates paketi eğitmen rolü kurar, turizm kurmaz", async () => {
    const p = await seedTenant("pilates");
    await applySectorPack(p.id, "pilates");
    expect((await listRolesWithCounts(p.id)).map((r) => r.key)).toContain("egitmen");

    const t = await seedTenant("turizm");
    await applySectorPack(t.id, "turizm");
    expect((await listRolesWithCounts(t.id)).map((r) => r.key)).not.toContain("egitmen");
  });
```

Import bloğuna ekle:
```typescript
import { listRolesWithCounts } from "@/lib/rbac";
```

- [ ] **Step 5: `tests/provision.test.ts`'e owner rol testi ekle**

İlk `it(...)` bloğunun sonuna, `expect(mods.map(...))` satırının ALTINA ekle:
```typescript
    const [owner] = await dbAdmin.select().from(users).where(eq(users.id, userId));
    expect(owner!.roleId).not.toBeNull();

    const perms = await getRolePermissions(tenantId, owner!.roleId!);
    expect(perms.has("users:create")).toBe(true);
```

Import bloğuna ekle:
```typescript
import { getRolePermissions } from "@/lib/rbac";
```

- [ ] **Step 6: Test + commit**

Run: `npm test`
Expected: tüm testler geçer

```bash
git add -A
git commit -m "feat: sektör paketi varsayılan rolleri kurar, owner otomatik bağlanır

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rol yönetim ekranı + kullanıcıya rol/kapsam atama

**Files:**
- Create: `src/app/(app)/admin/roller/page.tsx`
- Modify: `src/modules/admin/queries.ts`, `src/modules/admin/actions.ts`, `src/modules/admin/validators.ts`, `src/app/(app)/admin/users/page.tsx`, `src/lib/modules/registry.ts`

**Interfaces:**
- Consumes: Task 3 `listRolesWithCounts`, `getRolePermissions`; Task 4 `setUserScope`, `getUserScope`
- Produces:
  - `listUsersWithRoles(tenantId)` — kullanıcı + rol etiketi
  - `assignRoleAction(prevState, formData)` — kullanıcıya rol atar, oturumları iptal eder
  - Registry'de `admin` modülüne "Roller" alt menüsü

- [ ] **Step 1: `src/modules/admin/queries.ts`'e ekle**

Dosyanın sonuna ekle:
```typescript
import { roles } from "@/db/schema";

export async function listUsersWithRoles(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        isActive: users.isActive,
        roleId: users.roleId,
        roleLabel: roles.label,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.tenantId, tenantId))
      .orderBy(asc(users.name)),
  );
}
```

- [ ] **Step 2: `src/modules/admin/validators.ts`'e ekle**

```typescript
export const AssignRoleSchema = z.object({
  userId: z.string().uuid("Geçersiz kullanıcı."),
  roleId: z.string().uuid("Geçersiz rol."),
});
```

- [ ] **Step 3: `src/modules/admin/actions.ts`'e rol atama aksiyonu ekle**

Dosyanın sonuna ekle:
```typescript
import { revokeUserSessions } from "@/lib/auth";
import { users } from "@/db/schema";
import { AssignRoleSchema } from "./validators";

export async function assignRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission("roles:assign");

  const parsed = AssignRoleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(users)
      .set({ roleId: parsed.data.roleId, updatedAt: new Date() })
      .where(and(eq(users.tenantId, session.tenantId), eq(users.id, parsed.data.userId))),
  );

  // Yetki değişti — kullanıcının açık oturumları eski izinlerle devam etmesin
  await revokeUserSessions(session.tenantId, parsed.data.userId);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.role_assigned",
    entityType: "user",
    entityId: parsed.data.userId,
    metadata: { roleId: parsed.data.roleId },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
  return { ok: "Rol atandı. Kullanıcının yeniden giriş yapması gerekiyor." };
}
```

- [ ] **Step 4: `src/app/(app)/admin/roller/page.tsx` yaz**

```tsx
import { requirePermission } from "@/lib/auth";
import { getRolePermissions, listRolesWithCounts } from "@/lib/rbac";

export default async function AdminRolesPage() {
  const session = await requirePermission("roles:read");
  const roleList = await listRolesWithCounts(session.tenantId);

  const withPermissions = await Promise.all(
    roleList.map(async (role) => ({
      ...role,
      permissions: [...(await getRolePermissions(session.tenantId, role.id))].sort(),
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Roller</h1>
        <p className="text-sm text-neutral-500">
          Sektör paketinizle gelen roller ve izinleri. Sistem rolleri değiştirilemez.
        </p>
      </div>

      <div className="space-y-3">
        {withPermissions.map((role) => (
          <div key={role.id} className="rounded-xl border border-neutral-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {role.label}
                  {role.isSystem ? (
                    <span className="ml-2 rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                      sistem
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500">
                  {role.key} · seviye {role.hierarchyLevel}
                </p>
              </div>
              <span className="text-sm text-neutral-600">{role.permissionCount} izin</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {role.permissions.slice(0, 24).map((p) => (
                <span key={p} className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                  {p}
                </span>
              ))}
              {role.permissions.length > 24 ? (
                <span className="px-2 py-0.5 text-xs text-neutral-500">
                  +{role.permissions.length - 24} daha
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `src/app/(app)/admin/users/page.tsx` — rol atama formu**

> Aksiyon yazıp UI'sız bırakmak Faz 1'de yapılmış bir hataydı. Burada `assignRoleAction`
> doğrudan çalışan bir form ile bağlanıyor.

Dosyanın tamamını şununla değiştir:
```tsx
import { requirePermission } from "@/lib/auth";
import { listRolesWithCounts } from "@/lib/rbac";
import { assignRoleAction } from "@/modules/admin/actions";
import { listUsersWithRoles } from "@/modules/admin/queries";

export default async function AdminUsersPage() {
  const session = await requirePermission("users:read");
  const [rows, roleList] = await Promise.all([
    listUsersWithRoles(session.tenantId),
    listRolesWithCounts(session.tenantId),
  ]);
  const canAssign = session.permissions.has("roles:assign");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Kullanıcılar</h1>
        <p className="text-sm text-neutral-500">
          Rol değiştirildiğinde kullanıcının açık oturumları kapatılır.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {rows.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-neutral-500">{user.email}</p>
            </div>

            {canAssign ? (
              <form action={assignRoleAction} className="flex items-center gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="roleId"
                  defaultValue={user.roleId ?? ""}
                  className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  <option value="" disabled>
                    Rol seçin
                  </option>
                  {roleList.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                >
                  Ata
                </button>
              </form>
            ) : (
              <span className="text-xs text-neutral-600">{user.roleLabel ?? "rol atanmamış"}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

> **Not:** `assignRoleAction` bu formda `ActionState` döndürmeden çağrılıyor (`<form action={...}>`).
> Bunun çalışması için Task 7 Step 3'teki imza `formData`-only olmalı — aşağıdaki Step 5b bunu düzeltir.

- [ ] **Step 5b: `assignRoleAction` imzasını form-uyumlu yap**

`src/modules/admin/actions.ts` içinde `assignRoleAction`'ın imzasını ve dönüşlerini değiştir:
```typescript
export async function assignRoleAction(formData: FormData): Promise<void> {
  const session = await requirePermission("roles:assign");

  const parsed = AssignRoleSchema.safeParse({
    userId: formData.get("userId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return;

  await withTenant(session.tenantId, (tx) =>
    tx
      .update(users)
      .set({ roleId: parsed.data.roleId, updatedAt: new Date() })
      .where(and(eq(users.tenantId, session.tenantId), eq(users.id, parsed.data.userId))),
  );

  // Yetki değişti — kullanıcının açık oturumları eski izinlerle devam etmesin
  await revokeUserSessions(session.tenantId, parsed.data.userId);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.role_assigned",
    entityType: "user",
    entityId: parsed.data.userId,
    metadata: { roleId: parsed.data.roleId },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
}
```

- [ ] **Step 5c: Kapsam atama ekranı — `src/app/(app)/admin/kapsam/page.tsx`**

> `setUserScope` (Task 4) da UI'sız kalmasın. Firma modülü Plan 7'de geleceği için
> şimdilik firma kimliği elle girilir; Plan 7'de seçici listeye dönüşür.

```tsx
import { requirePermission } from "@/lib/auth";
import { getUserScope } from "@/lib/scope";
import { setUserScopeAction } from "@/modules/admin/actions";
import { listUsersWithRoles } from "@/modules/admin/queries";

export default async function AdminScopePage() {
  const session = await requirePermission("scopes:read");
  const rows = await listUsersWithRoles(session.tenantId);

  const withScope = await Promise.all(
    rows.map(async (user) => ({
      ...user,
      scope: await getUserScope(session.tenantId, user.id),
    })),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Firma Kapsamı</h1>
        <p className="text-sm text-neutral-500">
          Boş bırakılan kullanıcı kiracının tamamını görür. Virgülle ayırarak birden fazla
          firma kimliği girebilirsiniz.
        </p>
      </div>

      <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {withScope.map((user) => (
          <form
            key={user.id}
            action={setUserScopeAction}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-neutral-500">
                {user.scope === null ? "kısıtlama yok" : `${user.scope.length} firma`}
              </p>
            </div>
            <input type="hidden" name="userId" value={user.id} />
            <input
              name="companyIds"
              defaultValue={user.scope?.join(",") ?? ""}
              placeholder="firma kimlikleri (virgülle)"
              className="w-72 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
            >
              Kaydet
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5d: `setUserScopeAction`'ı `src/modules/admin/actions.ts` sonuna ekle**

```typescript
import { setUserScope } from "@/lib/scope";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setUserScopeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("scopes:assign");

  const userId = String(formData.get("userId") ?? "");
  if (!UUID_RE.test(userId)) return;

  const raw = String(formData.get("companyIds") ?? "");
  const companyIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));

  await setUserScope(session.tenantId, userId, companyIds);

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    event: "user.scope_changed",
    entityType: "user",
    entityId: userId,
    metadata: { companyCount: companyIds.length },
  });

  revalidateTag(tenantTag(session.tenantId, "users"), "max");
}
```

- [ ] **Step 6: `src/lib/modules/registry.ts`'te admin modülünü güncelle**

`admin` modülünün tanımını şununla değiştir:
```typescript
  {
    key: "admin",
    label: "Yönetim",
    icon: "Settings",
    href: "/admin",
    permission: "users:read",
    children: [
      { label: "Kullanıcılar", href: "/admin/users" },
      { label: "Roller", href: "/admin/roller" },
      { label: "Firma Kapsamı", href: "/admin/kapsam" },
      { label: "Terimler", href: "/admin/terminoloji" },
      { label: "Özel Alanlar", href: "/admin/alanlar" },
    ],
  },
```

Aynı dosyada `ModuleDefinition.permission` tipini `Permission`'dan `string`'e çevir:
```typescript
  permission: string;
```
ve `buildNavigation` içindeki `hasPermission(role, module.permission)` çağrısını şununla değiştir:
```typescript
    if (!access.permissions.has(module.permission)) return false;
```

`buildNavigation` imzasını şununla değiştir:
```typescript
export function buildNavigation(
  access: TenantAccess & { permissions: Set<string> },
): ModuleDefinition[] {
```
ve `import { hasPermission, type Permission } from "@/lib/permissions";` ile `import type { UserRole } from "@/db/schema";` satırlarını SİL.

- [ ] **Step 7: `buildNavigation` çağıranlarını güncelle**

`src/app/(app)/layout.tsx` içinde:
```typescript
  const items: NavItem[] = buildNavigation({ ...access, permissions: session.permissions }).map((module) => {
```

`src/app/(app)/dashboard/page.tsx` içinde:
```typescript
  const modules = buildNavigation({ ...access, permissions: session.permissions }).filter(
    (m) => m.key !== "dashboard",
  );
```

- [ ] **Step 8: Diğer sayfaların izin anahtarlarını güncelle**

`src/app/(app)/admin/terminoloji/page.tsx`: `requirePermission("terminology.manage")` → `requirePermission("terminology:update")`
`src/app/(app)/admin/alanlar/page.tsx`: `requirePermission("fields.manage")` → `requirePermission("fields:read")`
`src/modules/admin/actions.ts` içinde: `requirePermission("users.manage")` → `requirePermission("users:invite")`, `requirePermission("terminology.manage")` → `requirePermission("terminology:update")`

- [ ] **Step 9: `tests/licensing.test.ts`'i yeni imzaya uyarla**

`buildNavigation("owner", access)` çağrılarını şununla değiştir:
```typescript
    buildNavigation({ ...access, permissions: new Set(["dashboard:read", "users:read"]) })
```
ve `MODULE_REGISTRY` senkron testinde `module.permission` kontrolü ekleme — mevcut testler yeterli.

- [ ] **Step 10: Build + tüm testler + commit**

Run: `npm run build && npm test`
Expected: build `EXIT=0`, tüm testler geçer

```bash
git add -A
git commit -m "feat: rol yönetim ekranı, kullanıcıya rol atama, nav izin anahtarına geçti

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E — rol izinleri menüyü süzüyor

**Files:**
- Create: `tests/e2e/rbac.spec.ts`
- Modify: `scripts/seed-e2e.ts`

**Interfaces:**
- Consumes: Task 6 `provisionTenant` (owner rolüyle), Task 3 `createRole`

- [ ] **Step 1: `scripts/seed-e2e.ts`'e kısıtlı kullanıcı ekle**

`main()` içindeki iki `provisionTenant` çağrısından SONRA ekle:
```typescript
  // Kısıtlı rollü kullanıcı — menü süzgecini doğrulamak için
  const { tenantId } = await provisionTenant({
    name: "E2E Kisitli",
    slug: "e2e-kisitli",
    sectorPack: "turizm",
    ownerEmail: "kisitli-owner@e2e.test",
    ownerName: "Kisitli Owner",
    ownerPassword: "E2eTest1234!",
  });

  const viewerRoleId = await createRole(tenantId, {
    key: "sadece_dashboard",
    label: "Sadece Dashboard",
    hierarchyLevel: 0,
    permissions: ["dashboard:read"],
  });

  await dbAdmin.insert(users).values({
    tenantId,
    email: "kisitli@e2e.test",
    name: "Kisitli Kullanici",
    passwordHash: await hashPassword("E2eTest1234!"),
    roleId: viewerRoleId,
  });
```

Import bloğuna ekle:
```typescript
import { dbAdmin } from "@/db/admin";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { createRole } from "@/lib/rbac";
```

- [ ] **Step 2: `tests/e2e/rbac.spec.ts` yaz**

```typescript
import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("E2eTest1234!");
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL("/dashboard");
}

test("owner Yönetim menüsünü görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await expect(page.getByRole("link", { name: "Yönetim", exact: true })).toBeVisible();
});

test("kısıtlı kullanıcı Yönetim menüsünü görmez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await expect(page.getByRole("link", { name: "Yönetim", exact: true })).toHaveCount(0);
});

test("kısıtlı kullanıcı yönetim sayfasına gidemez", async ({ page }) => {
  await login(page, "kisitli@e2e.test");
  await page.goto("/admin/roller");
  await expect(page).toHaveURL("/dashboard");
});

test("owner rol listesini ve izinlerini görür", async ({ page }) => {
  await login(page, "kisitli-owner@e2e.test");
  await page.goto("/admin/roller");
  await expect(page.getByText("Sahip")).toBeVisible();
  await expect(page.getByText("Operasyon")).toBeVisible();
  await expect(page.getByText("dashboard:read").first()).toBeVisible();
});
```

- [ ] **Step 3: Seed + E2E çalıştır**

Run:
```bash
npx tsx scripts/seed-e2e.ts
npm run test:e2e
```
Expected: tüm E2E testleri geçer (önceki sektör testleri + 4 yeni RBAC testi)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: E2E — rol izinleri menüyü ve sayfa erişimini süzüyor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Faz 2 Tamamlanma Kriterleri

- [ ] İzin kataloğu `kaynak:eylem` deseninde, geçersiz anahtar reddediliyor
- [ ] Roller kiracı bazlı veritabanında; iki kiracı aynı rol anahtarını kullanabiliyor
- [ ] Sektör paketi kendi rollerini kuruyor (turizm→operasyon+muhasebe, pilates→egitmen)
- [ ] Owner kullanıcı provizyonda otomatik `owner` rolüne bağlanıyor
- [ ] **Rol ve izinler her istekte DB'den çözülüyor** — çerezde taşınmıyor
- [ ] Rol değişince kullanıcının oturumları iptal ediliyor
- [ ] Sol menü izin anahtarına göre süzülüyor
- [ ] Kullanıcı firma kapsamı **ekrandan** atanabiliyor (`null` = kısıtlama yok)
- [ ] Rol ataması **ekrandan** yapılabiliyor — yazılan her aksiyonun çalışan bir UI'ı var
- [ ] `npm test` ve `npm run test:e2e` yeşil

---

## Sonraki Plan

`plan-3-import-ve-rapor.md` — import merkezi (şablon→yükle→eşleştir→önizle→uygula→geri al) + deklaratif rapor motoru (XLSX/PDF) + bildirim kuralları. İkisi de aycanops'ta çalışıyor, port edilecek.
