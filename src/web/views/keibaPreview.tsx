import { CasinoLayout, type CasinoMe } from './casino.js';
import { assetUrl } from '../assets.js';
import type { KeibaPreviewData } from '../../services/casino/keibaPreview.js';
export function KeibaPreviewPage(p: { me: CasinoMe; data: KeibaPreviewData }) {
  return <CasinoLayout title="競馬の映像試作" me={p.me}>
    <link rel="stylesheet" href={assetUrl('keiba-preview.css')} />
    <script type="module" src={assetUrl('keiba-preview.js')}></script>
    <div class="kr-page" data-keiba-preview={JSON.stringify(p.data)}>
      <header class="kr-heading"><div><p>SAKURA NO MIYA · RACING LAB</p><h1>咲楽ノ宮競馬場</h1><span>8頭の映像試作 · サンプルレース／馬券なし</span></div><a href="/casino/tables/keiba">競馬へ戻る</a></header>
      <section class="kr-broadcast" aria-label="映像試作の操作と再生">
        <div class="kr-top"><span>REPLAY</span><b>芝 1,600m　晴・良</b><output data-kr-clock>00:00</output></div>
        <div class="kr-screen"><div data-kr-scene role="img" aria-label="8頭のサンプルレースの3D映像"></div><canvas data-kr-flat hidden aria-label="軽量表示のレース"></canvas><div class="kr-screen-caption"><span>SAKURA RACECOURSE</span><strong data-kr-caption>全景カメラ</strong></div><p class="kr-status" data-kr-status role="status">映像を準備しています…</p></div>
        <div class="kr-controls"><button type="button" data-kr-play>再生</button><button type="button" data-kr-goal>ゴール前へ</button><label class="kr-seek">再生位置<input data-kr-seek type="range" min="0" max="1000" value="0" /></label><output data-kr-distance>残り1,600m</output></div>
        <div class="kr-options"><fieldset><legend>カメラ</legend><button type="button" data-kr-camera="wide" aria-pressed="true">全景</button><button type="button" data-kr-camera="track" aria-pressed="false">直線・追走</button><button type="button" data-kr-camera="finish" aria-pressed="false">ゴール</button></fieldset><label>画質<select data-kr-quality><option value="auto">自動</option><option value="high">高画質</option><option value="low">軽量3D</option><option value="flat">平面表示</option></select></label><output data-kr-performance>計測待ち</output></div>
      </section>
      <section class="kr-results"><div><p>RACE MONITOR</p><h2>途中順位</h2></div><ol data-kr-ranking></ol></section>
      <p class="kr-note">映像を確認するためのサンプルレースです。馬券の購入や払戻はありません。</p>
    </div>
  </CasinoLayout>;
}
