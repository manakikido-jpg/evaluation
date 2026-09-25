# 咲楽ノ宮（さくらのみや）

御朱印をコンセプトにした通話界隈の「評価鯖」と、その専用 BOT のリポジトリです。
メンバーはいいと思った人に朱印を押し（1 人につき 1 回）、集まった「ご縁」で役職が上がっていきます。

- 設計書: [docs/design.md](docs/design.md)（PDF: [docs/sakuranomiya-design.pdf](docs/sakuranomiya-design.pdf)）
- コンセプト: [docs/concept.md](docs/concept.md)

## いまできること（第 1 段階）

| 機能 | 使い方 |
|---|---|
| 朱印を押す | 相手の名前を右クリック（スマホは長押し）→「アプリ」→ **朱印を押す** |
| 御朱印帳を見る | 右クリック →「アプリ」→ **御朱印帳を見る**、または `/御朱印帳`（`/goshuin`） |
| 取り消す | 朱印を押したあとに出る［取り消す］ボタン |
| 自動昇格 | ご縁が基準を超えると役職ロールを付け替え、`#慶事` で発表 |
| 絵馬 | `#絵馬` に自己紹介を書くと、BOT が御朱印帳ボタンを付ける |
| 記録 | 朱印・取り消し・昇格を `#記録` に残す |

ルール:
- 同じ人には 1 回だけ（取り消して押し直すと、そのときの格になる）
- 自分・BOT には押せない。役職ロールがない人・👹厄年の人は押せない
- 格は押した人の役職でいちばん高いもの（宮司 10 / 神職 5 / 総代 4 / 世話役 3 / 氏子 2 / 参拝者 1）
- 降格はしない

---

## 導入手順

### 1. Discord で BOT を作る
1. [Discord Developer Portal](https://discord.com/developers/applications) で「New Application」→ 名前を付けて作成
2. 左の **Bot** →「Reset Token」でトークンを発行してメモ（**誰にも見せない**）
3. 同じ画面の **Privileged Gateway Intents** で **SERVER MEMBERS INTENT** を ON
4. 左の **OAuth2** で「Client ID」をメモ
5. 次の URL の `CLIENT_ID` を置き換えて開き、咲楽ノ宮に招待する
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268520448
   ```
   （権限: チャンネルを見る・メッセージ送信・埋め込みリンク・メッセージ履歴を読む・ロールの管理）

### 2. サーバー側の準備
1. ロールを作る: 🔰参拝者 / 🍃氏子 / 🎋世話役 / 🏮総代 / 🎐神職 / ⛩宮司 / 👹厄年
2. **サーバー設定 → ロール** で、BOT のロールを 🔰参拝者〜🏮総代 より**上**に移動する（下にあると昇格できない）
3. チャンネル `#慶事`・`#記録`・`#絵馬` を作る（`#記録` と `#絵馬` はなくても動く）
4. 最初のメンバーには手動で 🔰参拝者 を付ける（入鯖申請は第 2 段階で自動化）

### 3. ID を設定ファイルに書く
1. Discord の **ユーザー設定 → 詳細設定 → 開発者モード** を ON
2. サーバー名・チャンネル・ロールを右クリック →「ID をコピー」
3. `config/guild.example.json` をコピーして `config/guild.json` を作り、ID を書き換える
   - `requiredGoen`（昇格に必要なご縁）と `weight`（朱印の格）はここで変えられる
4. `.env.example` をコピーして `.env` を作り、`DISCORD_TOKEN` にトークンを書く

### 4. 起動する（Docker を使う場合）
```bash
docker compose up -d --build
docker compose logs -f bot   # 「commands registered」が出れば OK
```
データベース（PostgreSQL）も一緒に起動し、テーブルは自動で作られます。

### 4'. 起動する（Docker を使わない場合）
Node.js 22 以上と PostgreSQL が必要です。
```bash
npm ci
npm run build
npm start
```

---

## 開発

```bash
npm run dev         # 変更を監視して起動
npm test            # テスト（DB はメモリ上の PostgreSQL を使うので準備不要）
npm run typecheck   # 型チェック
npm run db:generate # src/db/schema.ts を変えたらマイグレーションを作る
```

| 場所 | 中身 |
|---|---|
| `src/domain/ranks.ts` | 役職・格・昇格の判定（Discord に依存しない） |
| `src/services/shuin.ts` | 朱印の保存・取り消し・集計 |
| `src/services/flows.ts` | 「押せるか」の判定と押す手順 |
| `src/discord/` | コマンド・ボタン・表示・ロール変更・発表 |
| `src/db/schema.ts` / `drizzle/` | テーブル定義とマイグレーション |
| `config/guild.example.json` | サーバーの ID と役職の設定例 |
