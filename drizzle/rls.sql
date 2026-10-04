-- Agno Platform — Row Level Security
--
-- ÖNEMLİ: `drizzle-kit push` tabloları yeniden oluştururken RLS'i KAPATIR.
-- Bu dosya her şema değişikliğinden sonra ÇALIŞTIRILMAK ZORUNDA.
-- `npm run db:sync` bunu otomatik yapar — çıplak `db:push` kullanma.
--
-- Idempotent: tekrar tekrar çalıştırılabilir.

GRANT USAGE ON SCHEMA public TO agno_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agno_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agno_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agno_app;

-- tenant_id kolonu taşıyan HER tabloya politika uygula (otomatik keşif).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
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

-- tenants tablosunun kendisi: kiracı yalnızca kendi satırını görür
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- NOT: `ALTER ROLE agno_owner BYPASSRLS` burada DEĞİL — superuser gerektirir ve
-- kalıcıdır. Bir kerelik kurulum: scripts/db-bootstrap.sql
