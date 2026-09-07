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

echo "==> Şema uygulanıyor"
ssh "$HOST" "cd $DIR && docker run --rm --network coolify --env-file .env.production agno-platform:latest npx drizzle-kit push --force"

echo "==> RLS uygulanıyor"
ssh "$HOST" "cd $DIR && docker exec -i agno_platform_pg psql -U agno_owner -d agno_platform -v ON_ERROR_STOP=1 < drizzle/9000_rls.sql"

echo "==> Servisler kaldırılıyor"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml up -d"

echo "==> Durum"
ssh "$HOST" "cd $DIR && docker compose -f docker-compose.prod.yml ps --format 'table {{.Name}}\t{{.Status}}'"
