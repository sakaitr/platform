-- Bir kerelik veritabanı kurulumu — SUPERUSER ile çalıştırılır.
-- Roller ve BYPASSRLS kalıcıdır, şema değişikliklerinde tekrar gerekmez.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agno_app') THEN
    CREATE ROLE agno_app LOGIN PASSWORD 'app_dev';
  END IF;
END $$;

ALTER ROLE agno_owner BYPASSRLS;
GRANT USAGE ON SCHEMA public TO agno_app;
