#!/usr/bin/env bash
# データベースのバックアップ（毎日 cron で実行する想定。更新の前にも自動で実行される）
#   保存先: backups/sakuranomiya-YYYYmmdd-HHMMSS.sql.gz
#   KEEP_DAYS（既定 7）日より古いものは消す
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-7}"
mkdir -p backups

# 毎日のバックアップと更新前のバックアップが同時に動いても、1 つずつ順番に
exec 8>/tmp/sakuranomiya-backup.lock
flock 8

file="backups/sakuranomiya-$(date +%Y%m%d-%H%M%S).sql.gz"
tmp="$file.tmp"
trap 'rm -f "$tmp"' EXIT
docker compose exec -T db pg_dump -U sakura -d sakuranomiya --no-owner | gzip > "$tmp"
# 壊れたファイルを「バックアップ」として残さない
gunzip -t "$tmp"
mv "$tmp" "$file"
find backups -name 'sakuranomiya-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find backups -name '*.tmp' -mmin +60 -delete
echo "backup: $file ($(du -h "$file" | cut -f1))"
# 鯖の外（Discord の宮司だけのチャンネル）にも 1 日 1 回。.env に設定がなければ何もしない。失敗しても、ここのバックアップはできている
./scripts/offsite-backup.sh "$file" || echo "offsite: 失敗しました（ここのバックアップはできています）" >&2
