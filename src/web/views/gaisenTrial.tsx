import {HISTORY_NAMES} from '../../services/casino/gaisen/historyRules.js';
import type {AdminSession} from '../../db/schema.js';
import type {TrialView} from '../../services/casino/gaisen/trial.js';
import {PHASE_NAMES,SCENARIOS,type Scenario,type RuleVersion} from '../../services/casino/gaisen/engine.js';
import {Layout} from './layout.js';
import {assetUrl} from '../assets.js';
import {GaisenReels,reelPresentation,stopGuidance} from './gaisenReels.js';
import {WinResult,GaisenWinStage} from './gaisenWin.js';
const fmt=(n:number)=>n.toLocaleString('ja-JP');
const SCENE:Record<Scenario,string>={normal:'通常時',gg:'GG',god:'GOD降臨後',gstop:'G-STOP',sgg:'SGG',ceiling:'天井直前',omen:'前兆（当選済み）',medusa:'メデューサ（時間停止）','sgg-ex':'SGG-EX',heaven:'天国ショート', 'back-high':'裏天国', 'gstop-high':'GG中のG-STOP（鏡高確）'};
export function GaisenTrial({m,session,error,version='trial-1'}:{m:TrialView;session:AdminSession;error?:string;version?:RuleVersion}){
 const isV2=version==='trial-2',PATH=isV2?'/economy/gaisen-trial-v2':'/economy/gaisen-trial';
 const own=m.own;
 const soundKeys=['lever','stop-left','stop-middle','stop-right','payout','replay','phase','medusa','ex','gg','sgg','stock','god'];
 const soundUrls=Object.fromEntries(soundKeys.map(key=>[key,assetUrl('gaisen-media-'+key+'.mp3')]));
 // 公開済みの区間と押し順だけを見た目に使う。内部モードは参照しない。
 const scene=own?.phase==='sgg'?(own.ex?'ex':own.medusa>0||own.medusaInfinite?'medusa':'sgg'):own?.phase??'normal';
 const {order,next:nextStop}=own?stopGuidance(own):{order:[0,1,2],next:undefined};
 const guide=own?.spinning?`${['左','中','右'][nextStop??0]}STOP${own.navi?'（押し順ナビ）':''}`:m.points<30?'ポイントを補充してください':'レバーで次のゲームへ';
 const fields=(machine:number,action:string)=><><input type="hidden" name="_csrf" value={session.csrfToken}/><input type="hidden" name="revision" value={m.revision}/><input type="hidden" name="machine" value={machine}/><input type="hidden" name="action" value={action}/></>;
 const floor=<section class="gt-floor" aria-label="5台の試遊台">{m.machines.map(t=><article class={'gt-tile'+(t.mine?' mine':'')}><b>第{t.id}神殿</b><span>{t.ownerName?`${t.ownerName} が着席中`:'空席'}</span><small>設定{t.setting}{t.reservedSetting!==null?` → ${t.reservedSetting}予約`:''}</small>{t.occupied?<small>{t.mine?'あなたが操作できます':'着席した本人のみ操作可能'}</small>:<form method="post" action={PATH}>{fields(t.id,'seat')}<button disabled={!!own}>着席{m.saved?'して保存分を再開':''}</button></form>}<form method="post" action={PATH}>{fields(t.id,'setting')}<label>設定<select name="setting" aria-label={`第${t.id}神殿の設定`}>{[1,2,3,4,5,6].map(n=><option value={n} selected={n===t.setting}>{n}</option>)}</select></label><button>変更予約</button></form><small>{t.stat.sample?'場面確認を含む':t.lastScenario}</small><small>本日 {t.stat.spins}G · GOD {t.stat.god} / GG初当たり {t.stat.gg} / SGG {t.stat.sgg}</small><small>差枚 {fmt((t.stat.output-t.stat.input)/10)}枚相当{t.stat.resumed?' · 保存分再開あり':''}</small><svg viewBox="0 0 200 44" role="img" aria-label={`第${t.id}神殿の本日の差枚推移`}><path d="M0 22 H200" class="gt-zero"/><polyline points={t.stat.graph.map((x,i,arr)=>`${arr.length===1?0:i*200/(arr.length-1)},${22-x/Math.max(1,...arr.map(Math.abs))*20}`).join(' ')} class="gt-line"/></svg></article>)}</section>;
 return <Layout title="神殿スロットの無料試遊" nav="casinotest" session={session} wide><link rel="stylesheet" href={assetUrl('gaisen-trial.css')}/><script src={assetUrl('gaisen-audio.js')} defer/><script src={assetUrl('gaisen-trial.js')} defer/>
 <div class="gt-root" data-gaisen-trial data-gt-sounds={JSON.stringify(soundUrls)} data-revision={m.revision}>
 <header class="gt-head"><div><small>咲楽ノ宮 · 運営専用</small><h1>神殿スロット <span>無料試遊</span></h1></div><a href="/economy/casino">カジノ管理へ</a></header>
 <p class="gt-notice">凱旋のゲーム性を参考にした試作です。<strong>画像・音は独自制作、抽選の一部は暫定。</strong>実際の銭・成績は変わりません。設定は運営向けに表示しています。</p>
 <p class="gt-notice"><strong>{isV2?'新版：区間別の抽選・払出':'旧版：保存済みの続き・比較用'}</strong> · <a href={isV2?'/economy/gaisen-trial':'/economy/gaisen-trial-v2'}>{isV2?'旧版を開く':'新版を試す'}</a><br/>台・試遊ポイント・保存した進捗は版ごとに別です。切り替える前に離席すると安心です。</p>
 {isV2&&<p class="gt-caption">通常時は左から。GG中は押し順ナビに従って停止し、SGG中の右からのナビでは赤7に期待。G-STOPは上部を左から停止し、下部の押し順は自動補助します。</p>}
 {error&&<p class="gt-error" role="alert">{error}</p>}<p class="gt-error" data-gt-error hidden role="alert"/>
 {!own&&floor}
 <div class="gt-controls"><b>試遊ポイント <strong>{fmt(m.points)}</strong></b><button type="button" data-gt-audio aria-pressed="false">音：OFF</button><label>音量<select data-gt-volume aria-label="効果音の音量"><option value="0.3">小さめ</option><option value="0.65" selected>ふつう</option><option value="1">大きめ</option></select></label><label>演出<select data-gt-motion><option value="normal">通常</option><option value="low">控えめ</option><option value="instant">即表示</option></select></label><a href={PATH}>最新の状態を確認</a></div>
 {own?<section class="gt-machine" data-phase={own.phase} data-scene={scene} data-spinning={String(own.spinning)} data-paid={own.lastPaid} data-spins={own.spins} aria-label={`第${own.id}神殿の操作画面`}>
 <div class="gt-marquee"><span>SAKURA · DIVINE PALACE</span><b>第{own.id}神殿</b><small>{own.resumed?'本人の保存分を再開中':'無料試遊 · 独自の神殿デザイン'}</small></div>
 <div class="gt-lcd"><img class="gt-landscape" src={assetUrl('gaisen-media-night-1600.webp')} srcset={`${assetUrl('gaisen-media-night-800.webp')} 800w, ${assetUrl('gaisen-media-night-1600.webp')} 1600w`} sizes="(max-width: 520px) 100vw, 880px" decoding="async" alt="" aria-hidden="true"/><div class="gt-scene-light" aria-hidden="true"/><div class="gt-temple" aria-hidden="true"><i/><i/><i/><i/><i/></div><p>{PHASE_NAMES[own.phase]}{scene==='medusa'?' · 時間停止':scene==='ex'?' · EX':''}</p><div class="gt-digits" aria-label="数字の演出画面">{reelPresentation(own).map(reel=><span class={reel.spinning?'gt-digit-spinning':''}>{reel.digit}</span>)}</div><strong class="gt-message" role="status">{own.message}</strong></div>
 <div class="gt-meters"><span>通常 <b>{own.normalGames}G</b></span><span>GG残り <b>{own.ggLeft}G</b></span><span>セット <b>{own.sets}</b></span><span>ストック <b>{own.stocks}</b></span><span>G-STOP <b>{own.gstopLeft}G</b></span><span>SGG <b>{own.sggLeft}G</b>{own.medusaInfinite?' · 時間停止（巻き戻しまで）':own.medusa>0?` · 時間停止${own.medusa}G`:''}{own.ex?' · EX':''}</span></div>
 {isV2&&<section class="gt-symbol-history" aria-label="直近5ゲームの小役履歴"><span>小役履歴 <small>古い → 新しい</small></span><ol>{own.symbolHistory.map(symbol=><li class={'gt-history-'+symbol}>{HISTORY_NAMES[symbol]}</li>)}</ol>{own.symbolHistory.length===0&&<small>3つのSTOPで履歴が増えます</small>}{own.gstopQueue>0&&<strong>G-STOP待機 {own.gstopQueue}回</strong>}</section>}
 <WinResult event={own.winEvent}/>
 <div class="gt-console">
 <GaisenReels own={own}/>
 {own.navi&&<p class="gt-navi">押し順ナビ：{own.navi.map(i=>['左','中','右'][i]).join(' → ')}</p>}
 <div class="gt-play"><p class="gt-operation-guide" data-gt-guide role="status">{guide}</p><button class="gt-focus-toggle" type="button" data-gt-focus aria-pressed="false">操作に集中</button><form class="gt-lever-form" method="post" action={PATH}>{fields(own.id,'lever')}<button class="gt-lever" data-gt-key="lever" disabled={own.spinning||m.points<30}>レバー<small>30ポイント</small></button></form><div class="gt-stop-row">{[0,1,2].map(i=><form method="post" action={PATH}>{fields(own.id,'stop')}<input type="hidden" name="index" value={i}/><button class={'gt-stop'+(nextStop===i?' is-next':'')} data-gt-key={'stop-'+i} data-order={order.indexOf(i)+1} aria-label={`${['左','中','右'][i]}STOP${nextStop===i?' · 次の停止':''}`} disabled={!own.spinning||own.stopped.includes(i)||own.phase==='gstop'&&i!==[0,1,2].find(n=>!own.stopped.includes(n))}>{['左','中','右'][i]}STOP</button></form>)}</div></div>
 </div>
 <div class="gt-bottom"><span>今回の戻り <b>{fmt(own.lastPaid)}</b>ポイント · 特別区間の差引 {fmt(own.chainWon)}</span><form method="post" action={PATH}>{fields(own.id,'leave')}<button disabled={own.spinning&&own.phase==='normal'}>離席{own.phase!=='normal'?'して進捗を保存':''}</button></form><form method="post" action={PATH}>{fields(own.id,'refill')}<button disabled={own.spinning}>試遊10万ポイント補充</button></form></div>
 <p class="gt-caption">最後のゲーム操作から通常10分、GG・前兆・G-STOP・SGG・G-ZONEは1時間保護。閲覧・再読込では延長しません。</p>
 <details class="gt-scenes"><summary>場面を選んで動作確認（自然抽選の収支確認とは別）</summary><p>同じ台の試遊状態と当日グラフを入れ替えます。実際の当選ではありません。保存分の再開中は使えません。</p><div>{SCENARIOS.filter(key=>isV2||!['omen','medusa','sgg-ex','heaven','back-high','gstop-high'].includes(key)).map(key=><form method="post" action={PATH}>{fields(own.id,'scenario')}<input type="hidden" name="scenario" value={key}/><button disabled={own.spinning||own.resumed}>{SCENE[key]}</button></form>)}</div></details>
 <details><summary>あなたの試遊履歴</summary><ol class="gt-history">{own.history.slice(0,20).map(x=><li>{x}</li>)}</ol></details>
 </section>:<div class="gt-empty"><h2>{m.saved?'保存した進捗があります':'神殿へようこそ'}</h2><p>{m.saved?'空席へ着席すると、保存時の設定で続きを再開します。':'上の5台から空席を選んでください。レバー→左・中・右のSTOPで遊べます。'}</p></div>}
 {own&&floor}
 <GaisenWinStage/>
 <details class="gt-rules"><summary>試遊の仕様・未再現部分</summary>{isV2&&<p>小役履歴は直近5ゲーム。通常は青7の3連で抽選・4連でG-STOP、GG中は青7の5連でG-STOPです。黄7・宝石・SGG中の赤7などでもGGを抽選します。G-STOPの追加当選は待機して順番に消化します。前兆中の当選分は、GODやほかの当選が重なっても保持します。「場面を選んで動作確認」の前兆から、途中保存・再開も試せます。通常の初当たり前兆は成立役により最大12・16・24G。通常天井は1480G到達後に24Gの前兆を経由し、当選済みの前兆中でも天井の恩恵を保持します。天井の追加抽選は途中保存できます。SGGの時間停止は10・20・30Gまたは巻き戻しまで続き、3枚役で得た分は最終Gで告知します。EXは成立役ごとに上乗せを抽選します。メデューサ・EXの確認場面も選べます。</p>}<p>1ゲーム30ポイント、1枚相当10ポイント。戻りと差引を区別します。GODの基本フラグ、GG100G、G-STOPの停止時抽選、SGG16Gの構成を確認できます。</p><p>{isV2?'表8種類・裏3種類のモードと成立役別の当選、追加ループ、G-STOPの鏡・HOLD・5種類のリーチ目を実装しています。設定変更時は510・1000・1480Gの天井と開始モードを一度だけ抽選し、保存します。通常に新設した台の天井は1480Gです。公開資料の丸め値を使う試遊モデルで、目押しは自動補助です。GG中の鏡高確への移行率は未確認のため、自然抽選は鏡低確、鏡高確は専用の確認場面で試せます。EXと時間停止の重複や資料差のある抽選は、試遊用の採用規則で動きます。':'旧版は表裏モード・上乗せ・ループ・天井短縮などに暫定抽選を使います。'}実機同等の勝率・還元率ではありません。当選時は独自の神殿演出と合成音が流れます。実機の映像・音源は使いません。</p></details>
 </div></Layout>;
}
