#!/usr/bin/env bash
# データベースのバックアップ（毎日 cron で実行する想定）
#   保存先: backups/sakuranomiya-YYYYmmdd-HHMM.sql.gz
#   KEEP_DAYS（既定 7）日より古いものは消す
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-7}"
mkdir -p backups
file="backups/sakuranomiya-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U sakura -d sakuranomiya --no-owner | gzip > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name 'sakuranomiya-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup: $file ($(du -h "$file" | cut -f1))"
