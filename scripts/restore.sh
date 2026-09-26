#!/usr/bin/env bash
# バックアップから戻す:  ./scripts/restore.sh backups/sakuranomiya-YYYYmmdd-HHMMSS.sql.gz
# 今のデータは消えるので注意（戻している間は BOT と管理画面を止める）
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?使い方: ./scripts/restore.sh backups/xxx.sql.gz}"

# 消す前に、戻すファイルが本当に使えるか確かめる
[ -f "$file" ] || { echo "❌ ファイルがありません: $file"; exit 1; }
gunzip -t "$file" 2>/dev/null || { echo "❌ ファイルが壊れています: $file"; exit 1; }

read -r -p "今のデータを消して $file に戻します。よろしいですか？ (yes/no) " ok
[ "$ok" = "yes" ] || { echo "やめました"; exit 1; }

# 戻している間に自動更新が動かないように
exec 9>/tmp/sakuranomiya-auto-update.lock
flock -n 9 || { echo "❌ 今、更新が動いています。終わってからもう一度実行してください。"; exit 1; }

docker compose stop bot web
# 途中で失敗しても、BOT と管理画面は必ず動かし直す
trap 'docker compose start bot web >/dev/null 2>&1 || true' EXIT
docker compose exec -T db psql -U sakura -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS sakuranomiya;' -c 'CREATE DATABASE sakuranomiya OWNER sakura;'
gunzip -c "$file" | docker compose exec -T db psql -U sakura -d sakuranomiya -q -v ON_ERROR_STOP=1 --single-transaction
echo "restored: $file"
