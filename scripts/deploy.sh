#!/usr/bin/env bash
# Agno Platform — VPS dağıtımı
#
# ÖNEMLİ: --exclude .env* zorunlu. Sunucudaki üretim sırları yerel
# geliştirme .env'i tarafından EZİLMEMELİ (bir kez yaşandı, DB auth kırıldı).
set -euo pipefail

HOST="${DEPLOY_HOST:-agno-new-vps}"
DIR="${DEPLOY_DIR:-/data/agno-platform}"

echo "==> Kod gönderiliyor ($HOST:$DIR)"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git \
  --exclude test-results --exclude playwright-report \
  --exclude '.env' --exclude '.env.local' --exclude '.env.production' \
  ./ "$HOST:$DIR/"

echo "==> İmaj derleniyor"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml build"

echo "==> Şema + RLS uygulanıyor (ayrılamaz — push RLS'i kapatır)"
# AĞ: coolify ağında 4 konteyner "postgres" adını paylaşıyor (bizimki, coolify-db,
# cardflow, agnoyntm). Round-robin DNS bizi yabancı bir veritabanına götürüp
# auth_failed veriyordu. Şema işi HER ZAMAN izole internal ağında koşar.
ssh "$HOST" "cd $DIR && docker run --rm --network agno-platform_internal --env-file .env.production agno-platform:latest npx drizzle-kit push --force"
ssh "$HOST" "cd $DIR && docker exec -i agno_platform_pg psql -U agno_owner -d agno_platform -v ON_ERROR_STOP=1 < drizzle/rls.sql"

echo "==> Şema doğrulanıyor"
# drizzle-kit push başarısız olsa bile 0 ile çıkıyor — tablo sayısını kendimiz sayıyoruz.
EXPECTED=$(grep -c "= pgTable(" src/db/schema/*.ts | awk -F: '{s+=$2} END {print s}')
ACTUAL=$(ssh "$HOST" "docker exec agno_platform_pg psql -U agno_owner -d agno_platform -tAc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE '__drizzle%';\"" | tr -d '[:space:]')
[ "$ACTUAL" -ge "$EXPECTED" ] || { echo "HATA: şema geride — beklenen $EXPECTED tablo, sunucuda $ACTUAL" >&2; exit 1; }
echo "    $ACTUAL tablo mevcut (beklenen en az $EXPECTED)"

echo "==> RLS doğrulanıyor"
ssh "$HOST" "cd $DIR && docker exec agno_platform_pg psql -U agno_owner -d agno_platform -tAc \"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND c.relname NOT LIKE '__drizzle%';\"" | grep -qx 0 || { echo 'HATA: korumasız tablo var' >&2; exit 1; }

echo "==> Servisler kaldırılıyor"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml up -d"

echo "==> Durum"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml ps --format 'table {{.Name}}\t{{.Status}}'"
