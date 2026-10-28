import type {WinEvent} from '../../services/casino/gaisen/engine.js';

export function WinResult({event}:{event:WinEvent|null}) {
 if(!event)return null;
 const name=event.kind==='god'?'GOD降臨':event.kind==='sgg'?'SGG突入':event.kind==='gg'?(event.added?'GG獲得':'GG継続'):'GG上乗せ';
 return <p class={'gt-win-result gt-win-'+event.kind} data-gt-win data-win-kind={event.kind} data-win-added={event.added}
   data-win-set={event.set} data-win-gg={event.ggGames} data-win-sgg={event.sggGames}>
   <strong>{name}</strong><span>{event.added>0?`GG ＋${event.added}セット`:`第${event.set}セット開始`}</span>
   {event.sggGames>0&&<b>SGG 残り{event.sggGames}G</b>}{event.ggGames>0&&<small>GG 残り{event.ggGames}G</small>}
 </p>;
}

/** 表示だけの演出。閉じる/スキップはゲームへのPOSTを行わない。 */
export function GaisenWinStage(){return <>
 <details class="gt-effect-preview"><summary>当選演出だけを見る</summary><p>演出の見本です。試遊ポイント・セット・進行は変わりません。</p>
 <div>{(['gg','sgg','god','stock'] as const).map((kind,i)=><button type="button" data-gt-win-preview={kind}>{['GG当選','SGG突入','GOD降臨','上乗せ'][i]}</button>)}</div></details>
 <dialog class="gt-celebration" data-gt-celebration aria-labelledby="gt-win-title" aria-describedby="gt-win-benefit">
  <div class="gt-award-scene" data-stage="reveal">
   <div class="gt-award-orbit" aria-hidden="true"/><div class="gt-award-rays" aria-hidden="true"/>
   <div class="gt-award-shrine" aria-hidden="true"><div class="gt-award-roof"/><div class="gt-award-columns"><i/><i/><i/><i/><i/><i/></div><div class="gt-award-stairs"/></div>
   <div class="gt-award-petals" aria-hidden="true">{Array.from({length:12},(_,i)=><i class={'gt-petal-'+i}>✦</i>)}</div>
   <div class="gt-award-content"><p class="gt-award-kicker" data-gt-win-kicker/>
    <p class="gt-award-prefix" data-gt-win-prefix/>
    <h2 id="gt-win-title" data-gt-win-title/>
    <p class="gt-award-count" id="gt-win-benefit"><b data-gt-win-count/><span data-gt-win-unit>SET</span></p>
    <p class="gt-award-detail" data-gt-win-detail/>
   </div>
   <div class="gt-award-actions"><span data-gt-win-hint>結果は保存済みです</span><button type="button" data-gt-win-skip autofocus>演出をスキップ</button><button type="button" data-gt-win-mute>音をOFF</button></div>
  </div>
 </dialog>
 </>;}
