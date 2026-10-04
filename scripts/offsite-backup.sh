#!/usr/bin/env bash
# バックアップを鯖の外（Discord の宮司だけのチャンネル）にも置く: ./scripts/offsite-backup.sh backups/xxx.sql.gz
#   .env に BACKUP_WEBHOOK_URL（そのチャンネルの Webhook の URL）と BACKUP_PASSPHRASE（暗号のあいことば）があるときだけ動く
#   暗号にしてから送る（あいことばがないと開けない）。9MB ごとに分けて送る（Discord の 1 ファイルの上限より小さく）
#   1 日 1 回だけ送る（更新の前のバックアップでは送らない）。すぐ送りたいときは FORCE=1
#   戻すとき: ./scripts/decrypt-backup.sh（ダウンロードしたファイル）→ ./scripts/restore.sh
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?使い方: ./scripts/offsite-backup.sh backups/xxx.sql.gz}"

# .env から 1 つ読む（引用符は外す）
env_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
url="${BACKUP_WEBHOOK_URL:-$(env_value BACKUP_WEBHOOK_URL)}"
pass="${BACKUP_PASSPHRASE:-$(env_value BACKUP_PASSPHRASE)}"
if [ -z "$url" ] || [ -z "$pass" ]; then
  echo "offsite: BACKUP_WEBHOOK_URL と BACKUP_PASSPHRASE が .env にないので、鯖の外には送りません"
  exit 0
fi

# 1 日 1 回（前に送ってから 20 時間たっていなければ送らない）
stamp="backups/.offsite-last"
if [ "${FORCE:-0}" != "1" ] && [ -f "$stamp" ] && [ -n "$(find "$stamp" -mmin -1200)" ]; then
  echo "offsite: 今日はもう送っています"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
name="$(basename "$file" .sql.gz)"
enc="$work/$name.sql.gz.enc"
BACKUP_PASSPHRASE="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$file" -out "$enc" -pass env:BACKUP_PASSPHRASE
split -b 9m -d -a 2 "$enc" "$enc.part"
parts=("$enc".part*)
total="${#parts[@]}"
size="$(du -h "$file" | cut -f1)"

post() {
  # $1: 文（JSON に入れる）・$2: ファイル（なくてもよい）
  local args=(-sS -f --retry 3 --retry-delay 5 -o /dev/null -F "payload_json={\"content\":\"$1\",\"allowed_mentions\":{\"parse\":[]}}")
  [ -n "${2:-}" ] && args+=(-F "files[0]=@$2")
  curl "${args[@]}" "$url"
}

n=0
for part in "${parts[@]}"; do
  n=$((n + 1))
  if ! post "🗄 バックアップ ${name}（${size}・暗号つき）${n}/${total}" "$part"; then
    post "⚠ バックアップ ${name} を送れませんでした（${n}/${total} で止まりました）。VPS の backup.log を見てください" || true
    echo "offsite: 送れませんでした (${n}/${total})" >&2
    exit 1
  fi
done
touch "$stamp"
echo "offsite: 送りました ${name} (${total} 個)"
