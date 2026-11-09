import {CasinoLayout,type CasinoMe} from './casino.js';
import {assetUrl} from '../assets.js';
export function PinballPage({me}:{me:CasinoMe}){
 return <CasinoLayout title="ピンボールとプリンク" me={me} wide>
  <link rel="stylesheet" href={assetUrl('pinball.css')}/>
  <script src={assetUrl('pinball-physics.js')} defer/><script src={assetUrl('pinball.js')} defer/>
  <section class="pb-root" data-pinball aria-label="ピンボールとプリンクの練習">
   <header class="pb-heading"><div><small>SAKURA ARCADE · FREE PLAY</small><h1>ピンボールとプリンク</h1><p>玉を打ち返す？ 落として楽しむ？</p></div><a href="/casino/hall">カジノへ戻る →</a></header>
   <p class="pb-free">無料の練習モード · 得点は銭に交換できません</p>
   <nav class="pb-tabs" aria-label="遊び方を選ぶ"><button type="button" data-pb-mode="flipper" aria-pressed="true">◉ ピンボール<small>フリッパーで打ち返す</small></button><button type="button" data-pb-mode="plinko" aria-pressed="false">⠿ プリンク<small>位置を選んで玉を落とす</small></button></nav>
   <div class="pb-layout"><section class="pb-game" aria-label="ボールゲーム">
    <div class="pb-scoreboard"><div><small>SCORE · 練習点</small><strong data-pb-score>0</strong></div><div><small>残りの球</small><strong data-pb-balls>3</strong></div><div><small>この端末の最高点</small><strong data-pb-best>0</strong></div></div>
    <div class="pb-board"><canvas width={480} height={720} data-pb-canvas role="img" aria-label="ピンボールの盤面。操作は下のボタンか左右キーでできます。">Canvasに対応したブラウザーで遊べます。</canvas><div class="pb-overlay" data-pb-overlay><b data-pb-overlay-title>READY</b><span data-pb-overlay-note>下の「発射する」でスタート</span></div></div>
    <div class="pb-controls"><button type="button" class="pb-flipper" data-pb-left aria-label="左フリッパー" aria-pressed="false" disabled>◀ 左</button><button type="button" class="pb-launch" data-pb-launch disabled>発射する</button><button type="button" class="pb-flipper" data-pb-right aria-label="右フリッパー" aria-pressed="false" disabled>右 ▶</button><button type="button" data-pb-pause disabled>一時停止</button></div>
    <p class="pb-status" data-pb-status role="status" aria-live="polite">準備中です。JavaScriptを有効にしてください。</p>
   </section><aside class="pb-side">
    <section class="pb-card"><h2 data-pb-title>三つの球で星を灯そう</h2><p data-pb-description>バンパーに当てて得点。上の五つの星を全部灯すとボーナスです。</p>
     <label class="pb-setting"><span data-pb-setting-label>発射の強さ</span><output data-pb-setting-value>80%</output><input type="range" min="40" max="100" value="80" step="1" data-pb-setting aria-label="発射の強さ"/></label>
     <div class="pb-tools"><button type="button" data-pb-reset disabled>最初から</button></div>
     <p data-pb-help>PC：← → または A・Dで打ち返す。Spaceで発射、Pで一時停止。スマホ：左右のボタンを押し続けて操作。</p>
    </section><section class="pb-card"><h2>遊び方と得点</h2><ul data-pb-rules><li>1回3球。発射の強さを選べます。</li><li>丸いバンパー：250点。</li><li>上の星：各100点。五つでさらに1,000点。</li><li>中央のすき間へ落ちると次の球です。</li></ul></section>
    <section class="pb-card"><h2>この回の記録</h2><p data-pb-history>3球の合計点を狙おう。</p><small>最高点は、全ての球を終えたとき、このブラウザーにだけ保存します。再読込すると遊び直しです。タブを離れると一時停止します。</small></section>
   </aside></div>
   <noscript><p>この練習ゲームはJavaScriptが必要です。銭は消費していません。</p></noscript>
  </section>
 </CasinoLayout>;
}
