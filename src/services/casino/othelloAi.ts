/**
 * ⚫ オセロの強い CPU（つよい）。盤を数字の並び（0 = 空き / 1 = 黒 / 2 = 白）で持って速く読む。
 * - 中盤: 先を何手も読む（読む局面の数に上限をつけ、上限までだんだん深くする）
 * - 終盤: 空きが ENDGAME_EMPTIES 以下なら、最後まで正しく読む（石の差がいちばん大きい手）
 * - 形の点: マスの強さ（角を取ったあとは、その隣は弱くない）・置ける数・まわりに空きがある石（少ないほどよい）・角・確定した辺の石
 */

export const ENDGAME_EMPTIES = 13;
/** 中盤に読む局面の数の上限（1 手でおよそ 0.2 秒。長くて 0.5 秒） */
export const MID_NODES = 40_000;
/** 終盤（最後まで読む）の局面の数の上限。こえたら中盤の読みにもどる */
export const END_NODES = 400_000;

const DXY = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
/** マスごと・向きごとに、たどるマスの並び（盤の外に出ない） */
const RAYS: number[][][] = Array.from({ length: 64 }, (_, i) =>
  DXY.map(([dx, dy]) => {
    const out: number[] = [];
    for (let x = (i % 8) + dx, y = Math.floor(i / 8) + dy; x >= 0 && x < 8 && y >= 0 && y < 8; x += dx, y += dy) out.push(y * 8 + x);
    return out;
  }),
);

const NEIGHBORS: number[][] = Array.from({ length: 64 }, (_, i) => RAYS[i]!.filter((r) => r.length).map((r) => r[0]!));

const W = [
  100, -20, 10, 5, 5, 10, -20, 100, -20, -50, -2, -2, -2, -2, -50, -20, 10, -2, -1, -1, -1, -1, -2, 10, 5, -2, -1, -1, -1, -1, -2, 5, 5, -2, -1, -1, -1, -1, -2, 5, 10, -2, -1, -1, -1,
  -1, -2, 10, -20, -50, -2, -2, -2, -2, -50, -20, 100, -20, 10, 5, 5, 10, -20, 100,
];
const CORNERS = [0, 7, 56, 63];
/** 角と、その隣（C と X）。角が埋まったら隣の減点はなし */
const CORNER_NEAR: [number, number[]][] = [
  [0, [1, 8, 9]],
  [7, [6, 15, 14]],
  [56, [57, 48, 49]],
  [63, [62, 55, 54]],
];
/** 辺（角から角へ） */
const EDGES = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [56, 57, 58, 59, 60, 61, 62, 63],
  [0, 8, 16, 24, 32, 40, 48, 56],
  [7, 15, 23, 31, 39, 47, 55, 63],
];

/** 置いたときに返る石の数（返したところは flips に入れる） */
function flipInto(b: Int8Array, me: number, i: number, flips: number[] | null): number {
  if (b[i] !== 0) return 0;
  const opp = 3 - me;
  let n = 0;
  for (const ray of RAYS[i]!) {
    let k = 0;
    while (k < ray.length && b[ray[k]!] === opp) k++;
    if (k > 0 && k < ray.length && b[ray[k]!] === me) {
      n += k;
      if (flips) for (let j = 0; j < k; j++) flips.push(ray[j]!);
    }
  }
  return n;
}

function moves(b: Int8Array, me: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) if (b[i] === 0 && flipInto(b, me, i, null) > 0) out.push(i);
  return out;
}

function countMoves(b: Int8Array, me: number): number {
  let n = 0;
  for (let i = 0; i < 64; i++) if (b[i] === 0 && flipInto(b, me, i, null) > 0) n++;
  return n;
}

/** 置く（返した石を返す。もどすときに使う） */
function play(b: Int8Array, me: number, i: number): number[] {
  const flips: number[] = [];
  flipInto(b, me, i, flips);
  b[i] = me;
  for (const f of flips) b[f] = me;
  return flips;
}

function undo(b: Int8Array, me: number, i: number, flips: number[]): void {
  b[i] = 0;
  const opp = 3 - me;
  for (const f of flips) b[f] = opp;
}

/** 辺で、角からつながっている自分の石（もう返されない） */
function edgeStable(b: Int8Array, me: number): number {
  let n = 0;
  for (const e of EDGES) {
    if (b[e[0]!] === me) for (let k = 1; k < 7 && b[e[k]!] === me; k++) n++;
    if (b[e[7]!] === me) for (let k = 6; k > 0 && b[e[k]!] === me; k--) n++;
  }
  return n;
}

/** 形の点（me から見て。大きいほどよい） */
function evaluate(b: Int8Array, me: number): number {
  const opp = 3 - me;
  let pos = 0;
  let frontMe = 0;
  let frontOpp = 0;
  let empties = 0;
  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if (c === 0) {
      empties++;
      continue;
    }
    const sign = c === me ? 1 : -1;
    pos += sign * W[i]!;
    for (const nb of NEIGHBORS[i]!)
      if (b[nb] === 0) {
        if (c === me) frontMe++;
        else frontOpp++;
        break;
      }
  }
  // 角が埋まっていれば、隣の減点を取り消す
  for (const [c, near] of CORNER_NEAR) {
    if (b[c] === 0) continue;
    for (const nb of near) if (b[nb] !== 0) pos -= (b[nb] === me ? 1 : -1) * W[nb]!;
  }
  let corners = 0;
  for (const c of CORNERS) corners += b[c] === me ? 1 : b[c] === opp ? -1 : 0;
  const mm = countMoves(b, me);
  const mo = countMoves(b, opp);
  const mob = (100 * (mm - mo)) / (mm + mo + 2);
  const front = (100 * (frontOpp - frontMe)) / (frontMe + frontOpp + 1);
  const stable = edgeStable(b, me) - edgeStable(b, opp);
  // 序盤は置ける数と形、終盤ほど石の確定を重く
  const late = empties < 20 ? 1 : 0;
  return pos + 2.5 * mob + 1.2 * front + 60 * corners + (12 + 10 * late) * stable;
}

function discDiff(b: Int8Array, me: number): number {
  let d = 0;
  let e = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] === me) d++;
    else if (b[i] === 0) e++;
    else d--;
  }
  // 空きは勝った側のもの
  return d > 0 ? d + e : d < 0 ? d - e : 0;
}

class OutOfNodes extends Error {}

/** 強そうな手から並べる（角 → マスの強さ → 相手が置ける数が少ない） */
function ordered(b: Int8Array, me: number, ms: number[], deep: boolean): number[] {
  if (!deep || ms.length <= 1) return [...ms].sort((x, y) => W[y]! - W[x]!);
  const opp = 3 - me;
  const scored = ms.map((m) => {
    const f = play(b, me, m);
    const s = W[m]! * 2 - countMoves(b, opp) * 12;
    undo(b, me, m, f);
    return { m, s };
  });
  return scored.sort((x, y) => y.s - x.s).map((x) => x.m);
}

type Search = { nodes: number; limit: number };

function negamax(b: Int8Array, me: number, depth: number, alpha: number, beta: number, exact: boolean, st: Search, passed: boolean): number {
  if (++st.nodes > st.limit) throw new OutOfNodes();
  const ms = moves(b, me);
  if (!ms.length) {
    if (passed) return discDiff(b, me) * 10_000;
    return -negamax(b, 3 - me, depth, -beta, -alpha, exact, st, true);
  }
  if (!exact && depth <= 0) return evaluate(b, me);
  let best = -Infinity;
  for (const m of ordered(b, me, ms, depth >= 3 || (exact && ms.length > 3))) {
    const f = play(b, me, m);
    const v = -negamax(b, 3 - me, depth - 1, -beta, -alpha, exact, st, false);
    undo(b, me, m, f);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** 根: 手ごとの点（いちばんよい手を先に読む） */
function rootScores(b: Int8Array, me: number, ms: number[], depth: number, exact: boolean, st: Search, first: number | undefined, margin: number): { m: number; v: number }[] {
  const order = ordered(b, me, ms, true);
  if (first !== undefined) order.sort((x, y) => (x === first ? -1 : y === first ? 1 : 0));
  const out: { m: number; v: number }[] = [];
  let alpha = -Infinity;
  for (const m of order) {
    const f = play(b, me, m);
    // いちばんよい手より margin 以上悪いかだけを見る（margin の中の手は正しい点になる）
    const v = -negamax(b, 3 - me, depth - 1, -Infinity, -(alpha - margin), exact, st, false);
    undo(b, me, m, f);
    out.push({ m, v });
    if (v > alpha) alpha = v;
  }
  return out;
}

const toBoard = (board: string) => Int8Array.from([...board].map((c) => (c === 'B' ? 1 : c === 'W' ? 2 : 0)));

/**
 * つよい CPU の手の候補と点（大きいほどよい）。中盤は読める深さまで、終盤は最後まで。
 * いちばんよい手から margin までの手は正しい点。それより悪い手は「margin 以上悪い」ことだけがわかる
 */
export function strongScores(board: string, color: 'B' | 'W', margin = 1): { m: number; v: number }[] {
  const b = toBoard(board);
  const me = color === 'B' ? 1 : 2;
  const ms = moves(b, me);
  if (ms.length <= 1) return ms.map((m) => ({ m, v: 0 }));
  const empties = b.reduce((n, c) => n + (c === 0 ? 1 : 0), 0);
  if (empties <= ENDGAME_EMPTIES) {
    try {
      return rootScores(b, me, ms, 64, true, { nodes: 0, limit: END_NODES }, undefined, margin);
    } catch (e) {
      if (!(e instanceof OutOfNodes)) throw e;
      // 読み切れなければ、中盤の読みで
    }
  }
  let done: { m: number; v: number }[] = ms.map((m) => ({ m, v: 0 }));
  const st: Search = { nodes: 0, limit: MID_NODES };
  for (let depth = 2; depth <= Math.min(empties, 20); depth++) {
    try {
      const best = done.reduce((a, x) => (x.v > a.v ? x : a), done[0]!).m;
      done = rootScores(b, me, ms, depth, false, st, depth > 2 ? best : undefined, margin);
    } catch (e) {
      if (!(e instanceof OutOfNodes)) throw e;
      break;
    }
  }
  return done;
}
