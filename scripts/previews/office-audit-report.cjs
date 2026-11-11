/** ローカル点検を一覧へまとめる。Cookieやfixture tokenは出さない。 */
const fs=require('node:fs');
const source=process.argv[2]||'/tmp/office-audit-report.json';
const output=process.argv[3]||'docs/web-screen-audit-2026-11-11.md';
const r=JSON.parse(fs.readFileSync(source,'utf8'));
const html=r.routes.filter(p=>p.html&&p.status===200),destinations=new Set(r.screens.map(s=>s.finalPath||s.path));
const overflow=r.screens.filter(s=>s.overflow),exceptions=r.exceptions.length,consoleErrors=(r.consoleErrors||[]).length,network=(r.failedRequests||[]).filter(s=>s.reason!=='net::ERR_ABORTED').length;
const escape=t=>String(t).replaceAll('|','｜').replaceAll('\n',' ');
const lines=['# スマホ・PCの画面点検（2026年11月11日）','',
'本番8a7f77ebを基にした作業ブランチで、架空の運営/会員、メモリDB、偽Discordだけを使った。実データや実Discordに対する操作は行っていない。','',
`- GET登録${r.registeredRoutes.length}件（パスの重複を除く${new Set(r.registeredRoutes).size}種類）を棚卸し。`,
`- ${r.routes.length} URLを取得し、HTMLが正常に返った${html.length}入口を320/390/768/1440pxで${r.screens.length}ケース確認。転送後の重複を除く表示先は${destinations.size}種類。`,
`- ページの横はみ出し${overflow.length}、JavaScript例外${exceptions}、コンソールエラー${consoleErrors}、通信失敗${network}。ページ移動に伴う意図的な中断は通信失敗に数えない。`,
'', '表の中の横スクロールはページのはみ出しに数えない。転送先が同じ場合は、その先の画面を確認したもので、元のURLの個別状態まで確認したとは扱わない。','',
'## 修正と再確認','',
'- キャスト：ID付きの本人選択、検索、テンプレ/個別の切替、折りたたみ、入力を残す422エラー、JSなしの登録。年齢・在籍・CSRF・権限は維持。',
'- 同時登録：登録済み判定と保存を同じ排他/トランザクションで行い、上書きと通知重複を防ぐ。ロール/DMの失敗は部分失敗として表示。',
'- ほかの保存：既存のその場保存を維持。入力中の登録をDOMごと残し、画面差替え後にも検索/切替を初期化。',
'- スマホ：ヘッダーの幅、44pxのメニューボタンと三本線、下部ナビの折返し、画像入力のはみ出し。',
'- 対戦：HTMXの既定インラインCSSがCSPに拒否される問題を検出。報告されたhashはHTMXの既定CSSと一致。不要な追加を止め、CSPは維持。',
'', '登録/その場保存/共通操作/タッチ設定/修正箇所の再検証は別のブラウザースクリプトでも確認する。[手順と見本](previews/cast-registration-and-screen-audit.md) を参照。','',
'## 一覧','', '| URL | HTTP | 表示先 | 4幅 |', '| --- | --- | --- | --- |'];
for(const route of r.routes){const cases=r.screens.filter(s=>s.path===route.path);const ok=cases.length===4&&cases.every(s=>!s.overflow);lines.push(`| \`${escape(route.path)}\` | ${route.status} | \`${escape(route.finalPath||route.path)}\` | ${ok?'○':cases.length?'要確認':'画面以外'} |`);}
lines.push('', '## 未確認の条件','',
'実iPhone/Android・Safari、実Discordの認証/権限/DM到達、進行中の全ての卓/競馬個体、画像添付済み・満員・通信断などの全状態、各利用者の本番設定や全入力組合せは網羅していない。部屋番号や1回きりの認証リンクなど、DBや本人用tokenが必要な画面を全件作る検査ではない。サーバー処理の正常系/異常系は別途全テストで確認する。','',
'`/evaluation/corrections` は引数なしでは400を返すAPIで、HTML画面の成功に数えない。`/healthz` と `/visit/card.png` も画面以外として分類する。','',
'上記の成功は、システムに不具合が一切ないという保証ではない。本番合流は別指示。','');
fs.writeFileSync(output,lines.join('\n'));
console.log(JSON.stringify({output,urls:r.routes.length,html:html.length,cases:r.screens.length,destinations:destinations.size,overflow:overflow.length,exceptions,consoleErrors,network}));
