# スマホ・PCの画面点検（2026年11月11日）

本番8a7f77ebを基にした作業ブランチで、架空の運営/会員、メモリDB、偽Discordだけを使った。実データや実Discordに対する操作は行っていない。

- GET登録214件（パスの重複を除く210種類）を棚卸し。
- 162 URLを取得し、HTMLが正常に返った159入口を320/390/768/1440pxで636ケース確認。転送後の重複を除く表示先は156種類。
- ページの横はみ出し0、JavaScript例外0、コンソールエラー0、通信失敗0。ページ移動に伴う意図的な中断は通信失敗に数えない。

表の中の横スクロールはページのはみ出しに数えない。転送先が同じ場合は、その先の画面を確認したもので、元のURLの個別状態まで確認したとは扱わない。

## 修正と再確認

- キャスト：ID付きの本人選択、検索、テンプレ/個別の切替、折りたたみ、入力を残す422エラー、JSなしの登録。年齢・在籍・CSRF・権限は維持。
- 同時登録：登録済み判定と保存を同じ排他/トランザクションで行い、上書きと通知重複を防ぐ。ロール/DMの失敗は部分失敗として表示。
- ほかの保存：既存のその場保存を維持。入力中の登録をDOMごと残し、画面差替え後にも検索/切替を初期化。
- スマホ：ヘッダーの幅、44pxのメニューボタンと三本線、下部ナビの折返し、画像入力のはみ出し。
- 対戦：HTMXの既定インラインCSSがCSPに拒否される問題を検出。報告されたhashはHTMXの既定CSSと一致。不要な追加を止め、CSPは維持。

登録/その場保存/共通操作/タッチ設定/修正箇所の再検証は別のブラウザースクリプトでも確認する。[手順と見本](previews/cast-registration-and-screen-audit.md) を参照。

## 一覧

| URL | HTTP | 表示先 | 4幅 |
| --- | --- | --- | --- |
| `/healthz` | 200 | `/healthz` | 画面以外 |
| `/cast-office/login` | 200 | `/cast-office/login` | ○ |
| `/cast-office` | 200 | `/cast-office` | ○ |
| `/sticker-desk/login` | 200 | `/sticker-desk/login` | ○ |
| `/sticker-desk` | 200 | `/sticker-desk` | ○ |
| `/sticker-desk/new` | 200 | `/sticker-desk/new` | ○ |
| `/update-desk/login` | 200 | `/update-desk/login` | ○ |
| `/update-desk/new` | 200 | `/update-desk/new` | ○ |
| `/update-desk` | 200 | `/update-desk` | ○ |
| `/mypage/login` | 200 | `/mypage/login` | ○ |
| `/mypage` | 200 | `/mypage` | ○ |
| `/login` | 200 | `/login` | ○ |
| `/casino/shinpu` | 200 | `/casino/shinpu` | ○ |
| `/casino/shinpu/cards` | 200 | `/casino/shinpu/cards` | ○ |
| `/visit/bingo` | 200 | `/visit/bingo` | ○ |
| `/visit` | 200 | `/visit` | ○ |
| `/visit/card.png` | 200 | `/visit/card.png` | 画面以外 |
| `/marketplace` | 200 | `/marketplace` | ○ |
| `/marketplace/new` | 200 | `/marketplace/new` | ○ |
| `/marketplace/orders` | 200 | `/marketplace/orders` | ○ |
| `/marketplace/seller` | 200 | `/marketplace/seller` | ○ |
| `/lottery` | 200 | `/lottery` | ○ |
| `/casino/arcade` | 200 | `/casino/arcade` | ○ |
| `/casino/pinball` | 200 | `/casino/pinball` | ○ |
| `/casino/god` | 200 | `/casino/god` | ○ |
| `/casino/god/play` | 200 | `/casino/god` | ○ |
| `/casino/god/play/guide` | 200 | `/casino/god/play/guide` | ○ |
| `/casino/fortune` | 200 | `/lottery` | ○ |
| `/casino/wardrobe` | 200 | `/casino/wardrobe` | ○ |
| `/casino/style-gacha` | 200 | `/casino/style-gacha` | ○ |
| `/casino` | 200 | `/casino` | ○ |
| `/casino/jansou` | 200 | `/casino/jansou` | ○ |
| `/casino/stats` | 200 | `/casino/stats` | ○ |
| `/casino/hall` | 200 | `/casino/hall` | ○ |
| `/casino/blackjack` | 200 | `/casino/blackjack` | ○ |
| `/casino/highlow` | 200 | `/casino/highlow` | ○ |
| `/casino/baccarat` | 200 | `/casino/baccarat` | ○ |
| `/casino/slots` | 200 | `/casino/slots` | ○ |
| `/casino/roulette` | 200 | `/casino/roulette` | ○ |
| `/casino/chinchiro` | 200 | `/casino/chinchiro` | ○ |
| `/casino/othello` | 200 | `/casino/othello` | ○ |
| `/casino/atslot` | 200 | `/casino/atslot` | ○ |
| `/casino/atslot/demo` | 200 | `/casino/atslot/demo` | ○ |
| `/casino/versus` | 200 | `/casino/versus` | ○ |
| `/casino/keiba/club` | 200 | `/casino/keiba/club` | ○ |
| `/casino/keiba/events` | 200 | `/casino/keiba/events` | ○ |
| `/casino/keiba/replays` | 200 | `/casino/keiba/replays` | ○ |
| `/casino/keiba/preview` | 200 | `/casino/keiba/preview` | ○ |
| `/casino/keiba/hall` | 200 | `/casino/keiba/hall` | ○ |
| `/casino/keiba/horses` | 200 | `/casino/keiba/horses` | ○ |
| `/casino/keiba/mine` | 200 | `/casino/keiba/mine` | ○ |
| `/casino/keiba/stable` | 200 | `/casino/keiba/stable` | ○ |
| `/casino/keiba/aura-shop` | 200 | `/casino/keiba/aura-shop` | ○ |
| `/economy/event-lottery` | 200 | `/economy/event-lottery` | ○ |
| `/office/app` | 200 | `/office/app` | ○ |
| `/office/access` | 200 | `/office/access` | ○ |
| `/economy/casino-live` | 200 | `/economy/casino-live` | ○ |
| `/economy/casino-scenes` | 200 | `/economy/casino-scenes` | ○ |
| `/economy/kiseki-experience` | 200 | `/economy/kiseki-experience` | ○ |
| `/economy/kiseki-trial/guide` | 200 | `/economy/kiseki-trial/guide` | ○ |
| `/economy/kiseki-trial` | 200 | `/economy/kiseki-trial` | ○ |
| `/economy/gaisen-trial/guide` | 200 | `/economy/gaisen-trial/guide` | ○ |
| `/economy/gaisen-trial` | 200 | `/economy/gaisen-trial` | ○ |
| `/economy/gaisen-trial-v2/guide` | 200 | `/economy/gaisen-trial-v2/guide` | ○ |
| `/economy/gaisen-trial-v2` | 200 | `/economy/gaisen-trial-v2` | ○ |
| `/economy/casino-test` | 200 | `/economy/casino-test` | ○ |
| `/economy/keiba-test` | 200 | `/economy/keiba-test` | ○ |
| `/keiba-events` | 200 | `/keiba-events` | ○ |
| `/recordings` | 200 | `/recordings` | ○ |
| `/economy/gallery` | 200 | `/economy/gallery` | ○ |
| `/economy/fortune` | 200 | `/economy/fortune` | ○ |
| `/economy/shinpu` | 200 | `/economy/shinpu` | ○ |
| `/` | 200 | `/` | ○ |
| `/members` | 200 | `/members` | ○ |
| `/members/diff` | 200 | `/members/diff` | ○ |
| `/members/left` | 200 | `/members/left` | ○ |
| `/ideas` | 200 | `/ideas` | ○ |
| `/minutes` | 200 | `/minutes` | ○ |
| `/minutes/new` | 200 | `/minutes/new` | ○ |
| `/temp` | 200 | `/temp` | ○ |
| `/invites/shofuku` | 200 | `/invites/shofuku` | ○ |
| `/invites` | 200 | `/invites` | ○ |
| `/commands` | 200 | `/commands` | ○ |
| `/updates` | 200 | `/updates` | ○ |
| `/voice/core` | 200 | `/voice/core` | ○ |
| `/voice/boost` | 200 | `/voice/boost` | ○ |
| `/evaluation/corrections` | 400 | `/evaluation/corrections` | 画面以外 |
| `/evaluation` | 200 | `/evaluation` | ○ |
| `/voice/rooms` | 200 | `/voice/rooms` | ○ |
| `/voice` | 200 | `/voice` | ○ |
| `/stats` | 200 | `/stats` | ○ |
| `/stickers` | 200 | `/stickers` | ○ |
| `/posts` | 200 | `/posts` | ○ |
| `/org` | 200 | `/org` | ○ |
| `/nav-order` | 200 | `/nav-order` | ○ |
| `/guide/thread` | 200 | `/guide/thread` | ○ |
| `/room-knock` | 200 | `/room-knock` | ○ |
| `/reaction-roles` | 200 | `/reaction-roles` | ○ |
| `/message-archive` | 200 | `/message-archive` | ○ |
| `/guide` | 200 | `/guide` | ○ |
| `/economy` | 200 | `/economy` | ○ |
| `/economy/casino` | 200 | `/economy/casino` | ○ |
| `/economy/casino/gacha` | 200 | `/economy/casino/gacha` | ○ |
| `/yaku` | 200 | `/yaku` | ○ |
| `/applications` | 200 | `/applications` | ○ |
| `/omairi` | 200 | `/omairi` | ○ |
| `/soudan` | 200 | `/soudan` | ○ |
| `/settings` | 200 | `/settings` | ○ |
| `/notices` | 200 | `/notices` | ○ |
| `/alts` | 200 | `/alts` | ○ |
| `/notices/new` | 200 | `/notices/new` | ○ |
| `/security` | 200 | `/security` | ○ |
| `/glossary` | 200 | `/glossary` | ○ |
| `/channels` | 200 | `/channels` | ○ |
| `/channels/perms` | 200 | `/channels/perms` | ○ |
| `/channels/check` | 200 | `/channels/check` | ○ |
| `/channels/new` | 200 | `/channels/new` | ○ |
| `/roles` | 200 | `/roles` | ○ |
| `/ranks` | 200 | `/ranks` | ○ |
| `/interview` | 200 | `/interview` | ○ |
| `/gacha` | 200 | `/gacha` | ○ |
| `/market` | 200 | `/market` | ○ |
| `/board` | 200 | `/board` | ○ |
| `/tickets` | 200 | `/tickets` | ○ |
| `/cast` | 200 | `/cast` | ○ |
| `/shop/visit` | 200 | `/shop/visit` | ○ |
| `/shop` | 200 | `/shop` | ○ |
| `/audit` | 200 | `/audit` | ○ |
| `/ideas/1` | 200 | `/ideas/1` | ○ |
| `/notices/1` | 200 | `/notices/1` | ○ |
| `/notices/1/delete` | 200 | `/notices/1/delete` | ○ |
| `/soudan/1` | 200 | `/soudan/1` | ○ |
| `/update-desk/edit/1` | 200 | `/update-desk/edit/1` | ○ |
| `/marketplace/listings/1` | 200 | `/marketplace/listings/1` | ○ |
| `/marketplace/requests/1` | 200 | `/marketplace/requests/1` | ○ |
| `/casino/shinpu/cards/SK-001` | 200 | `/casino/shinpu/cards/SK-001` | ○ |
| `/members/770000000000000001` | 200 | `/members/770000000000000001` | ○ |
| `/members/770000000000000002` | 200 | `/members/770000000000000002` | ○ |
| `/economy/members/770000000000000002` | 200 | `/economy/members/770000000000000002` | ○ |
| `/roles/100000000000000006` | 200 | `/roles/100000000000000006` | ○ |
| `/channels/780000000000000001` | 200 | `/channels/780000000000000001` | ○ |
| `/casino/arcade/fortune` | 200 | `/casino/arcade/fortune` | ○ |
| `/casino/arcade/moneywheel` | 200 | `/casino/arcade/moneywheel` | ○ |
| `/casino/arcade/craps` | 200 | `/casino/arcade/craps` | ○ |
| `/casino/arcade/duckrace` | 200 | `/casino/arcade/duckrace` | ○ |
| `/casino/arcade/crash` | 200 | `/casino/arcade/crash` | ○ |
| `/casino/arcade/plinko` | 200 | `/casino/arcade/plinko` | ○ |
| `/casino/arcade/penguin` | 200 | `/casino/arcade/penguin` | ○ |
| `/casino/arcade/keno` | 200 | `/casino/arcade/keno` | ○ |
| `/casino/arcade/videopoker` | 200 | `/casino/arcade/videopoker` | ○ |
| `/casino/arcade/tower` | 200 | `/casino/arcade/tower` | ○ |
| `/casino/arcade/mines` | 200 | `/casino/arcade/mines` | ○ |
| `/casino/tables/bj_table` | 200 | `/casino/tables/bj_table` | ○ |
| `/casino/tables/baccarat_table` | 200 | `/casino/tables/baccarat_table` | ○ |
| `/casino/tables/roulette_table` | 200 | `/casino/tables/roulette_table` | ○ |
| `/casino/tables/chinchiro_table` | 200 | `/casino/tables/chinchiro_table` | ○ |
| `/casino/tables/poker` | 200 | `/casino/tables/poker` | ○ |
| `/casino/tables/daifugo` | 200 | `/casino/tables/daifugo` | ○ |
| `/casino/tables/babanuki` | 200 | `/casino/tables/babanuki` | ○ |
| `/casino/tables/mahjong` | 200 | `/casino/jansou` | ○ |
| `/casino/tables/keiba` | 200 | `/casino/tables/keiba` | ○ |
| `/casino/tables/life` | 200 | `/casino/tables/life` | ○ |

## 未確認の条件

実iPhone/Android・Safari、実Discordの認証/権限/DM到達、進行中の全ての卓/競馬個体、画像添付済み・満員・通信断などの全状態、各利用者の本番設定や全入力組合せは網羅していない。部屋番号や1回きりの認証リンクなど、DBや本人用tokenが必要な画面を全件作る検査ではない。サーバー処理の正常系/異常系は別途全テストで確認する。

`/evaluation/corrections` は引数なしでは400を返すAPIで、HTML画面の成功に数えない。`/healthz` と `/visit/card.png` も画面以外として分類する。

上記の成功は、システムに不具合が一切ないという保証ではない。本番合流は別指示。

最終サーバー検証：型チェック・ビルド成功、全277ファイル2,993件成功（756.47秒、4worker）。実装の変更後に全件を通し、失敗をskipしていない。
