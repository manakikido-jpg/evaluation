# 縁側の個人用操作パネル

画像装飾は使わず、短い見出しと「左に説明・右にボタン」の行を区切り線で並べる採用案です。Discord Components V2の本人限定表示を使います。最初に縁側の共有入口を1回押します。

- [表示見本](engawa-control-panel.html)
- [スマホの見本](engawa-control-panel-mobile.png)
- [PCの見本](engawa-control-panel-pc.png)
- [実際の送信データ](engawa-control-panel.json)

見本はDiscordの描画を近似したもので、本番のスクリーンショットではありません。新制度公開前はプロフィール・送金・コマンド・寝落ち報告・運営呼び出しの5項目、公開後はご縁・絵馬を加えた7項目です。実際の本人限定表示にはDiscord標準の案内が付きます。

`npx tsx docs/previews/engawa-control-panel.mts` で実装から見本を再生成できます。実際のDiscordへは送信しません。
