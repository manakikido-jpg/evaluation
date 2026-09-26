# VPS で動かす手順

> **VPS に入る（毎回これから）**
> 1. パソコンで PowerShell を開く（スタートメニューで「PowerShell」と検索）。行頭は `PS C:\Users\…>`（＝パソコン）
> 2. `ssh shamusho@（VPS の IP）` → パスワードを入れる（文字は表示されない）
> 3. 行頭が `shamusho@vm-…:~$` になれば VPS の中。`cd ~/evaluation` してから `docker compose …` などを実行する
> 4. 終わったら `exit` でパソコンに戻る

BOT・管理画面・データベースを 1 台の VPS で動かす。所要時間は 1〜2 時間。
テストが終わるまでは **テスト用の Discord サーバー** で動かし、本番の咲楽ノ宮は後で作る（[test-checklist.md](test-checklist.md)）。

---

## 1. VPS を借りる

| 項目 | おすすめ |
|---|---|
| 会社 | 国内なら ConoHa VPS / Xserver VPS / さくらの VPS など（どこでも動く） |
| メモリ | **2GB**（1000 人規模まで余裕あり） |
| OS | **Ubuntu 24.04 LTS** |
| ログイン | **SSH 鍵**を登録する（パスワードだけのログインにしない） |

借りたら、VPS の **IP アドレス**をメモする。

---

## 2. 最初の設定（1 回だけ）

パソコンのターミナル（Windows は PowerShell）から VPS に入る:
```bash
ssh root@（VPS の IP アドレス）
```

### 2-1. 作業用ユーザーを作る
```bash
adduser shamusho            # パスワードを決める
usermod -aG sudo shamusho
mkdir -p /home/shamusho/.ssh
cp ~/.ssh/authorized_keys /home/shamusho/.ssh/
chown -R shamusho:shamusho /home/shamusho/.ssh
```
一度抜けて、`ssh shamusho@（IP）` で入れることを確かめる。以降はこのユーザーで作業する。

### 2-2. 安全のための設定
```bash
# パスワードでの SSH ログインを禁止（鍵だけにする）
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# ファイアウォール: SSH・HTTP・HTTPS だけ開ける
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# セキュリティ更新を自動で入れる
sudo apt update && sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```
> VPS 会社の管理画面にも「ファイアウォール（セキュリティグループ）」がある場合は、22・80・443 を許可しておく。

### 2-3. Docker を入れる
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker shamusho
```
一度抜けて入り直し、`docker run --rm hello-world` が動けば OK。

---

## 3. コードを置く

リポジトリが **非公開** の場合は、VPS 専用の「読み取り専用の鍵（デプロイキー）」を使う:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/sakuranomiya -N ""
cat ~/.ssh/sakuranomiya.pub
```
表示された 1 行を GitHub のリポジトリ → **Settings → Deploy keys → Add deploy key** に貼る（「Allow write access」はチェックしない）。
```bash
cat >> ~/.ssh/config <<'EOF'
Host github-sakuranomiya
  HostName github.com
  IdentityFile ~/.ssh/sakuranomiya
EOF
git clone git@github-sakuranomiya:manakikido-jpg/evaluation.git
cd evaluation
```
公開リポジトリなら `git clone https://github.com/manakikido-jpg/evaluation.git` だけでよい。

> コードは今 `claude/compassionate-sagan-8fqy8p` ブランチにある。`git branch` で確認し、違うブランチなら `git checkout claude/compassionate-sagan-8fqy8p`。

---

## 4. 設定ファイルとサーバーの準備

[test-checklist.md](test-checklist.md) の「0-1」で BOT を作り、サーバーに招待しておく。

```bash
cp .env.example .env
nano .env                       # 保存は Ctrl+O → Enter、終了は Ctrl+X
```

`.env` に書くもの:
```
DISCORD_TOKEN=（BOT のトークン）
DISCORD_CLIENT_ID=（Client ID）
DISCORD_CLIENT_SECRET=（Client Secret）
WEB_BASE_URL=https://shamusho.（あなたのドメイン）
SHAMUSHO_DOMAIN=shamusho.（あなたのドメイン）
```
> `.env` と `config/guild.json` は Git に入らない（`.gitignore` 済み）。トークンを他人に見せない・送らない。

### ロール・チャンネル・`config/guild.json` を自動で作る
1. Discord の サーバー設定 → ロール で、BOT のロールを**いちばん上にドラッグ**して保存し、「**管理者**」を付ける（管理者はセットアップの間だけ）
2. サーバー名を右クリック →「サーバー ID をコピー」（開発者モードを ON にしておく）
3. 実行:
```bash
docker compose run --rm --build setup --guild （サーバー ID） --dry-run   # 何を作るか確認だけ
docker compose run --rm setup --guild （サーバー ID）                     # 本当に作る（テスト用は --minimal を付ける）
```
- ロール 8 個・カテゴリ 7 個・チャンネル約 45 個を作り、見える範囲も設定する
- `config/guild.json` に ID を書き込み、`#社務所` に申請ボタンを置く
- 何度実行しても安全（同じ名前のものは作らない）。足りないものだけ作る
- **`--tidy`** を付けると片付けもする（先に `--tidy --dry-run` で何を消すか確認できる）
  - 最小構成の残り（`🌳 境内` の `#絵馬`・`#慶事`・`通話テスト`）、Discord が最初から作る `#一般`、`#rules`・`#moderator-only` を消す
  - コミュニティ設定のルールを `#しきたり`、お知らせ・セーフティ通知を `#寄合` に付け替える
  - カテゴリとチャンネルを設計どおりの順に並べる
  - 配置にないチャンネル（自分で作ったもの）は消さない
4. 自分に「⛩ 宮司」ロールを付け、BOT の「管理者」を OFF に戻す

## 5. ドメイン

ドメインの管理画面（お名前.com・Cloudflare など）で **A レコード**を追加:

| 名前 | 種類 | 値 |
|---|---|---|
| `shamusho` | A | VPS の IP アドレス |

反映まで数分〜1 時間。`ping shamusho.（ドメイン）` で VPS の IP が出れば OK。
> Cloudflare を使う場合、最初は「プロキシ（オレンジの雲）」を**オフ**にしておく（証明書の取得がうまくいかないことがあるため）。

Discord Developer Portal → OAuth2 → **Redirects** に `https://shamusho.（ドメイン）/auth/callback` を追加。

---

## 6. 起動

```bash
docker compose up -d --build
docker compose ps                 # db / bot / web / caddy が「running」「healthy」
docker compose logs -f bot        # 「commands registered」「members synced」が出れば OK（Ctrl+C で抜ける）
```
ブラウザで `https://shamusho.（ドメイン）` → 「Discord でログイン」。

### ドメインの準備ができる前に試したいとき
BOT は先に動かせる。管理画面は SSH のトンネルで自分のパソコンから見られる:
```bash
# VPS 上（.env の WEB_BASE_URL は http://localhost:3000 にしておく）
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build db bot web
# 自分のパソコンで（開いたままにする）
ssh -N -o ServerAliveInterval=60 -L 3000:127.0.0.1:3000 shamusho@（IP）   # 行頭が PS C:\…> の画面で実行
```
→ パソコンのブラウザで http://localhost:3000。Developer Portal の Redirects に `http://localhost:3000/auth/callback` も追加しておく。

---

## 7. バックアップ（毎日自動）

```bash
crontab -e
```
いちばん下に追加（毎日 4 時にバックアップ、7 日分を残す）:
```
0 4 * * * /home/shamusho/evaluation/scripts/backup.sh >> /home/shamusho/backup.log 2>&1
```
- 手動でとるときは `./scripts/backup.sh`（`backups/` に保存）
- 戻すときは `./scripts/restore.sh backups/（ファイル名）`（今のデータは消えるので注意）
- VPS が壊れたときに備えて、VPS 会社の「自動バックアップ／スナップショット」も使うと安心

---

## 8. 更新（新しいコードにする）

```bash
cd ~/evaluation
./scripts/update.sh      # バックアップ → 取り込み → 作り直して再起動
```
データベースの形が変わる更新も、起動時に自動で反映される。

---

## 9. 困ったとき

| 症状 | コマンド・見るところ |
|---|---|
| 動いているか | `docker compose ps` |
| BOT のログ | `docker compose logs --tail 100 bot` |
| 管理画面のログ | `docker compose logs --tail 100 web` |
| HTTPS にならない | `docker compose logs --tail 100 caddy`（ドメインの A レコード・80/443 番ポートが開いているか） |
| 設定を変えたあと | `docker compose restart bot web` |
| 全部止める / 動かす | `docker compose down` / `docker compose up -d` |

ログを送るときは、**トークンや Client Secret が写っていないか確認してから**送ってください。
