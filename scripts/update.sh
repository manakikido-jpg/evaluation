#!/usr/bin/env bash
# 新しいコードに更新して再起動する
set -euo pipefail
cd "$(dirname "$0")/.."
# 念のため先にバックアップ
./scripts/backup.sh
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
