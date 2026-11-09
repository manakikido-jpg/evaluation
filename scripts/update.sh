#!/usr/bin/env bash
# 新しいコードに更新して再起動する（auto-update.sh からも呼ばれる）
#   取り込めないとき（手元で書き換えたファイルがある・履歴が変わった）は、バックアップも取らずに止める
#   新しいコードで起動できなかったら、前のコードに戻す
set -euo pipefail
cd "$(dirname "$0")/.."

branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$branch"
before=$(git rev-parse HEAD)
target=$(git rev-parse "origin/$branch")
if [ "$before" = "$target" ]; then
  echo "すでに最新です（${before:0:7}）"
  exit 0
fi
if ! git merge-base --is-ancestor HEAD "origin/$branch"; then
  echo "❌ 取り込めません（GitHub 側の履歴が書き換えられています）。手で確認してください: git status / git log"
  exit 1
fi
changed=$(git diff --name-only HEAD "origin/$branch")
if [ -n "$changed" ] && ! git diff --quiet HEAD -- $changed; then
  echo "❌ 取り込めません。VPS で書き換えたファイルが、新しいコードでも変わっています:"
  git diff --name-only HEAD -- $changed
  exit 1
fi

# 念のため先にバックアップ（更新の前の分は、新しい 5 個だけ残す）
BACKUP_KIND=update ./scripts/backup.sh
git merge -q --ff-only "origin/$branch"
# 🚀 いま動いている版をイメージに入れる（社務所Web の更新履歴に出す）
export GIT_COMMIT="$target"

# bot と web が動き始めるまで待つ（最大 3 分）。
# Docker の healthy の表示は 30 秒おきにしか変わらないので、2 秒おきに中から直接たずねる（早く終わる）
bot_probe="const p=process.env.HEALTH_PORT||'8080';if(p==='0')process.exit(0);fetch('http://localhost:'+p).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
web_probe="fetch('http://localhost:'+(process.env.WEB_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
probe() { timeout 10 docker compose exec -T "$1" node -e "$2" >/dev/null 2>&1; }
wait_healthy() {
  local ids status
  for _ in $(seq 1 90); do
    sleep 2
    ids=$(docker compose ps -q bot web)
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ids | sort -u | tr '\n' ' ')
    case "$status" in
      "healthy ") return 0 ;;
      *unhealthy*|*exited*|*dead*) break ;;
    esac
    if probe bot "$bot_probe" && probe web "$web_probe"; then return 0; fi
  done
  echo "起動の状態: $status"
  return 1
}

# 組み立ては 1 つずつ（同時に 3 つ組み立てると TypeScript の変換でメモリが足りなくなる）。
# web・setup は bot と同じイメージ（sakuranomiya-app）を使うので、組み立ては bot の 1 回だけ
# up には --build を付けない（すぐ上で組み立てたイメージを、web も同じく使う。もう一度組み立てを確かめる時間を省く）
started=$SECONDS
if ! docker compose build bot || ! docker compose up -d || ! wait_healthy; then
  echo "❌ 新しいコード（${target:0:7}）で起動できませんでした。前のコード（${before:0:7}）に戻します"
  docker compose logs --tail 30 bot web || true
  git reset -q --hard "$before"
  export GIT_COMMIT="$before"
  docker compose build bot || true
  docker compose up -d
  exit 1
fi
echo "🚀 反映しました: ${target:0:7}（組み立てから起動まで $((SECONDS - started)) 秒）"
# セットアップ用（docker compose run --rm setup）も bot と同じイメージを使う
docker image prune -f >/dev/null
# 組み立てのたびにたまる古いキャッシュを消す（ディスクがいっぱいになって更新が止まらないように）
docker builder prune -f --filter until=24h >/dev/null || true
docker compose ps
