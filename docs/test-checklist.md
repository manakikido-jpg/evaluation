# 本番前のテスト手順（テスト用サーバー）

本物の咲楽ノ宮を作る前に、**テスト用の Discord サーバー**で一通り動かして確かめる。
メンバー側の操作を試すため、**サブアカウント（サブ垢）を 1 つ**用意しておく。

---

## 0. 準備（30 分くらい）

### 0-1. テスト用サーバーと BOT
1. Discord で新しいサーバーを作る（名前は何でもよい。例: 咲楽ノ宮テスト）
2. [Discord Developer Portal](https://discord.com/developers/applications) → New Application → 名前を付ける
3. **Bot** → Reset Token → トークンをメモ（誰にも見せない）
4. 同じ画面の **SERVER MEMBERS INTENT** を ON
5. **OAuth2** → Client ID と Client Secret をメモ。**Redirects** に `http://localhost:3000/auth/callback` を追加
6. 次の URL の `CLIENT_ID` を置き換えて開き、テスト用サーバーに招待
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268520454
   ```

### 0-2. ロールとチャンネル（テストなので最小限でよい）
ロール（上から この順番。**BOT のロールは 👹厄年 より上**に置く）:
```
⛩ 宮司 / 🎐 神職（「メンバーをタイムアウト」権限を付ける）
（BOT のロール）
👹 厄年 / 🔞 宵参り / 🏮 総代 / 🎋 世話役 / 🍃 氏子 / 🔰 参拝者
```
チャンネル:
```
#社務所  #慶事  #記録  #絵馬  #申請受付  #お参り判定  #相談窓口
🔊 通話テスト
```
自分（本垢）に ⛩宮司 を付ける。サブ垢には何も付けない。

### 0-3. 設定ファイル
1. Discord の **設定 → 詳細設定 → 開発者モード** を ON
2. サーバー名・ロール・チャンネルを右クリック →「ID をコピー」
3. `config/guild.example.json` をコピーして `config/guild.json` を作り、ID を書き換える
   - `channels`: keiji / log / ema / applications / omairi / soudan
   - `roles`: yakudoshi / yoimairi
   - `ranks` の roleId
4. `.env.example` をコピーして `.env` を作る
   ```
   DISCORD_TOKEN=（トークン）
   DISCORD_CLIENT_ID=（Client ID）
   DISCORD_CLIENT_SECRET=（Client Secret）
   WEB_BASE_URL=http://localhost:3000
   ```

### 0-4. 起動（Docker Desktop が必要）
```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build db bot web
docker compose logs -f bot     # 「commands registered」「members synced」が出れば OK
```
管理画面: ブラウザで http://localhost:3000

---

## 1. チェックリスト

「本」= 本垢（宮司）、「サ」= サブ垢

### 入鯖・宵参り
- [ ] 本: `#社務所` で `/パネル 入鯖申請` → ボタンが置かれる
- [ ] サ: ボタン → 年齢区分「18 歳以上」→ フォームを送る → 「受け付けました」
- [ ] `#申請受付` にカードが届く
- [ ] 本: 承認 → サに 🔰参拝者 が付く、歓迎の DM が届く、カードが「✅ 承認しました」に変わる
- [ ] 本: `/パネル 宵参り申請` → サ: ボタン → 承認 → サに 🔞宵参り が付く

### 朱印・昇格・花びら
- [ ] サ: 本の名前を右クリック →「アプリ」→「朱印を押す」→ 押せた（2 回目は「すでに押しています」）
- [ ] サ: `/御朱印帳` で自分と本の御朱印帳が見られる。花びらの残高が出る
- [ ] 本: サに朱印を押す（宮司は格 10）→ もう 1 人分でサが 🍃氏子 に上がり、`#慶事` に発表が出る
  - 1 人では 20 に届かないので、管理画面の「設定」で氏子の昇格ラインを 10 にして試すとよい
- [ ] サ: `#絵馬` に書き込む → 御朱印帳ボタンが付く
- [ ] 本とサで `🔊 通話テスト` に 10 分以上いる → 花びらが増える（御朱印帳で確認）

### 厄・免罪符
- [ ] 本: `/厄 付ける` サ → サに 👹厄年、DM が届く（神職の名前が出ていないこと）
- [ ] サ: 👹厄年 の間は朱印を押せない
- [ ] 本: 設定で免罪符の値段を小さく（例: 5）→ サ: `/免罪符` → 購入 → 厄年が外れる
- [ ] サ: もう一度 `/免罪符` → 「もう買えません」
- [ ] 本: `/厄 付ける` を 2 回 → 2 回目は確認ボタン → BAN（**サブ垢が BAN されるので、確認したら サーバー設定 → BAN から解除**）

### 相談
- [ ] サ: `/相談` → 送る → `#相談窓口` にカード（サの名前が出ていないこと）
- [ ] 本: 「返信する」→ サに DM が届く
- [ ] サ: `/相談 番号:1` で続きを送れる

### 管理画面
- [ ] http://localhost:3000 → Discord でログイン（本はログインできる / サは「入れません」）
- [ ] メンバー一覧・詳細・厄・申請・相談・記録・設定が開ける
- [ ] 管理画面から厄を付ける・メモを書く・申請を承認する
- [ ] 「記録」にすべての操作が残っている

### お参り期間（時間がかかるので最後に・任意）
- [ ] 設定でお参り期間を 1 日・自動延長 0 日にする → 1 日後に `#お参り判定` に出る

---

## 2. うまくいかないとき

| 症状 | 見るところ |
|---|---|
| コマンドが出てこない | `docker compose logs bot` に「commands registered」が出ているか。Discord を再起動 |
| ロールが付かない・外れない | BOT のロールが、付けたいロールより**上**にあるか |
| 神職用コマンドが見えない | 🎐神職 ロールに「メンバーをタイムアウト」権限があるか |
| DM が届かない | サの「サーバーにいるメンバーからの DM を許可」が ON か |
| 管理画面にログインできない | Developer Portal の Redirects に `http://localhost:3000/auth/callback` があるか。`.env` の Client Secret |
| 起動しない | `docker compose logs bot` / `docker compose logs web` の最後の行（設定ファイルの書き間違いは、どこが違うかが出る） |

ログの最後の数十行を送ってもらえれば、原因を調べます（**トークンや Client Secret が写っていないか確認してから**送ってください）。
