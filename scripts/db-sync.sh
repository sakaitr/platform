#!/usr/bin/env bash
# Şema + RLS'i birlikte uygular.
# drizzle-kit push RLS'i KAPATIR — ikisi ASLA ayrılmamalı.
# Çıplak `drizzle-kit push` kullanma, hep bunu kullan.
set -euo pipefail

# .env yükle (zaten dışarıdan verilmişse üzerine yazma)
if [ -f .env ] && [ -z "${DATABASE_ADMIN_URL:-}" ]; then
  set -a; . ./.env; set +a
fi
DB_URL="${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL gerekli}"
DB_URL="${DB_URL%\"}"; DB_URL="${DB_URL#\"}"

DATABASE_ADMIN_URL="$DB_URL" npx drizzle-kit push --force
psql "$DB_URL" -v ON_ERROR_STOP=1 -f drizzle/rls.sql >/dev/null

POLICIES=$(psql "$DB_URL" -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public';")
UNPROTECTED=$(psql "$DB_URL" -tAc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND c.relname NOT LIKE '__drizzle%';")

echo "Şema + RLS uygulandı — $POLICIES politika, $UNPROTECTED korumasız tablo"
if [ "$UNPROTECTED" != "0" ]; then
  echo "HATA: korumasız tablo var!" >&2
  exit 1
fi
