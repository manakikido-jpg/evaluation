# AGENTS.md — AI（ChatGPT / Codex・Claude など）がこのリポジトリで作業するときの決まり

このファイルは、AI のコーディング助手が作業を始める前に読むための説明書です。人が読んでもかまいません。
**ここに書いてあることは必ず守ってください。** 分からないことがあれば、勝手に決めずに依頼した人に聞いてください。

## 1. これは何か

- Discord サーバー「咲楽ノ宮（さくらのみや）」の BOT と、運営用の管理画面「社務所Web」、メンバー用の「カジノ」の Web。
- TypeScript（Node.js 22）・discord.js 14・Hono（JSX でサーバー側に HTML を作る）・PostgreSQL（Drizzle ORM）・zod。
- 本番は VPS 上の Docker Compose で動いている。
- 機能の説明は [docs/admin.md](docs/admin.md)、デプロイは [docs/deploy-vps.md](docs/deploy-vps.md)。

## 2. いちばん大事なこと: ブランチと本番

- **本番の VPS は、ブランチ `claude/compassionate-sagan-8fqy8p` を 1 分ごとに取りこんで、そのまま本番に出している。**
  このブランチに push したものは、数分で本番の Discord に出る。
- **このブランチに直接 push しない。** 自分用のブランチ（例: `codex/○○`）を作って作業し、
  テストを全部通してから、`claude/compassionate-sagan-8fqy8p` 向けのプルリクエストを作る。合流は人（またはもう 1 つの AI）がテストを確かめてから行う。
- force push・rebase で履歴を書きかえる・コミットを消す、はしない。
- 作業を始める前と push の前に、`git fetch` して最新を取りこむ（ほかの人・AI も同じリポジトリを触っている）。

## 3. 秘密のもの（ぜったいに守る）

- **このリポジトリは公開されている。** 次のものをコミット・出力・ログに残さない。
  - `.env`・`config/guild.json`（`.gitignore` 済み。中身を作らない・読まない・書かない）
  - BOT のトークン・Client Secret・パスワード・`WEB_ENTRY_KEY`・`BACKUP_WEBHOOK_URL`・`BACKUP_PASSPHRASE` などの秘密
  - VPS の IP アドレス
- 秘密が必要な作業は、依頼した人に「どこに何を入れるか」だけを伝える。値そのものを聞かない・受け取らない。
- 本物のお金は扱わない（サーバーの通貨「銭」は、ゲームの中だけのポイント）。

## 4. 作業の流れ

```sh
npm ci                 # 入れる
npm run typecheck      # 型を確かめる（tsc --noEmit）
npm test               # テストを全部（vitest。4 分くらい）
npx vitest run test/omikuji.test.ts   # 1 つのファイルだけ
npm run db:generate    # DB の形を変えたら、マイグレーションを作る（drizzle-kit）
```

- **push する前に `npm run typecheck` と `npm test` を通す。** 落ちているテストを消したり、`skip` したりしない。テストは中身を見て直す。
- 動きを変えたら、テストを足すか直す（`test/` にある。DB を使うテストは `test/helpers.ts` の `makeDb()`）。
- テストは、マイグレーション済みの DB の写し（`node_modules/.cache/pglite`）を使って速くしている。マイグレーションを足すと自動で作り直す。

## 5. どこに何があるか

| 場所 | 中身 |
|---|---|
| `src/index.ts` | 起動・毎分の仕事 |
| `src/discord/` | Discord のコマンド・ボタン・パネル（見た目と受け答え） |
| `src/services/` | 中の仕組み（DB を読み書きする。Discord に依存しない） |
| `src/services/casino/` | カジノ（スロット・卓のゲーム・競馬など） |
| `src/domain/` | 役職などの計算だけのもの |
| `src/db/schema.ts` | DB の表。変えたら `npm run db:generate` で `drizzle/` にマイグレーションを足す |
| `drizzle/` | マイグレーション（**一度入れたものは書きかえない**。直すときは新しいものを足す） |
| `src/config.ts` | 設定の形（zod）。新しい設定は `.default()` を付けて足す |
| `src/services/settings.ts` | 社務所Web で変えた設定（上書き）の形と、当てはめ方 |
| `src/web/app.tsx` | 社務所Web の道（ルート） |
| `src/web/views/` | 画面（Hono JSX） |
| `src/web/public/` | CSS・JS・絵（`src/web/assets.ts` に登録する） |
| `src/changelog.ts` | 更新履歴（社務所Web の「更新履歴」に出る） |
| `docs/admin.md` | 機能の説明書 |
| `test/` | テスト |
| `assets/fonts/` | おみくじの紙を描く字（SIL OFL） |

## 6. 書き方の決まり

### 言葉
- 画面・Discord のメッセージ・コメント・説明書は、**やさしい日本語**（ひらがな多め・短い文）。まわりのコードのコメントの書き方に合わせる。
- コミットメッセージも日本語で、何をなぜ変えたかを書く。

### 設定を足すとき
1. `src/config.ts` の zod の形に、`.default()` つきで足す（今の本番の動きを変えない値にする）。
2. 社務所Web で変えられるようにするなら、`src/services/settings.ts` の上書きの形と当てはめ方にも足す。
3. `src/web/app.tsx` の `POST /settings`（ほかの項目をまとめて保存する道）で、**新しい項目を消さないように** `prev.○○` で残す（ほかの欄の保存で消えてしまう事故が起きやすい）。

### 社務所Web（管理画面）
- **CSP が厳しい。** HTML に `<script>…</script>`（中身を直接書いたもの）・`onclick=` などの属性・`style="…"` を書かない。
  JS は `src/web/public/*.js` に書いて `assets.ts` に登録し、`<script src=…>` で読む。見た目は CSS のクラスで。JS の中で `el.style` を変えるのはよい。
- 新しい道（パス）を作ったら、`app.tsx` で `app.use(パス, requireAdmin)` と、POST なら `requireCsrf` を通す（ほかの道の書き方をまねる）。フォームには CSRF の欄を入れる。
- 宮司だけの操作は `gujiOnly(c)` で確かめる。
- 変えた操作は `audit(...)` で記録に残す。

### 銭（サーバーの通貨）
- 銭を増やす・減らすときは、必ず `src/services/economy.ts` の `addCoins` / `spendWithin` を使い、ほかの書きこみと同じトランザクションで行う（途中で失敗したら全部戻るように）。
- 二重に払わない・渡さないように、同時に押されても 1 回だけになる作りにする（ほかの機能のまねをする）。

### Discord
- BOT が出すメッセージは、意図しない通知が飛ばないように `allowedMentions` を付ける（ほかのコードと同じ）。
- 長い処理で 3 秒以内に返事ができないときは、先に `deferReply` する。

### 変えたら必ずやること
- `src/changelog.ts` のいちばん上に、更新履歴を 1 つ足す（id は一度決めたら変えない）。
- `docs/admin.md` の説明を直す。
- テストを足す・直す。

## 7. やってはいけないこと

- `claude/compassionate-sagan-8fqy8p` に直接 push する・テストを通さずに push する
- 秘密（3 章）をコミット・出力する
- 入れたマイグレーションを書きかえる・消す
- テストを消す・`skip` する・中身を変えて無理に通す
- 依頼されていない大きな作り直し（ファイルの丸ごとの書きかえ・ライブラリの入れかえ）
- 本番のデータを消す・変える操作（依頼した人がはっきり頼んだときだけ）

## 8. ほかの AI と一緒に作業するとき

- 同じリポジトリを Claude（Claude Code）も触っている。始める前に `git log` で最近の変更を見て、同じ所を同時に直さない。
- プルリクエストの説明に「何を・なぜ・どう確かめたか（テストの結果）」を書く。
