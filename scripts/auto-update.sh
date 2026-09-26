#!/usr/bin/env bash
# 新しいコードが GitHub に届いていたら、自動で update.sh を実行する。
# cron で 5 分おきに動かす（docs/deploy-vps.md「8. 更新」）。新しいコードがなければ何もしない。
# 更新に失敗したコードは、何度も試さない（ログに 1 回だけ残す。新しいコードが届いたらまた試す）
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
failed_file=.git/auto-update-failed
if [ "$(cat "$failed_file" 2>/dev/null)" = "$next" ]; then
  say "このコード（${next:0:7}）は前に更新に失敗したので、試しません。手で ./scripts/update.sh を実行すると、もう一度試せます"
  exit 0
fi

echo "=== $(date '+%F %T') 更新: ${now:0:7} → ${next:0:7}"
if ./scripts/update.sh; then
  rm -f "$failed_file"
  echo "=== $(date '+%F %T') 完了"
else
  echo "$next" > "$failed_file"
  echo "=== $(date '+%F %T') ❌ 失敗（${next:0:7}）。次に新しいコードが届くまで、自動では試しません"
  exit 1
fi
