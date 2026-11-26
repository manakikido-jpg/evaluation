# 神符合戦：UXと上限なしの運営テスト

2026年11月11日の本人の「それで一回作成しよう」で承認された変更。未合流PR173へまとめる。

- 完成カードの全体表示と拡大を維持する。
- 自分のHP/MP/霊銭を手札の上へまとめ、上部は相手だけを表示する。
- 画面下に、対象・選択札・消費MP/所持MP・追加の支払いと確定操作を固定する。「その他」から両替/様子見/戦いの記録を開く。
- MP不足/防御の番/HP条件など、選べない理由を出す。使えない札も「拡大・効果」で読める。
- HPの変化と自分のMP/霊銭の変化を表示する。ダメージと0ダメージの防御成功は、公開されたサーバーの確定結果から表示する。HP差分をダメージと推測しない。
- 初期HP60/MP12/霊銭20を維持し、HP/MPの回復・吸収・召喚・防御時の回復・両替に上限を設けない。霊銭は従来どおり上限なし。「満タン」はHP60以上。
- MPは0未満にならず、退場者は回復で復活しない。手札10枚・80手番の残HP判定は維持。回復蓄積によるバランスは、運営の試遊で別に評価する。

原画・カードの回復量/攻防値/消費・出現率/価格は変更していない。一般公開/本番の銭への接続/本番合流はしない。

## 見本

架空会員とメモリDB、ローカルの実画面/JS/対戦処理で撮影した。比較前の表示は [カードを活かしたUI](shinpu-art-ui.md)。

| 場面 | 画像 |
| --- | --- |
| PCの選択前 | [自分の資源と手札](shinpu-ux-desktop.webp) |
| PCの選択時 | [対象・消費・固定操作](shinpu-ux-selection.webp) |
| スマホの全体 | [全体](shinpu-ux-mobile.webp) |
| スマホの手札 | [手札](shinpu-ux-mobile-hand.webp) |
| 上限を超えた数値 | [HP72・MP30と固定操作](shinpu-ux-unlimited-mobile.webp) |
| 複数札選択 | [スマホの2枚選択](shinpu-ux-mobile-selection.webp) |
| 効果確認 | [拡大](shinpu-ux-detail.webp) |
| 公開された攻撃 | [札の演出](shinpu-ux-play.webp) |
| 防御 | [札と実ダメージの結果](shinpu-ux-defense.webp) |

## 再確認

1. Node22で依存関係を用意し、`npx tsx scripts/previews/shinpu-ui.mts` を起動する。127.0.0.1:4211だけを使う。秘密設定と本番DB/Discordは不要。
2. 別ターミナルで `SHINPU_SNAPSHOT_PREFIX=shinpu-ux- node scripts/previews/shinpu-ui-browser.cjs`。
3. `SHINPU_SNAPSHOT_PREFIX=shinpu-ux- node scripts/previews/shinpu-ui-two-player.cjs`。
4. `node scripts/previews/shinpu-ux-browser.cjs`。
5. サーバーを停止する。

Chromiumは `/usr/bin/chromium`、Playwrightを別の場所に用意する環境は `PLAYWRIGHT_MODULE` へそのモジュールのパスを設定する。fixtureの初期山札と時計だけを固定し、製品の時計/抽選は変更しない。最初の2本は札の表示・選択・攻防・拒否時の演出抑止・低減設定、3本目は実APIの回復/両替でHP72/MP30・不足理由/詳細・320/390/768/950/1440pxの上下スクロールで固定操作のタップと重なりを確認する。

最終検証：型/build成功。全277ファイル2,993件成功（670.32秒、4worker）。ブラウザー3本も成功し、JS例外/画像欠落/ページ横はみ出し/固定操作のタップ遮蔽0。見本はすべて架空会員のローカル画面。本番未反映。
