#!/usr/bin/env bash
# 読み上げ専用BOTの秘密の設定ファイルを作る（値は画面にも履歴にも出さない）
#   使い方: sudo bash scripts/read-aloud-env.sh
#   作るもの: /etc/sakura/read-aloud.env（root だけが読める。リポジトリの外）
#   聞くこと: 対象サーバーのID、読上 壱〜拾 のトークン（この順に登録する。先頭の壱が受付）
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo を付けて実行してください: sudo bash scripts/read-aloud-env.sh" >&2
  exit 1
fi

dir=/etc/sakura
file="$dir/read-aloud.env"
umask 077
install -d -m 700 "$dir"

read -rsp "対象サーバーのID: " gid; echo
if ! [[ "$gid" =~ ^[0-9]{17,20}$ ]]; then
  echo "サーバーIDは 17〜20 けたの数字です。やり直してください。" >&2
  exit 1
fi

toks=""
for n in 壱 弐 参 肆 伍 陸 漆 捌 玖 拾; do
  read -rsp "読上 $n のトークン: " t; echo
  if [ -z "$t" ] || [[ "$t" =~ [[:space:],] ]]; then
    echo "読上 $n のトークンが空か、空白・カンマが入っています。やり直してください。" >&2
    exit 1
  fi
  toks="$toks${toks:+,}$t"
done

tmp="$(mktemp "$dir/.read-aloud.XXXXXX")"
printf 'READ_ALOUD_ENABLED=on\nREAD_ALOUD_GUILD_ID=%s\nREAD_ALOUD_BOT_TOKENS=%s\n' "$gid" "$toks" > "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
unset t toks gid

count="$(awk -F= '/^READ_ALOUD_BOT_TOKENS=/{print split($2, a, ",")}' "$file")"
echo "保存しました: $file（トークン ${count} 個・中身は表示しません）"
