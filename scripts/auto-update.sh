#!/usr/bin/env bash
# 新しいコードが GitHub に届いていたら、自動で update.sh を実行する。
# cron で 1 分おきに動かす（docs/deploy-vps.md「8. 更新」）。1 回動くと、その 1 分の中で 15 秒おきに 4 回確かめる
# （cron は 1 分より短くできないため。新しいコードがなければ何もしない。確かめるだけなので VPS の負担はほとんどない）。
# 手で動かしたとき（画面があるとき）は、1 回だけ確かめる。
# 更新に失敗したコードは、何度も試さない（ログに 1 回だけ残す。新しいコードが届いたらまた試す）
set -euo pipefail
cd "$(dirname "$0")/.."
# 全体を { } に入れて、先に全部読みこんでから動かす（更新でこのファイル自身が書き換わっても、途中から変な所を読まないように）
{

# 確かめる間隔（秒）。AUTO_UPDATE_EVERY=60 にすると、前と同じ 1 分に 1 回
every=${AUTO_UPDATE_EVERY:-15}

# 手で動かしたとき（画面があるとき）だけ、何もしなかった理由を出す（cron のログには書かない）
say() { if [ -t 1 ]; then echo "$1"; fi; }

lock=/tmp/sakuranomiya-auto-update.lock
failed_file=.git/auto-update-failed

updated=0
# 1 回確かめて、新しいコードがあれば更新する（0 = 何もしなかった・更新した、1 = 失敗した）
check() {
  # 前の更新がまだ動いていたら、今回は何もしない（待っている間はロックを持たない）
  exec 9>"$lock"
  if ! flock -n 9; then
    exec 9>&-
    say "今ほかの更新が動いています。終わるまで待ってください（tail -f ~/auto-update.log で見られます）"
    return 0
  fi
  local branch now next
  branch=$(git rev-parse --abbrev-ref HEAD)
  git fetch -q origin "$branch"
  now=$(git rev-parse HEAD)
  next=$(git rev-parse "origin/$branch")
  if [ "$now" = "$next" ]; then
    say "すでに最新です（${now:0:7}）"
    exec 9>&-
    return 0
  fi
  if [ "$(cat "$failed_file" 2>/dev/null)" = "$next" ]; then
    say "このコード（${next:0:7}）は前に更新に失敗したので、試しません。手で ./scripts/update.sh を実行すると、もう一度試せます"
    exec 9>&-
    return 0
  fi

  echo "=== $(date '+%F %T') 更新: ${now:0:7} → ${next:0:7}"
  if ./scripts/update.sh; then
    rm -f "$failed_file"
    echo "=== $(date '+%F %T') 完了"
    exec 9>&-
    updated=1
    return 0
  fi
  echo "$next" > "$failed_file"
  echo "=== $(date '+%F %T') ❌ 失敗（${next:0:7}）。次に新しいコードが届くまで、自動では試しません"
  exec 9>&-
  return 1
}

# 手で動かしたとき・間隔が 1 分以上なら 1 回だけ
if [ -t 1 ] || [ "$every" -ge 60 ]; then
  check
  exit $?
fi

# cron から: 次の cron（1 分後）とぶつからないように、はじめの 45 秒の中で確かめる（0・15・30・45 秒）
start=$SECONDS
while :; do
  check || exit 1
  # 更新したら、この回はおしまい（新しいスクリプトで、次の cron から確かめる）
  [ "$updated" = 0 ] || break
  [ $((SECONDS - start + every)) -le 45 ] || break
  sleep "$every"
done
exit 0
}
