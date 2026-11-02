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

# bot と web が healthy になるまで待つ（最大 3 分）
wait_healthy() {
  local ids status
  for _ in $(seq 1 36); do
    sleep 5
    ids=$(docker compose ps -q bot web)
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ids | sort -u | tr '\n' ' ')
    case "$status" in
      "healthy ") return 0 ;;
      *unhealthy*|*exited*|*dead*) break ;;
    esac
  done
  echo "起動の状態: $status"
  return 1
}

# 組み立ては 1 つずつ（同時に 3 つ組み立てると TypeScript の変換でメモリが足りなくなる）。
# bot を先に組み立てれば、同じ中身の web・setup はキャッシュを使うので、変換は 1 回で済む
if ! docker compose build bot || ! docker compose up -d --build || ! wait_healthy; then
  echo "❌ 新しいコード（${target:0:7}）で起動できませんでした。前のコード（${before:0:7}）に戻します"
  docker compose logs --tail 30 bot web || true
  git reset -q --hard "$before"
  docker compose build bot || true
  docker compose up -d --build
  exit 1
fi
# セットアップ用も新しいコードで作っておく（docker compose run --rm setup で使う）
docker compose --profile setup build -q setup || true
docker image prune -f >/dev/null
# 組み立てのたびにたまる古いキャッシュを消す（ディスクがいっぱいになって更新が止まらないように）
docker builder prune -f --filter until=24h >/dev/null || true
docker compose ps
