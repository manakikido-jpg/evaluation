#!/usr/bin/env bash
# 読み上げ専用BOTの秘密の設定ファイルを作る・直す（トークンは画面にも履歴にも出さない）
#   使い方: sudo bash scripts/read-aloud-env.sh
#   作るもの: /etc/sakura/read-aloud.env（root だけが読める。リポジトリの外）
#   聞くこと: 対象サーバーのID、読上 壱〜拾 のトークン（この順に登録する。先頭の壱が受付）
#   もう設定があるときは、何も入れずに Enter を押すと、今の値のまま残す（変えたい BOT だけ入れればよい）
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "sudo を付けて実行してください: sudo bash scripts/read-aloud-env.sh" >&2
  exit 1
fi

dir=/etc/sakura
file="$dir/read-aloud.env"
umask 077
install -d -m 700 "$dir"

# 今の値（あれば）
old_gid=""
old_toks=()
if [ -r "$file" ]; then
  old_gid="$(sed -n 's/^READ_ALOUD_GUILD_ID=//p' "$file")"
  IFS=',' read -r -a old_toks <<< "$(sed -n 's/^READ_ALOUD_BOT_TOKENS=//p' "$file")"
fi

# サーバーIDは秘密ではないので、打った文字を見せる（打ち間違いに気づけるように）
if [ -n "$old_gid" ]; then
  read -rp "対象サーバーのID（Enter だけで今の ${old_gid} のまま）: " gid
  gid="${gid:-$old_gid}"
else
  read -rp "対象サーバーのID: " gid
fi
gid="${gid//[[:space:]]/}"
if ! [[ "$gid" =~ ^[0-9]{17,20}$ ]]; then
  echo "サーバーIDは 17〜20 けたの数字です（受け取ったのは ${#gid} 文字）。やり直してください。" >&2
  exit 1
fi

toks=""
i=0
for n in 壱 弐 参 肆 伍 陸 漆 捌 玖 拾; do
  old="${old_toks[$i]:-}"
  if [ -n "$old" ]; then
    read -rsp "読上 $n のトークン（Enter だけで今のまま）: " t; echo
    t="${t:-$old}"
  else
    read -rsp "読上 $n のトークン: " t; echo
  fi
  t="${t//[[:space:]]/}"
  if [ -z "$t" ] || [[ "$t" == *,* ]]; then
    echo "読上 $n のトークンが空か、カンマが入っています。やり直してください。" >&2
    exit 1
  fi
  [ "$t" != "$old" ] && echo "  → 読上 $n を新しいトークンにします（${#t} 文字）"
  toks="$toks${toks:+,}$t"
  i=$((i + 1))
done

tmp="$(mktemp "$dir/.read-aloud.XXXXXX")"
printf 'READ_ALOUD_ENABLED=on\nREAD_ALOUD_GUILD_ID=%s\nREAD_ALOUD_BOT_TOKENS=%s\n' "$gid" "$toks" > "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
unset t toks old old_toks

count="$(awk -F= '/^READ_ALOUD_BOT_TOKENS=/{print split($2, a, ",")}' "$file")"
echo "保存しました: $file（トークン ${count} 個・中身は表示しません）"
