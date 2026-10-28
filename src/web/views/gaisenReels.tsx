import type {TrialView} from '../../services/casino/gaisen/trial.js';

type Own = NonNullable<TrialView['own']>;
export type ReelSymbol = 'gold7' | 'blue7' | 'red7' | 'god' | 'flower' | 'crest';
// 独自の表示用配列。実機の配列/目押し/払出判定には使わない。
const STRIP: ReelSymbol[] = ['gold7', 'flower', 'blue7', 'crest', 'red7', 'flower', 'god', 'blue7', 'crest'];
const LABELS: Record<ReelSymbol, string> = {gold7:'金の7', blue7:'青の7', red7:'赤の7', god:'神紋', flower:'桜', crest:'菱紋'};
function symbolFor(value: string | null, index: number): ReelSymbol {
  if (value === '黄7') return 'gold7';
  if (value === '青7') return 'blue7';
  if (value === '赤7') return 'red7';
  if (value && ['G','O','D'].includes(value)) return 'god';
  if (value === '◆') return 'crest';
  if (value === '桜') return 'flower';
  return STRIP[(Number(value) || index + 1) % STRIP.length]!;
}
/** 公開済みの停止表示だけ使う。未停止の役/停止予定位置は受け取らない。 */
export function reelPresentation(own: Own) {
  return own.display.map((value, index) => {
    const spinning = own.spinning && !own.stopped.includes(index);
    const center = symbolFor(own.reels[index]??null, index);
    const rows: ReelSymbol[] = [(['flower','crest','blue7'] as const)[index]!, center, (['crest','red7','flower'] as const)[index]!];
    // 2巡分で継ぎ目なく縦に流す。回転中の絵柄は停止結果の予告ではない。
    const cycle = [...STRIP.slice(index), ...STRIP.slice(0, index)];
    const strip = spinning ? [...cycle, ...cycle] : rows;
    const digit = value === null ? '✦' : value === '赤7' ? ['S','G','G'][index]!
      : value === '黄7' ? ['1','4','6'][index]! : value === '青7' ? ['2','4','6'][index]!
      : value === '◆' ? ['3','2','4'][index]! : value;
    return {spinning, rows, strip, digit, label: spinning ? '回転中' : rows.map(s => LABELS[s]).join('・')};
  });
}

function SymbolArt({symbol}: {symbol: ReelSymbol}) {
  return <span class={'gt-symbol gt-symbol-' + symbol} aria-hidden="true">
    {symbol.endsWith('7') ? <><span class="gt-seven">7</span><span class="gt-symbol-sub">SAKURA</span></>
      : symbol === 'god' ? <><span class="gt-god-mark">✦</span><span class="gt-god-word">GOD</span></>
      : symbol === 'flower' ? <><span class="gt-flower">✿</span><span class="gt-symbol-sub">咲楽</span></>
      : <><span class="gt-crest">◆</span><span class="gt-symbol-sub">神紋</span></>}
  </span>;
}

export function GaisenReels({own}: {own: Own}) {
  const reels = reelPresentation(own);
  return <div class="gt-reel-deck">
    <div class="gt-reel-heading"><span>神殿の三連リール</span><small>{own.reelPhase==='gstop'?'G-STOP：上部で抽選':'有効ライン：中段'}</small></div>
    <div class="gt-reels" role="group" aria-label="左・中・右の3リール、それぞれ縦3段">
      {reels.map((reel, index) => <div class={'gt-reel' + (reel.spinning ? ' is-spinning' : ' is-stopped')}
        data-gt-reel={index} data-center={reel.spinning?'':reel.rows[1]} role="img" aria-label={`${['左','中','右'][index]}リール：${reel.label}`}>
        <div class="gt-reel-strip" aria-hidden="true">{reel.strip.map(symbol => <SymbolArt symbol={symbol}/>)}</div>
        <span class="gt-reel-glass" aria-hidden="true"/>
        {reel.spinning && <span class="gt-reel-motion-label">回転中</span>}
      </div>)}
    </div>
    <p class="gt-settlement" data-gt-settlement>{own.spinning?'STOPで結果を確定':own.spins===0?'レバーで次のゲームへ':own.resultRole==='red7'?'赤7成立 · GG獲得（払出0ポイント）':own.resultRole==='replay'?'リプレイ · 30ポイント返却':own.resultRole==='bell'&&own.lastPaid===0?'押し順不一致 · 払出0ポイント':`払出 ${own.lastPaid.toLocaleString('ja-JP')}ポイント`}</p>
    <div class="gt-reel-labels" aria-hidden="true">{['左','中','右'].map((label, index) => <span>{label}<b>{reels[index]!.spinning ? '回転中' : '停止'}</b></span>)}</div>
  </div>;
}
