import {assetUrl} from '../assets.js';
import type {TrialView} from '../../services/casino/gaisen/trial.js';

type Own = NonNullable<TrialView['own']>;
export type {ReelSymbol} from '../../services/casino/gaisen/reelRules.js';
import {REEL_STRIPS,REEL_LABELS as LABELS,reelSymbol,canonicalPosition,reelRows,type ReelSymbol} from '../../services/casino/gaisen/reelRules.js';
/** 押し順は公開済みの案内だけから作る。停止結果の予告には使わない。 */
export function stopGuidance(own: Own) {
  const order=own.phase==='gstop'?[0,1,2]:own.navi??[0,1,2];
  return {order,next:own.spinning?order.find(i=>!own.stopped.includes(i)):undefined};
}
/** 公開済みの停止表示だけ使う。未停止の役/停止予定位置は受け取らない。 */
export function reelPresentation(own: Own) {
  return own.display.map((value, index) => {
    const spinning = own.spinning && !own.stopped.includes(index);
    const center = reelSymbol(own.reels[index]??null, index);
    const stop=own.reelStops?.[index];
    const position=stop?.position??canonicalPosition(index,center);
    const rows=reelRows(index,position);
    const cycle=[...REEL_STRIPS[index]!].reverse();
    const strip=spinning?[...cycle,...cycle]:stop?Array.from({length:13},(_,i)=>REEL_STRIPS[index]![(position+26-i)%20]!):rows;
    const digit = value === null ? '✦' : value === '赤7' ? ['S','G','G'][index]!
      : value === '黄7' ? ['1','4','6'][index]! : value === '青7' ? ['2','4','6'][index]!
      : value === '◆' ? ['3','2','4'][index]! : value;
    return {spinning, rows, strip, digit, stop, position, label: spinning ? '回転中' : rows.map(s => LABELS[s]).join('・')};
  });
}

export function SymbolArt({symbol,lazy=false}: {symbol: ReelSymbol;lazy?:boolean}) {
  return <span class={'gt-symbol gt-symbol-' + symbol} aria-hidden="true">
    <img class="gt-symbol-art" src={assetUrl('gaisen-media-symbol-'+symbol+'.webp')} alt="" width={256} height={256} decoding="async" loading={lazy?'lazy':undefined}/>
    {symbol==='god'&&<span class="gt-god-word">GOD</span>}
  </span>;
}

export function GaisenReels({own}: {own: Own}) {
  const reels = reelPresentation(own),guidance=stopGuidance(own);
  // 目押し停止は前後6コマを置き、保存済み0〜4コマの滑りを同じ配列で見せる。
  return <div class="gt-reel-deck">
    <div class="gt-reel-heading"><span>神殿の三連リール</span><small>{own.reelPhase==='gstop'?'G-STOP：上部で抽選':'有効ライン：中段'}</small></div>
    <div class="gt-reels" role="group" aria-label={`左・中・右の3リール、それぞれ縦3段。${own.reelPhase==='gstop'?'G-STOPは上部で抽選':'有効ラインは中段'}`}>
      {reels.map((reel, index) => <div class={'gt-reel' + (reel.spinning ? ' is-spinning' : ' is-stopped')+(reel.stop&&!reel.spinning?' is-timed-stop':'')}
        data-gt-reel={index} data-position={reel.spinning?undefined:reel.position+1} data-slip={reel.spinning?undefined:reel.stop?.slip} data-gt-reel-next={String(guidance.next===index)} data-center={reel.spinning?'':reel.rows[1]} role="img" aria-label={`${['左','中','右'][index]}リール：${reel.label}${!reel.spinning&&reel.stop?` · ${reel.position+1}番 · ${reel.stop.assisted?'補助':reel.stop.slip+'コマ滑り'}`:''}${guidance.next===index?' · 次のSTOP':''}`} >
        <div class="gt-reel-strip" aria-hidden="true">{!reel.spinning&&!reel.stop&&<SymbolArt symbol={reel.rows[0]!}/>}{reel.strip.map(symbol => <SymbolArt symbol={symbol}/>)}{!reel.spinning&&!reel.stop&&<SymbolArt symbol={reel.rows[2]!}/>}</div>
        <span class="gt-reel-glass" aria-hidden="true"/>
        {reel.spinning && <span class="gt-reel-motion-label">回転中</span>}
      </div>)}
    </div>
    <p class="gt-settlement" data-gt-settlement>{own.spinning?'STOPで結果を確定':own.spins===0?'レバーで次のゲームへ':own.resultRole==='red7'?`赤7成立 · GG獲得（${own.lastPaid===30?'リプレイ · 30ポイント返却':`払出${own.lastPaid}ポイント`}）`:own.resultReplay||own.resultRole==='replay'?'リプレイ · 30ポイント返却':own.resultRole==='bell'&&own.lastPaid===0?'押し順または目押し不一致 · 払出0ポイント':`払出 ${own.lastPaid.toLocaleString('ja-JP')}ポイント`}</p>
    <div class="gt-reel-labels" aria-hidden="true">{['左','中','右'].map((label, index) => <span>{label}<b>{reels[index]!.spinning ? '回転中' : reels[index]!.stop?`${reels[index]!.position+1}番 · ${reels[index]!.stop!.assisted?'補助':reels[index]!.stop!.slip+'コマ滑り'}`:'停止'}</b></span>)}</div>
  </div>;
}
