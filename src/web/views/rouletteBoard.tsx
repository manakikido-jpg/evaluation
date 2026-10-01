import type { CasinoConfig } from '../../config.js';
import { rouletteBetLabel, rouletteColor, rouletteMaxOf, rouletteMultiplier, ROULETTE_BETS, ROULETTE_MAX_SPOTS, ROULETTE_ORDER, type RouletteBet } from '../../services/casino/roulette.js';
import type { Coin } from './casino.js';

/**
 * ルーレットの盤（本物の台と同じ並び）。チップを選んでマスを押すと置ける（casino.js）。
 * 「回す」で bets=red:100,n7:50 を送る。PC は横長（3 段 × 12 列）、スマホは縦長（3 列 × 12 段）。
 * result があれば、当たったマスを光らせる。
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const NUMBERS = Array.from({ length: 36 }, (_, i) => i + 1);
type Outside = keyof typeof ROULETTE_BETS;
const DOZENS: Outside[] = ['dozen1', 'dozen2', 'dozen3'];
const EVENS: Outside[] = ['low', 'even', 'red', 'black', 'odd', 'high'];
const COLUMNS: Outside[] = ['col1', 'col2', 'col3'];
const SHORT: Partial<Record<Outside, string>> = { low: '1〜18', high: '19〜36', even: '偶数', odd: '奇数', red: '赤', black: '黒', dozen1: '1st 12', dozen2: '2nd 12', dozen3: '3rd 12', col1: '2:1', col2: '2:1', col3: '2:1' };

export function RouletteBoard(p: {
  action: string;
  csrf: string;
  casino: CasinoConfig;
  coin: Coin;
  hidden?: Record<string, string>;
  /** 前の結果（当たったマスを光らせる） */
  number?: number | null;
  submitLabel: string;
  /** 「前回と同じ」の覚えておく名前 */
  memoryKey: string;
  disabled?: boolean;
}) {
  // 1 か所の最高（ルーレットだけ別に決められる）。大きい賭けのチップも出す
  const max = rouletteMaxOf(p.casino);
  const chips = [...new Set([p.casino.minBet, 50, 100, 500, 1000, 5000, 10000, 50000, 100000])].filter((n) => n >= p.casino.minBet && n <= max).sort((a, b) => a - b);
  const hit = (bet: RouletteBet) => (p.number !== undefined && p.number !== null && rouletteMultiplier(bet, p.number) > 0 ? ' hit' : '');
  const Cell = (q: { bet: RouletteBet; cls: string; label: string; title: string }) => (
    <button type="button" class={`c-rb-cell ${q.cls}${hit(q.bet)}`} data-bet={q.bet} title={q.title} disabled={p.disabled}>
      <span class="c-rb-label">{q.label}</span>
    </button>
  );
  return (
    <form method="post" action={p.action} class="c-rb" data-rb={p.memoryKey} data-min={String(p.casino.minBet)} data-max={String(max)} data-spots={String(ROULETTE_MAX_SPOTS)}>
      <input type="hidden" name="_csrf" value={p.csrf} />
      {Object.entries(p.hidden ?? {}).map(([k, v]) => (
        <input type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="bets" value="" data-rb-bets />
      <div class="c-rb-chips" role="radiogroup" aria-label="置くチップ">
        <span class="c-muted c-rb-hint">① チップを選んで ② マスを押す</span>
        {chips.map((n, i) => (
          <button type="button" class={`c-chip c-chip-${chipTone(n)}${i === Math.min(1, chips.length - 1) ? ' on' : ''}`} data-chip={String(n)} aria-pressed={i === Math.min(1, chips.length - 1) ? 'true' : 'false'}>
            {fmt(n)}
          </button>
        ))}
      </div>
      <div class="c-rb-board">
        <Cell bet="n0" cls="zero green" label="0" title="0（36 倍）" />
        {NUMBERS.map((n) => (
          <Cell bet={`n${n}`} cls={`rn rn-${n} ${rouletteColor(n)}`} label={String(n)} title={`${n}（36 倍）`} />
        ))}
        {COLUMNS.map((k) => (
          <Cell bet={k} cls={`out ${k}`} label={SHORT[k]!} title={`${ROULETTE_BETS[k].label}（3 倍）`} />
        ))}
        {DOZENS.map((k) => (
          <Cell bet={k} cls={`out ${k}`} label={SHORT[k]!} title={`${ROULETTE_BETS[k].label}（3 倍）`} />
        ))}
        {EVENS.map((k) => (
          <Cell bet={k} cls={`out ${k}${k === 'red' ? ' red' : k === 'black' ? ' black' : ''}`} label={k === 'red' ? '◆ 赤' : k === 'black' ? '◆ 黒' : SHORT[k]!} title={`${ROULETTE_BETS[k].label}（2 倍）`} />
        ))}
      </div>
      <div class="c-rb-foot">
      <div class="c-rb-slip">
        <span>
          賭け <b data-rb-total>0</b> {p.coin.name}・<span data-rb-count>0</span> / {ROULETTE_MAX_SPOTS} か所
        </span>
        <span class="c-rb-tools">
          <button type="button" class="c-btn c-btn-small c-btn-ghost" data-rb-undo>
            ↶ 1 つ戻す
          </button>
          <button type="button" class="c-btn c-btn-small c-btn-ghost" data-rb-clear>
            クリア
          </button>
          <button type="button" class="c-btn c-btn-small c-btn-ghost" data-rb-double>
            ×2
          </button>
          <button type="button" class="c-btn c-btn-small c-btn-ghost" data-rb-repeat>
            前回と同じ
          </button>
        </span>
      </div>
      <button type="submit" class="c-btn c-btn-gold c-rb-spin" data-rb-submit disabled>
        {p.submitLabel}
      </button>
      <p class="c-rb-msg c-muted" data-rb-msg aria-live="polite"></p>
      </div>
    </form>
  );
}

const chipTone = (n: number) => (n >= 5000 ? 'black' : n >= 1000 ? 'gold' : n >= 500 ? 'purple' : n >= 100 ? 'blue' : n >= 50 ? 'green' : 'red');

/** 結果の明細（置いた所ごとに当たり・はずれ） */
export function RouletteStakes(p: { stakes: { on: RouletteBet; amount: number; payout?: number }[]; number: number | null; coin: Coin }) {
  if (!p.stakes.length) return null;
  return (
    <ul class="c-rb-result">
      {p.stakes.map((x) => {
        const pay = x.payout ?? (p.number === null ? 0 : x.amount * rouletteMultiplier(x.on, p.number));
        const win = p.number !== null && pay > 0;
        return (
          <li class={p.number === null ? '' : win ? 'win' : 'lose'}>
            <span>{rouletteBetLabel(x.on)}</span>
            <span class="c-chipmini">{fmt(x.amount)}</span>
            {p.number !== null && <b>{win ? `+${fmt(pay - x.amount)}` : `-${fmt(x.amount)}`}</b>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 回るルーレット。盤は勝った数字が上（▼）に来るように止まり、玉は逆に回って減速し、跳ねてそのポケットに落ちる。
 * 止まるまで（約 5 秒）当たりの数字・結果は見せない（CSS の遅れ）。回していないときはゆっくり回り続ける
 */
export function RouletteWheel(p: { number: number | null | undefined }) {
  const spun = p.number !== null && p.number !== undefined;
  return (
    <div class={`c-wheel2${spun ? ' spun' : ' idle'}`} aria-label={spun ? `出た数字 ${p.number}` : 'ルーレット'}>
      <div class={`c-wheel c-wheel2-disc${spun ? ` land-${p.number}` : ''}`} aria-hidden="true">
        {ROULETTE_ORDER.map((n, i) => (
          <span class={`pk pk-${i}`}>
            <b>{n}</b>
          </span>
        ))}
        <span class="c-wheel2-hub"></span>
      </div>
      <div class="c-wheel-pin" aria-hidden="true">
        ▼
      </div>
      {spun && (
        <div class="c-ball-track" aria-hidden="true">
          <span class="c-ball"></span>
        </div>
      )}
      {spun && <div class={`c-ball-num ${rouletteColor(p.number!)}`}>{p.number}</div>}
    </div>
  );
}
