import { shanten } from './shanten.js';
import { countsOf, isDragon, isHonor, isRedTile, isTerminal, KINDS, kindOf, numOf } from './tiles.js';

/**
 * 🤖 麻雀の BOT。牌効率（向聴数 → 受け入れ枚数）で切り、テンパイしたら門前ならリーチ。
 * リーチの相手がいて手が遠いときは、現物・字牌・筋を優先して降りる。鳴きは役牌と、役がある（タンヤオ・役牌を鳴いた）ときの前進だけ。
 */

export type Threat = { safe: Set<number> };
export type DiscardInput = {
  hand: number[];
  melds: number;
  /** 切ってよい牌（番号） */
  legal: number[];
  /** 切るとリーチできる牌 */
  riichiable: number[];
  /** 見えている牌（自分の手・河・鳴き・ドラ表示）の種類ごとの枚数 */
  visible: number[];
  /** リーチしている相手 */
  threats: Threat[];
  doraKinds: number[];
  yakuhai: number[];
};

/** 受け入れ枚数（向聴数が下がる牌の残り枚数） */
export function ukeire(c: number[], melds: number, sh: number, visible: readonly number[]): number {
  let n = 0;
  for (let x = 0; x < KINDS; x++) {
    if (c[x]! >= 4) continue;
    c[x]!++;
    if (shanten(c, melds) < sh) n += Math.max(0, 4 - visible[x]!);
    c[x]!--;
  }
  return n;
}

/** 相手 1 人に対する危なさ（0 = 現物） */
function danger(k: number, t: Threat, visible: readonly number[]): number {
  if (t.safe.has(k)) return 0;
  if (isHonor(k)) return visible[k]! >= 3 ? 1 : visible[k]! === 2 ? 2 : 4;
  const n = numOf(k);
  const lowSafe = n - 3 >= 1 && t.safe.has(k - 3);
  const highSafe = n + 3 <= 9 && t.safe.has(k + 3);
  if (n <= 3) return highSafe ? 2.5 : isTerminal(k) ? 5 : 6;
  if (n >= 7) return lowSafe ? 2.5 : isTerminal(k) ? 5 : 6;
  return lowSafe && highSafe ? 2.5 : lowSafe || highSafe ? 4.5 : 8;
}

export function chooseDiscard(p: DiscardInput): { tile: number; riichi: boolean } {
  const c = countsOf(p.hand);
  // 同じ種類なら、赤でない方を切る
  const byKind = new Map<number, number>();
  for (const t of p.legal) {
    const k = kindOf(t);
    const cur = byKind.get(k);
    if (cur === undefined || (isRedTile(cur) && !isRedTile(t))) byKind.set(k, t);
  }
  const riichiable = new Set(p.riichiable);
  const rows = [...byKind.entries()].map(([k, tile]) => {
    c[k]!--;
    const sh = shanten(c, p.melds);
    const uke = ukeire(c, p.melds, sh, p.visible);
    c[k]!++;
    const isolated = c[k] === 1 && (isHonor(k) || ![-2, -1, 1, 2].some((d) => k + d >= 0 && k + d < 27 && Math.floor((k + d) / 9) === Math.floor(k / 9) && c[k + d]! > 0));
    let pref = 0;
    if (isolated) pref += isHonor(k) ? (p.yakuhai.includes(k) ? 1.5 : 3) : isTerminal(k) ? 2 : 1;
    if (p.doraKinds.includes(k)) pref -= 2.5;
    if (isRedTile(tile)) pref -= 1.5;
    if (p.yakuhai.includes(k) && c[k]! >= 2) pref -= 3;
    const risk = p.threats.length ? Math.max(...p.threats.map((t) => danger(k, t, p.visible))) : 0;
    return { tile, k, sh, uke, pref, risk, riichi: riichiable.has(tile) };
  });
  const best = Math.min(...rows.map((r) => r.sh));
  const attack = (a: (typeof rows)[number], b: (typeof rows)[number]) => a.sh - b.sh || b.uke - a.uke || b.pref - a.pref;
  let pick: (typeof rows)[number];
  // 降りる: リーチがいて、手が遠い（2 向聴以上か、1 向聴で受け入れが少ない）
  if (p.threats.length && (best >= 2 || (best === 1 && Math.max(...rows.filter((r) => r.sh === 1).map((r) => r.uke)) < 8))) {
    pick = [...rows].sort((a, b) => a.risk - b.risk || attack(a, b))[0]!;
  } else {
    pick = [...rows].sort(attack)[0]!;
    // テンパイで危ない牌しか残らないときは、少しだけ押し引き
    if (p.threats.length && pick.risk >= 6 && best >= 1) {
      const safer = rows.filter((r) => r.sh <= best + 1 && r.risk < pick.risk - 2).sort((a, b) => a.risk - b.risk || attack(a, b))[0];
      if (safer) pick = safer;
    }
  }
  // リーチできるなら、受け入れの多いリーチの切り方
  const r = rows.filter((x) => x.riichi).sort((a, b) => b.uke - a.uke || b.pref - a.pref)[0];
  if (r && pick.sh === 0 && (!p.threats.length || r.risk <= 4.5 || r.uke >= 4)) return { tile: r.tile, riichi: true };
  return { tile: pick.tile, riichi: false };
}

export type CallOption = { type: 'ron' } | { type: 'pon' | 'chi' | 'minkan'; use: number[] };
export type CallInput = {
  hand: number[];
  melds: { type: string; kind: number }[];
  options: CallOption[];
  tile: number;
  yakuhai: number[];
  threatened: boolean;
};

/** 鳴いたあと切ってからの向聴数 */
function shantenAfterCall(hand: number[], use: number[], melds: number): number {
  const rest = hand.filter((t) => !use.includes(t));
  const c = countsOf(rest);
  let best = 9;
  for (let k = 0; k < KINDS; k++) {
    if (!c[k]) continue;
    c[k]!--;
    best = Math.min(best, shanten(c, melds + 1));
    c[k]!++;
  }
  return best;
}

export function chooseCall(p: CallInput): CallOption | { type: 'pass' } {
  if (p.options.some((o) => o.type === 'ron')) return { type: 'ron' };
  if (p.threatened) return { type: 'pass' };
  const k = kindOf(p.tile);
  const sh0 = shanten(countsOf(p.hand), p.melds.length);
  const yakuhaiMeld = p.melds.some((m) => m.type !== 'chi' && p.yakuhai.includes(m.kind));
  const allTiles = [...p.hand.map(kindOf), ...p.melds.map((m) => m.kind), k];
  const tanyao = allTiles.filter((x) => isHonor(x) || isTerminal(x)).length <= 1 && !isHonor(k) && !isTerminal(k) && p.melds.every((m) => m.type === 'chi' ? numOf(m.kind) >= 2 && numOf(m.kind) <= 6 : !isHonor(m.kind) && !isTerminal(m.kind));
  const pon = p.options.find((o) => o.type === 'pon') as { type: 'pon'; use: number[] } | undefined;
  if (pon && p.yakuhai.includes(k)) return pon;
  if (!yakuhaiMeld && !tanyao) return { type: 'pass' };
  let pick: CallOption | undefined;
  let best = sh0;
  for (const o of p.options) {
    if (o.type === 'ron' || o.type === 'minkan') continue;
    const sh = shantenAfterCall(p.hand, o.use, p.melds.length);
    if (sh < best) {
      best = sh;
      pick = o;
    }
  }
  // 遠いときに鳴くと守れなくなるので、2 向聴以内になるときだけ
  return pick && best <= 2 ? pick : { type: 'pass' };
}

export const isYakuhaiKind = (k: number, seatWind: number, roundWind: number) => isDragon(k) || k === seatWind || k === roundWind;
