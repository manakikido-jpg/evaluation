import { CasinoLayout, type CasinoMe } from './casino.js';
import { assetUrl } from '../assets.js';
import type { keibaBroadcast } from '../../services/casino/keibaBroadcast.js';
import { KB_SURFACES, KB_WEATHERS, KB_GOINGS } from '../../services/casino/keiba.js';
import type { KeibaPreviewData } from '../../services/casino/keibaPreview.js';
type PreviewProps = { me: CasinoMe; data: KeibaPreviewData | NonNullable<ReturnType<typeof keibaBroadcast>>; tableId?: number; embedded?: boolean; mine?: number[] };
export function KeibaPreviewPage(p: PreviewProps) {
  return <CasinoLayout title={p.data.demo ? "競馬の映像試作" : "競馬の3D観戦"} me={p.me}><KeibaPreviewContent {...p}/></CasinoLayout>;
}
export function KeibaPreviewContent(p: PreviewProps) {
  const demo = p.data.demo;
  const back = p.tableId ? `/casino/t/${p.tableId}` : "/casino/tables/keiba";
  return <>
    <link rel="stylesheet" href={assetUrl('keiba-preview.css')} />
    <script type="module" src={assetUrl('keiba-preview.js')}></script>
    <div class={`kr-page${p.embedded ? " kr-embedded" : ""}`} data-keiba-module={assetUrl('keiba-preview.js')} data-keiba-preview={JSON.stringify({...p.data,mine:p.mine??[],embedded:!!p.embedded})}>
      <header class="kr-heading"><div><p>{demo ? "SAKURA NO MIYA · RACING LAB" : "SAKURA NO MIYA · RACING"}</p><h1>咲楽ノ宮競馬場</h1><span>{demo ? "8頭の映像試作 · サンプルレース／馬券なし" : p.data.race.name}</span></div><a href={back}>競馬へ戻る</a></header>
      <section class="kr-broadcast" aria-label="レース映像の操作と再生">
        <div class="kr-top"><span data-kr-mode>{demo ? "REPLAY" : "観戦"}</span><b>{KB_SURFACES[p.data.race.surface]} {p.data.race.dist.toLocaleString("ja-JP")}m　{KB_WEATHERS[p.data.race.weather]}・{KB_GOINGS[p.data.race.going]}</b><output data-kr-clock>00:00</output></div>
        <div class="kr-screen"><div class="kr-race-event" data-kr-event hidden role="status"></div><div data-kr-scene role="img" aria-label={demo ? "8頭のサンプルレースの3D映像" : "レースの3D映像"}></div><canvas data-kr-flat hidden aria-label="軽量表示のレース"></canvas><div class="kr-screen-caption"><span>SAKURA RACECOURSE</span><strong data-kr-caption>全景カメラ</strong></div><p class="kr-status" data-kr-status role="status">映像を準備しています…</p></div>
        <div class="kr-controls"><button type="button" data-kr-play>再生</button><button type="button" data-kr-goal>ゴール前へ</button><label class="kr-seek">再生位置<input data-kr-seek type="range" min="0" max="1000" value="0" /></label><output data-kr-distance>残り{p.data.race.dist.toLocaleString("ja-JP")}m</output></div>
        <div class="kr-options"><fieldset><legend>カメラ</legend><button type="button" data-kr-camera="wide" aria-pressed="true">全景</button><button type="button" data-kr-camera="track" aria-pressed="false">直線・追走</button><button type="button" data-kr-camera="finish" aria-pressed="false">ゴール</button></fieldset><label>画質<select data-kr-quality><option value="auto">自動</option><option value="high">高画質</option><option value="low">軽量3D</option><option value="flat">平面表示</option></select></label><label><input type="checkbox" data-kr-audio/> 音・読み上げ</label><label><input type="checkbox" data-kr-effects checked/> 演出</label><output data-kr-performance>計測待ち</output></div>
      </section>
      <section class="kr-results"><div><p>RACE MONITOR</p><h2>途中順位</h2></div><ol data-kr-ranking></ol></section>
      <p class="kr-note" data-kr-live-status>{demo ? "映像を確認するためのサンプルレースです。馬券の購入や払戻はありません。" : p.embedded ? "馬券・払戻はこの画面の「あなたの馬券」で確認できます。" : "レース中は現在までの映像を表示します。結果確定後は自由に見返せます。馬券・払戻の確認は競馬の卓へ戻ってください。"}</p>
      {!demo && <p class="kr-note" data-kr-call role="status"></p>}
      {!demo && <section class="kr-official" data-kr-official hidden><h2>確定結果</h2><ol data-kr-times></ol><a href={back}>馬券・払戻を確認する</a></section>}
    </div>
  </>;
}
