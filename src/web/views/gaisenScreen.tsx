import {assetUrl} from '../assets.js';
import type {TrialView} from '../../services/casino/gaisen/trial.js';
import {PHASE_NAMES} from '../../services/casino/gaisen/engine.js';
import {GaisenReels,reelPresentation,stopGuidance} from './gaisenReels.js';
type Own=NonNullable<TrialView['own']>;

/** 縦長の画面内に演出と小さい3リールを収める。公開済みの状態だけを使う。 */
export function GaisenScreen({own,scene}:{own:Own;scene:string}){
 const {order,next}=stopGuidance(own),navi=own.spinning&&!!own.navi;
 const win=own.spinning?null:own.winEvent;
 const landscape=scene==='gg'||win?'award':'night';
 const label=own.phase==='sgg'?'SGG':own.phase==='gstop'?'G-STOP':own.phase==='normal'?'通常':'GG';
 const remaining=own.phase==='sgg'?own.sggLeft:own.phase==='gstop'?own.gstopLeft:own.phase==='normal'?own.normalGames:own.ggLeft;
 return <div class="gt-display" aria-label="演出と3リールを収めた液晶画面">
  <img class="gt-landscape" src={assetUrl(`gaisen-media-${landscape}-1600.webp`)} srcset={`${assetUrl(`gaisen-media-${landscape}-800.webp`)} 800w, ${assetUrl(`gaisen-media-${landscape}-1600.webp`)} 1600w`} sizes="(max-width: 620px) 100vw, 600px" decoding="async" alt="" aria-hidden="true"/>
  <div class="gt-scene-light" aria-hidden="true"/>
  <div class="gt-lcd">
   <div class="gt-lcd-hud" aria-label="区間の状況"><span>{label} <b>{remaining}G</b></span><span>SET <b>{own.sets}</b></span><span>STOCK <b>{own.stocks}</b></span>{(own.medusaInfinite||own.medusa>0)&&<span>停止 <b>{own.medusaInfinite?'∞':`${own.medusa}G`}</b></span>}</div>
   <p>{PHASE_NAMES[own.phase]}{scene==='medusa'?' · 時間停止':scene==='ex'?' · EX':''}</p>
   {navi?<div class="gt-lcd-navigation" data-gt-lcd-navigation role="group" aria-label={`押し順ナビ：${order.map(i=>['左','中','右'][i]).join(' → ')}`}>
    {[0,1,2].map(i=>{const stopped=own.stopped.includes(i);return <span class={'gt-lcd-cue'+(stopped?' is-stopped':next===i?' is-next':'')} data-gt-lcd-position={i} data-gt-lcd-next={String(next===i)} role="img" aria-label={`${['左','中','右'][i]}：${order.indexOf(i)+1}番目${stopped?' · 停止済み':next===i?' · 次のSTOP':''}`}><i aria-hidden="true"/><b aria-hidden="true">{order.indexOf(i)+1}</b><small aria-hidden="true">{!stopped&&next===i?'PUSH':''}</small></span>;})}
   </div>:win?<div class="gt-lcd-award" data-gt-lcd-award data-kind={win.kind} role="status"><small>{win.kind==='god'?'神 降 臨':win.kind==='sgg'?'SPECIAL GOD GAME':win.kind==='stock'?'上乗せ確定':win.added?'神殿の扉が開く':'次なる神殿へ'}</small><strong>{win.kind==='god'?'GOD':win.kind==='sgg'?'SGG':win.kind==='stock'?`＋${win.added}`:'GOD GAME'}</strong><span>{win.added>0?`＋${win.added} SET`:`第${win.set}セット`}</span></div>:<div class="gt-digits" aria-label="数字の演出画面">{reelPresentation(own).map(reel=><span class={reel.spinning?'gt-digit-spinning':''}>{reel.digit}</span>)}</div>}
   <strong class="gt-message" role="status">{own.message}</strong>
  </div>
  <div class="gt-reel-shelf"><GaisenReels own={own}/></div>
 </div>;
}
