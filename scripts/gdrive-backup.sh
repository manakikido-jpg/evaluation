#!/usr/bin/env bash
# バックアップを Google ドライブにも置く: ./scripts/gdrive-backup.sh backups/xxx.sql.gz
#   rclone で Google ドライブをつないであって（リモート名は GDRIVE_REMOTE。既定 gdrive）、
#   .env に BACKUP_PASSPHRASE（暗号のあいことば）があるときだけ動く。どちらかがなければ何もしない
#   暗号にしてから送る（あいことばがないと開けない）。1 日 1 回だけ（更新の前のバックアップでは送らない）。すぐ送りたいときは FORCE=1
#   ドライブの GDRIVE_DIR（既定 sakuranomiya-backups）に置き、GDRIVE_KEEP_DAYS（既定 30）日より古いものは消す
#   戻すとき: ドライブからダウンロード → ./scripts/decrypt-backup.sh（ファイル）→ ./scripts/restore.sh
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?使い方: ./scripts/gdrive-backup.sh backups/xxx.sql.gz}"

# .env から 1 つ読む（引用符は外す）
env_value() {
  [ -f .env ] || return 0
  { grep -E "^$1=" .env || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
pass="${BACKUP_PASSPHRASE:-$(env_value BACKUP_PASSPHRASE)}"
remote="${GDRIVE_REMOTE:-$(env_value GDRIVE_REMOTE)}"; remote="${remote:-gdrive}"
dir="${GDRIVE_DIR:-$(env_value GDRIVE_DIR)}"; dir="${dir:-sakuranomiya-backups}"
keep="${GDRIVE_KEEP_DAYS:-$(env_value GDRIVE_KEEP_DAYS)}"; keep="${keep:-30}"
if ! command -v rclone >/dev/null 2>&1; then
  echo "gdrive: rclone が入っていないので、Google ドライブには送りません"
  exit 0
fi
if ! rclone listremotes 2>/dev/null | grep -qx "${remote}:"; then
  echo "gdrive: rclone に「${remote}」がつながっていないので、Google ドライブには送りません"
  exit 0
fi
if [ -z "$pass" ]; then
  echo "gdrive: BACKUP_PASSPHRASE が .env にないので、Google ドライブには送りません（暗号なしでは送らない）"
  exit 0
fi

# 1 日 1 回（前に送ってから 20 時間たっていなければ送らない）
stamp="backups/.gdrive-last"
if [ "${FORCE:-0}" != "1" ] && [ -f "$stamp" ] && [ -n "$(find "$stamp" -mmin -1200)" ]; then
  echo "gdrive: 今日はもう送っています"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
name="$(basename "$file" .sql.gz)"
enc="$work/$name.sql.gz.enc"
BACKUP_PASSPHRASE="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$file" -out "$enc" -pass env:BACKUP_PASSPHRASE
rclone copyto --retries 3 "$enc" "${remote}:${dir}/$name.sql.gz.enc"
# 古いものは消す（消せなくても、送れたことは変わらない）
rclone delete --min-age "${keep}d" "${remote}:${dir}" || echo "gdrive: 古いものを消せませんでした" >&2
touch "$stamp"
echo "gdrive: 送りました ${name}（$(du -h "$enc" | cut -f1)・暗号つき）"
