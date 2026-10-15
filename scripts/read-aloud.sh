#!/usr/bin/env bash
# 読み上げ専用BOTを短いコマンドで動かす（コンソールで長いコマンドを打たなくてよいように）
#   bash scripts/read-aloud.sh up      … 作り直して起動する（いつも起動し直す）
#   bash scripts/read-aloud.sh logs    … 2 分以内のログを見る
#   bash scripts/read-aloud.sh ps      … 動いているか見る
#   bash scripts/read-aloud.sh down    … 止める（読み上げだけ。社務所BOT・DB・Webは止まらない）
# 秘密の設定は /etc/sakura/read-aloud.env（scripts/read-aloud-env.sh で作る）。中身は表示しない。
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=/etc/sakura/read-aloud.env
dc() { docker compose -p sakura-read-aloud -f docker-compose.read-aloud.yml --env-file "$env_file" "$@"; }

if [ ! -r "$env_file" ]; then
  echo "$env_file が読めません。sudo を付けるか、先に scripts/read-aloud-env.sh で作ってください。" >&2
  exit 1
fi

case "${1:-}" in
  up) dc up -d --build --force-recreate ;;
  logs) dc logs --since "${2:-2m}" read-aloud ;;
  ps) dc ps ;;
  down) dc down ;;
  *)
    echo "使い方: bash scripts/read-aloud.sh up | logs | ps | down" >&2
    exit 1
    ;;
esac
