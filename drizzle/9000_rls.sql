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
