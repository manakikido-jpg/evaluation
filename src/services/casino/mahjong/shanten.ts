import { KINDS, YAOCHU } from './tiles.js';

/**
 * 向聴数（あと何枚でテンパイか。テンパイ = 0、和了 = -1）。c: 手の中の牌の種類ごとの枚数、melds: 鳴いた面子の数。
 */

/**
 * 色ごと（萬子・筒子・索子・字牌 1 種ずつ）に「面子・搭子・雀頭」の取り方を全部出して（覚えておく）、組み合わせる。
 * 状態は 面子 × 100 + 搭子 × 10 + 雀頭 の数。
 */
const cache = new Map<string, number[]>();
/** 面子・搭子は 4 つまで数えれば足りる */
const enc = (m: number, t: number, p: number) => Math.min(m, 4) * 100 + Math.min(t, 4) * 10 + p;
const dm = (x: number) => Math.floor(x / 100);
const dt = (x: number) => Math.floor(x / 10) % 10;
const dp = (x: number) => x % 10;

/** 多い方だけ残す（同じ雀頭の数で、面子も搭子も少なくないもの） */
const pareto = (all: number[]) => all.filter((x) => !all.some((y) => y !== x && dp(y) === dp(x) && dm(y) >= dm(x) && dt(y) >= dt(x)));

function states(v: number[], honor: boolean): number[] {
  const key = (honor ? 'h' : 's') + v.join('');
  const hit = cache.get(key);
  if (hit) return hit;
  const i = v.findIndex((n) => n > 0);
  let out: number[];
  if (i < 0) out = [0];
  else {
    const set = new Set<number>();
    const take = (d: number[], m: number, t: number, p: number) => {
      for (let j = 0; j < d.length; j++) v[i + j]! -= d[j]!;
      for (const x of states(v, honor)) if (dp(x) + p <= 1) set.add(enc(dm(x) + m, dt(x) + t, dp(x) + p));
      for (let j = 0; j < d.length; j++) v[i + j]! += d[j]!;
    };
    if (v[i]! >= 3) take([3], 1, 0, 0);
    if (!honor && i <= 6 && v[i + 1]! > 0 && v[i + 2]! > 0) take([1, 1, 1], 1, 0, 0);
    if (v[i]! >= 2) {
      take([2], 0, 1, 0);
      take([2], 0, 0, 1);
    }
    if (!honor && i <= 7 && v[i + 1]! > 0) take([1, 1], 0, 1, 0);
    if (!honor && i <= 6 && v[i + 2]! > 0) take([1, 0, 1], 0, 1, 0);
    // 浮いた牌として残す
    take([1], 0, 0, 0);
    out = pareto([...set]);
  }
  if (cache.size > 200_000) cache.clear();
  cache.set(key, out);
  return out;
}

function combine(a: number[], b: number[]): number[] {
  const set = new Set<number>();
  for (const x of a) for (const y of b) if (dp(x) + dp(y) <= 1) set.add(enc(dm(x) + dm(y), dt(x) + dt(y), dp(x) + dp(y)));
  return pareto([...set]);
}

/** ふつうの形（4 面子 1 雀頭） */
export function shantenRegular(counts: readonly number[], melds = 0): number {
  let acc = [0];
  for (let s = 0; s < 3; s++) acc = combine(acc, states(counts.slice(s * 9, s * 9 + 9), false));
  for (let k = 27; k < KINDS; k++) if (counts[k]) acc = combine(acc, states([counts[k]!], true));
  const need = 4 - melds;
  let best = 8;
  for (const x of acc) {
    const m = Math.min(dm(x), need);
    const t = Math.min(dt(x), need - m);
    best = Math.min(best, 8 - 2 * (m + melds) - t - dp(x));
  }
  return best;
}

export function shantenChiitoi(c: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (const n of c) {
    if (n >= 1) kinds++;
    if (n >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function shantenKokushi(c: readonly number[]): number {
  let kinds = 0;
  let pair = false;
  for (const k of YAOCHU) {
    if (c[k]! >= 1) kinds++;
    if (c[k]! >= 2) pair = true;
  }
  return 13 - kinds - (pair ? 1 : 0);
}

export function shanten(c: readonly number[], melds = 0): number {
  const r = shantenRegular(c, melds);
  if (melds > 0) return r;
  return Math.min(r, shantenChiitoi(c), shantenKokushi(c));
}

/** テンパイの手（3n+1 枚）の待ち（種類） */
export function waitsOf(c: readonly number[], melds = 0): number[] {
  const x = [...c];
  const out: number[] = [];
  for (let k = 0; k < KINDS; k++) {
    if (x[k]! >= 4) continue;
    x[k]!++;
    if (shanten(x, melds) === -1) out.push(k);
    x[k]!--;
  }
  return out;
}
