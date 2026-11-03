#!/usr/bin/env bash
# データベースのバックアップ（毎日 cron で実行する想定。更新の前にも自動で実行される）
#   保存先: backups/sakuranomiya-YYYYmmdd-HHMMSS.sql.gz
#   KEEP_DAYS（既定 7）日より古いものは消す
#   BACKUP_KIND=update（更新の前）のときは backups/sakuranomiya-update-….sql.gz にして、新しい KEEP_UPDATES（既定 5）個だけ残す。書き込みの記録の写真は入れない
#   （更新は 1 日に何十回もあるので、7 日分を残すとディスクがいっぱいになる）
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-7}"
KEEP_UPDATES="${KEEP_UPDATES:-5}"
mkdir -p backups

# 毎日のバックアップと更新前のバックアップが同時に動いても、1 つずつ順番に
exec 8>/tmp/sakuranomiya-backup.lock
flock 8

if [ "${BACKUP_KIND:-}" = update ]; then
  file="backups/sakuranomiya-update-$(date +%Y%m%d-%H%M%S).sql.gz"
else
  file="backups/sakuranomiya-$(date +%Y%m%d-%H%M%S).sql.gz"
fi
tmp="$file.tmp"
trap 'rm -f "$tmp"' EXIT
# 更新の前の分は、書き込みの記録の写真（message_archive_files。DB のほとんどを占める）の中身を入れない（表の形は入れる）。
# 更新で壊れたときに戻すためのもので、写真がなくても困らない。毎日の分と鯖の外には、写真も入れる
extra=()
[ "${BACKUP_KIND:-}" = update ] && extra=(--exclude-table-data=message_archive_files)
docker compose exec -T db pg_dump -U sakura -d sakuranomiya --no-owner "${extra[@]}" | gzip > "$tmp"
# 壊れたファイルを「バックアップ」として残さない
gunzip -t "$tmp"
mv "$tmp" "$file"
find backups -name 'sakuranomiya-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find backups -name '*.tmp' -mmin +60 -delete
# 更新の前のバックアップは、新しいものから KEEP_UPDATES 個だけ残す
ls -1t backups/sakuranomiya-update-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_UPDATES + 1))" | xargs -r rm -f -- || true
echo "backup: $file ($(du -h "$file" | cut -f1))"
# 鯖の外（Discord の宮司だけのチャンネル）にも 1 日 1 回。.env に設定がなければ何もしない。失敗しても、ここのバックアップはできている
./scripts/offsite-backup.sh "$file" || echo "offsite: 失敗しました（ここのバックアップはできています）" >&2
# Google ドライブにも 1 日 1 回（rclone とあいことばがなければ何もしない）。更新の前のバックアップでは送らない
if [ "${BACKUP_KIND:-}" != update ]; then
  ./scripts/gdrive-backup.sh "$file" || echo "gdrive: 失敗しました（ここのバックアップはできています）" >&2
fi
