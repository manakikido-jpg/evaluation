#!/usr/bin/env bash
# バックアップから戻す:  ./scripts/restore.sh backups/sakuranomiya-YYYYmmdd-HHMM.sql.gz
# 今のデータは消えるので注意（BOT と管理画面は止めてから戻す）
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?使い方: ./scripts/restore.sh backups/xxx.sql.gz}"
read -r -p "今のデータを消して $file に戻します。よろしいですか？ (yes/no) " ok
[ "$ok" = "yes" ] || { echo "やめました"; exit 1; }
docker compose stop bot web
docker compose exec -T db psql -U sakura -d postgres -c 'DROP DATABASE IF EXISTS sakuranomiya;' -c 'CREATE DATABASE sakuranomiya OWNER sakura;'
gunzip -c "$file" | docker compose exec -T db psql -U sakura -d sakuranomiya -q
docker compose start bot web
echo "restored: $file"
