#!/usr/bin/env bash
# 鯖の外に置いたバックアップを開く: ./scripts/decrypt-backup.sh ダウンロードしたファイル（.enc.part00 …。分かれていたら全部）
#   あいことば（BACKUP_PASSPHRASE）を聞かれるので入れる（画面には出ない）
#   できたファイル（backups/xxx.sql.gz）を ./scripts/restore.sh で戻す
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$#" -ge 1 ] || { echo "使い方: ./scripts/decrypt-backup.sh xxx.sql.gz.enc.part00 [xxx.sql.gz.enc.part01 …]"; exit 1; }
for f in "$@"; do [ -f "$f" ] || { echo "❌ ファイルがありません: $f"; exit 1; }; done

pass="${BACKUP_PASSPHRASE:-}"
if [ -z "$pass" ]; then
  read -r -s -p "あいことば: " pass
  echo
fi
mkdir -p backups
first="$(basename "$1")"
out="backups/${first%%.enc*}"
case "$out" in *.sql.gz) ;; *) out="$out.sql.gz" ;; esac
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT
# 分かれたファイルは番号の順につなげる
printf '%s\n' "$@" | sort | while read -r f; do cat "$f"; done |
  BACKUP_PASSPHRASE="$pass" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -out "$tmp" -pass env:BACKUP_PASSPHRASE ||
  { echo "❌ 開けませんでした（あいことばがちがうか、ファイルが足りません）"; exit 1; }
gunzip -t "$tmp" 2>/dev/null || { echo "❌ 開けたけれど中身が壊れています（ファイルが足りないかもしれません）"; exit 1; }
mv "$tmp" "$out"
echo "✅ できました: $out"
echo "   戻すときは: ./scripts/restore.sh $out"
