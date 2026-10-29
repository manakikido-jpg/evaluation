import type {AdminSession} from '../../db/schema.js';
import type {TrialView} from '../../services/casino/gaisen/trial.js';
import {PHASE_NAMES,SCENARIOS,type Scenario,type RuleVersion} from '../../services/casino/gaisen/engine.js';
import {Layout} from './layout.js';
import {assetUrl} from '../assets.js';
import {GaisenReels,reelPresentation} from './gaisenReels.js';
import {WinResult,GaisenWinStage} from './gaisenWin.js';
const fmt=(n:number)=>n.toLocaleString('ja-JP');
const SCENE:Record<Scenario,string>={normal:'通常時',gg:'GG',god:'GOD降臨後',gstop:'G-STOP',sgg:'SGG',ceiling:'天井直前'};
export function GaisenTrial({m,session,error,version='trial-1'}:{m:TrialView;session:AdminSession;error?:string;version?:RuleVersion}){
 const isV2=version==='trial-2',PATH=isV2?'/economy/gaisen-trial-v2':'/economy/gaisen-trial';
 const own=m.own;
 const fields=(machine:number,action:string)=><><input type="hidden" name="_csrf" value={session.csrfToken}/><input type="hidden" name="revision" value={m.revision}/><input type="hidden" name="machine" value={machine}/><input type="hidden" name="action" value={action}/></>;
 const floor=<section class="gt-floor" aria-label="5台の試遊台">{m.machines.map(t=><article class={'gt-tile'+(t.mine?' mine':'')}><b>第{t.id}神殿</b><span>{t.ownerName?`${t.ownerName} が着席中`:'空席'}</span><small>設定{t.setting}{t.reservedSetting!==null?` → ${t.reservedSetting}予約`:''}</small>{t.occupied?<small>{t.mine?'あなたが操作できます':'着席した本人のみ操作可能'}</small>:<form method="post" action={PATH}>{fields(t.id,'seat')}<button disabled={!!own}>着席{m.saved?'して保存分を再開':''}</button></form>}<form method="post" action={PATH}>{fields(t.id,'setting')}<label>設定<select name="setting" aria-label={`第${t.id}神殿の設定`}>{[1,2,3,4,5,6].map(n=><option value={n} selected={n===t.setting}>{n}</option>)}</select></label><button>変更予約</button></form><small>{t.stat.sample?'場面確認を含む':t.lastScenario}</small><small>本日 {t.stat.spins}G · GOD {t.stat.god} / GG初当たり {t.stat.gg} / SGG {t.stat.sgg}</small><small>差枚 {fmt((t.stat.output-t.stat.input)/10)}枚相当{t.stat.resumed?' · 保存分再開あり':''}</small><svg viewBox="0 0 200 44" role="img" aria-label={`第${t.id}神殿の本日の差枚推移`}><path d="M0 22 H200" class="gt-zero"/><polyline points={t.stat.graph.map((x,i,arr)=>`${arr.length===1?0:i*200/(arr.length-1)},${22-x/Math.max(1,...arr.map(Math.abs))*20}`).join(' ')} class="gt-line"/></svg></article>)}</section>;
 return <Layout title="神殿スロットの無料試遊" nav="casinotest" session={session} wide><link rel="stylesheet" href={assetUrl('gaisen-trial.css')}/><script src={assetUrl('gaisen-trial.js')} defer/>
 <div class="gt-root" data-gaisen-trial data-revision={m.revision}>
 <header class="gt-head"><div><small>咲楽ノ宮 · 運営専用</small><h1>神殿スロット <span>無料試遊</span></h1></div><a href="/economy/casino">カジノ管理へ</a></header>
 <p class="gt-notice">凱旋のゲーム性を参考にした試作です。<strong>画像・音は独自制作、抽選の一部は暫定。</strong>実際の銭・成績は変わりません。設定は運営向けに表示しています。</p>
 <p class="gt-notice"><strong>{isV2?'新版：区間別の抽選・払出':'旧版：保存済みの続き・比較用'}</strong> · <a href={isV2?'/economy/gaisen-trial':'/economy/gaisen-trial-v2'}>{isV2?'旧版を開く':'新版を試す'}</a><br/>台・試遊ポイント・保存した進捗は版ごとに別です。切り替える前に離席すると安心です。</p>
 {isV2&&<p class="gt-caption">通常時は左から。GG中は押し順ナビに従って停止し、SGG中の右からのナビでは赤7に期待。G-STOPは上部を左から停止し、下部の押し順は自動補助します。</p>}
 {error&&<p class="gt-error" role="alert">{error}</p>}<p class="gt-error" data-gt-error hidden role="alert"/>
 {!own&&floor}
 <div class="gt-controls"><b>試遊ポイント <strong>{fmt(m.points)}</strong></b><button type="button" data-gt-audio>音：OFF</button><label>演出<select data-gt-motion><option value="normal">通常</option><option value="low">控えめ</option><option value="instant">即表示</option></select></label><a href={PATH}>最新の状態を確認</a></div>
 {own?<section class="gt-machine" data-phase={own.phase}>
 <div class="gt-marquee"><span>SAKURA · DIVINE PALACE</span><b>第{own.id}神殿</b><small>{own.resumed?'本人の保存分を再開中':'無料試遊 · 独自の神殿デザイン'}</small></div>
 <div class="gt-lcd"><div class="gt-temple" aria-hidden="true"><i/><i/><i/><i/><i/></div><p>{PHASE_NAMES[own.phase]}</p><div class="gt-digits" aria-label="数字の演出画面">{reelPresentation(own).map(reel=><span class={reel.spinning?'gt-digit-spinning':''}>{reel.digit}</span>)}</div><strong class="gt-message" role="status">{own.message}</strong></div>
 <div class="gt-meters"><span>通常 <b>{own.normalGames}G</b></span><span>GG残り <b>{own.ggLeft}G</b></span><span>セット <b>{own.sets}</b></span><span>ストック <b>{own.stocks}</b></span><span>G-STOP <b>{own.gstopLeft}G</b></span><span>SGG <b>{own.sggLeft}G</b>{own.medusa>0?` · 時間停止${own.medusa}G`:''}{own.ex?' · EX':''}</span></div>
 <WinResult event={own.winEvent}/>
 <GaisenReels own={own}/>
 {own.navi&&<p class="gt-navi">押し順ナビ：{own.navi.map(i=>['左','中','右'][i]).join(' → ')}</p>}
 <div class="gt-play"><form class="gt-lever-form" method="post" action={PATH}>{fields(own.id,'lever')}<button class="gt-lever" disabled={own.spinning||m.points<30}>レバー<small>30ポイント</small></button></form><div class="gt-stop-row">{[0,1,2].map(i=><form method="post" action={PATH}>{fields(own.id,'stop')}<input type="hidden" name="index" value={i}/><button class="gt-stop" disabled={!own.spinning||own.stopped.includes(i)||own.phase==='gstop'&&i!==[0,1,2].find(n=>!own.stopped.includes(n))}>{['左','中','右'][i]}STOP</button></form>)}</div></div>
 <div class="gt-bottom"><span>今回の戻り <b>{fmt(own.lastPaid)}</b>ポイント · 特別区間の差引 {fmt(own.chainWon)}</span><form method="post" action={PATH}>{fields(own.id,'leave')}<button disabled={own.spinning&&own.phase==='normal'}>離席{own.phase!=='normal'?'して進捗を保存':''}</button></form><form method="post" action={PATH}>{fields(own.id,'refill')}<button disabled={own.spinning}>試遊10万ポイント補充</button></form></div>
 <p class="gt-caption">最後のゲーム操作から通常10分、GG・前兆・G-STOP・SGG・G-ZONEは1時間保護。閲覧・再読込では延長しません。</p>
 <details class="gt-scenes"><summary>場面を選んで動作確認（自然抽選の収支確認とは別）</summary><p>同じ台の試遊状態と当日グラフを入れ替えます。実際の当選ではありません。保存分の再開中は使えません。</p><div>{SCENARIOS.map(key=><form method="post" action={PATH}>{fields(own.id,'scenario')}<input type="hidden" name="scenario" value={key}/><button disabled={own.spinning||own.resumed}>{SCENE[key]}</button></form>)}</div></details>
 <details open><summary>あなたの試遊履歴</summary><ol class="gt-history">{own.history.slice(0,20).map(x=><li>{x}</li>)}</ol></details>
 </section>:<div class="gt-empty"><h2>{m.saved?'保存した進捗があります':'神殿へようこそ'}</h2><p>{m.saved?'空席へ着席すると、保存時の設定で続きを再開します。':'上の5台から空席を選んでください。レバー→左・中・右のSTOPで遊べます。'}</p></div>}
 {own&&floor}
 <GaisenWinStage/>
 <details class="gt-rules"><summary>試遊の仕様・未再現部分</summary><p>1ゲーム30ポイント、1枚相当10ポイント。戻りと差引を区別します。GODの基本フラグ、GG100G、G-STOPの停止時抽選、SGG16Gの構成を確認できます。</p><p>{isV2?'区間別の役は公開資料の概数に基づく試遊モデルです。目押しは自動補助。':'役の分布は暫定です。'}表裏モード、上乗せ・ループ率、設定変更時の天井短縮、SGG-EX移行などは未照合または暫定です。実機同等の勝率・還元率ではありません。G-STOPのリーチ目やHOLDの一部も簡略化しています。当選時は独自の神殿演出と合成音が流れます。実機の映像・音源は使いません。</p></details>
 </div></Layout>;
}
