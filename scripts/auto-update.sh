#!/usr/bin/env bash
# 新しいコードが GitHub に届いていたら、自動で update.sh を実行する。
# cron で 5 分おきに動かす（docs/deploy-vps.md「8. 更新」）。新しいコードがなければ何もしない。
set -euo pipefail
cd "$(dirname "$0")/.."

# 手で動かしたとき（画面があるとき）だけ、何もしなかった理由を出す（cron のログには書かない）
say() { if [ -t 1 ]; then echo "$1"; fi; }

# 前の更新がまだ動いていたら、今回は何もしない
exec 9>/tmp/sakuranomiya-auto-update.lock
flock -n 9 || { say "今ほかの更新が動いています。終わるまで待ってください（tail -f ~/auto-update.log で見られます）"; exit 0; }

branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$branch"
now=$(git rev-parse HEAD)
next=$(git rev-parse "origin/$branch")
if [ "$now" = "$next" ]; then
  say "すでに最新です（${now:0:7}）"
  exit 0
fi

echo "=== $(date '+%F %T') 更新: ${now:0:7} → ${next:0:7}"
# 作り直しに失敗したときは、今動いているものがそのまま残る（docker compose は作り終えてから入れ替える）
./scripts/update.sh
echo "=== $(date '+%F %T') 完了"
