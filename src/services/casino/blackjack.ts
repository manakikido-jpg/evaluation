import { rankOf, shuffledShoe, type Rng } from './cards.js';

/**
 * ブラックジャック（ディーラー相手）。6 組のトランプ・ディーラーは 17 以上で止まる（ソフト 17 も止まる）。
 * ブラックジャックは 1.5 倍（賭けの 2.5 倍が戻る）。最初の 2 枚のときだけダブルダウンできる（スプリットはなし）。
 */

export type BjResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'dealer_blackjack';
export type BjState = {
  deck: number[];
  player: number[];
  dealer: number[];
  doubled: boolean;
  phase: 'player' | 'done';
  result?: BjResult;
};

/** 手の合計（A は 11 にできるなら 11） */
export function handValue(cards: number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 1) aces++;
    total += r === 1 ? 1 : Math.min(r, 10);
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export const isBlackjack = (cards: number[]) => cards.length === 2 && handValue(cards).total === 21;

const draw = (s: BjState) => {
  const c = s.deck.pop();
  if (c === undefined) throw new Error('deck empty');
  return c;
};

export function bjStart(rng: Rng): BjState {
  const s: BjState = { deck: shuffledShoe(6, rng), player: [], dealer: [], doubled: false, phase: 'player' };
  s.player.push(draw(s));
  s.dealer.push(draw(s));
  s.player.push(draw(s));
  s.dealer.push(draw(s));
  const p = isBlackjack(s.player);
  const d = isBlackjack(s.dealer);
  if (p || d) return finish(s, p && d ? 'push' : p ? 'blackjack' : 'dealer_blackjack');
  return s;
}

function finish(s: BjState, result: BjResult): BjState {
  return { ...s, phase: 'done', result };
}

function dealerPlays(s: BjState): BjState {
  while (handValue(s.dealer).total < 17) s.dealer.push(draw(s));
  const p = handValue(s.player).total;
  const d = handValue(s.dealer).total;
  return finish(s, d > 21 || p > d ? 'win' : p === d ? 'push' : 'lose');
}

export function bjHit(state: BjState): BjState {
  if (state.phase !== 'player') return state;
  const s = { ...state, deck: [...state.deck], player: [...state.player], dealer: [...state.dealer] };
  s.player.push(draw(s));
  const t = handValue(s.player).total;
  if (t > 21) return finish(s, 'bust');
  if (t === 21) return dealerPlays(s);
  return s;
}

export function bjStand(state: BjState): BjState {
  if (state.phase !== 'player') return state;
  return dealerPlays({ ...state, deck: [...state.deck], player: [...state.player], dealer: [...state.dealer] });
}

export const canDouble = (s: BjState) => s.phase === 'player' && s.player.length === 2 && !s.doubled;

/** ダブルダウン（賭けを倍にして 1 枚だけ引く）。賭けの追加は呼ぶ側で */
export function bjDouble(state: BjState): BjState {
  if (!canDouble(state)) return state;
  const s = { ...state, doubled: true, deck: [...state.deck], player: [...state.player], dealer: [...state.dealer] };
  s.player.push(draw(s));
  if (handValue(s.player).total > 21) return finish(s, 'bust');
  return dealerPlays(s);
}

/** 戻る銭（bet はダブルダウンした分も入れた合計） */
export function bjPayout(result: BjResult, bet: number): number {
  if (result === 'blackjack') return Math.floor(bet * 2.5);
  if (result === 'win') return bet * 2;
  if (result === 'push') return bet;
  return 0;
}

/** 見せてよい分（遊んでいる間はディーラーの 2 枚目を伏せる。山札は見せない） */
export function bjView(s: BjState) {
  const hidden = s.phase === 'player';
  return {
    player: s.player,
    dealer: hidden ? [s.dealer[0]!] : s.dealer,
    dealerHidden: hidden,
    playerTotal: handValue(s.player),
    dealerTotal: hidden ? handValue([s.dealer[0]!]) : handValue(s.dealer),
    phase: s.phase,
    result: s.result,
    doubled: s.doubled,
    canDouble: canDouble(s),
  };
}
