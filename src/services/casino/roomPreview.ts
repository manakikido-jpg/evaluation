import type { CasinoConfig } from '../../config.js';
import { bjStart, bjHit, bjStand, bjDouble, bjView, bjPayout, canDouble } from './blackjack.js';
import { hlStart, hlGuess, hlCashout, hlPayout, hlWays } from './highlow.js';
import { parseStakes, rouletteSpin, rouletteMaxOf, stakePayout, stakesTotal } from './roulette.js';

export const ROOM_GAMES = ['roulette', 'blackjack', 'highlow'] as const;
export type RoomGame = typeof ROOM_GAMES[number];
/** 試遊だけの固定乱数。URLを読み直しても同じ回・同じ操作は同じ結果になる。 */
export function roomRng(round: number) {
  let seed = (round + 281026) >>> 0;
  return (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
}
export function roomPreview(q: URLSearchParams, cfg: CasinoConfig) {
  const game = q.get('game') ?? 'roulette';
  if (!ROOM_GAMES.includes(game as RoomGame)) throw Error('ゲームを選び直してください。');
  const integer = (key: string, fallback: number, max: number) => {
    const raw = q.get(key);
    if (raw === null) return fallback;
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1 || Number(raw) > max) throw Error('金額や回数を確認してください。');
    return Number(raw);
  };
  const round = integer('round', 1, 1000000), balance = Math.max(5000, cfg.minBet * 10);
  const max = Math.max(cfg.minBet, Math.min(cfg.maxBet, balance));
  const bet = integer('bet', Math.min(max, Math.max(cfg.minBet, 100)), max);
  if (bet < cfg.minBet) throw Error('金額が少なすぎます。');
  const raw = q.get('moves') ?? '';
  if (raw.length > 180) throw Error('新しい回を始めてください。');
  const moves = raw ? raw.split(',') : [];
  if (moves.length > 24 || moves.some(m => !/^(hit|stand|double|high|low|cashout)$/.test(m))) throw Error('操作を確認してください。');
  const base = { round, balance, bet, moves, canContinue: moves.length < 24 };
  const rng = roomRng(round);
  if (game === 'roulette') {
    if (moves.length) throw Error('操作を確認してください。');
    const spun = q.get('spin') === '1';
    const stakes = spun ? parseStakes(q.get('bets')) : [];
    if (!stakes || stakes.some(x => x.amount < cfg.minBet || x.amount > rouletteMaxOf(cfg)) || stakesTotal(stakes) > balance) throw Error('チップの置き方や合計を確認してください。');
    const number = spun ? rouletteSpin(rng) : null;
    const paid = number === null ? 0 : stakes.reduce((n, x) => n + stakePayout(x, number), 0);
    return { ...base, game: 'roulette' as const, number, stakes, total: stakesTotal(stakes), paid };
  }
  if (game === 'blackjack') {
    let s = bjStart(rng), total = bet;
    for (const move of moves) {
      if (s.phase !== 'player') throw Error('この回は終了しています。新しい回を始めてください。');
      if (move === 'hit') s = bjHit(s);
      else if (move === 'stand') s = bjStand(s);
      else if (move === 'double' && canDouble(s) && total * 2 <= balance && total * 2 <= cfg.maxBet) { s = bjDouble(s); total *= 2; }
      else throw Error('その操作は選べません。');
    }
    return { ...base, game: 'blackjack' as const, view: bjView(s), total, paid: s.phase === 'done' ? bjPayout(s.result!, total) : 0, doubleAllowed: canDouble(s) && total * 2 <= balance && total * 2 <= cfg.maxBet };
  }
  let s = hlStart(rng);
  for (const move of moves) {
    if (s.phase !== 'playing') throw Error('この回は終了しています。新しい回を始めてください。');
    if ((move === 'high' || move === 'low') && hlWays(s.current, move) > 0) s = hlGuess(s, move, rng);
    else if (move === 'cashout' && s.steps > 0) s = hlCashout(s);
    else throw Error('その操作は選べません。');
  }
  return { ...base, game: 'highlow' as const, state: s, total: bet, paid: hlPayout(s, bet) };
}
export type RoomPreview = ReturnType<typeof roomPreview>;
