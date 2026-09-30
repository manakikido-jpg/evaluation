import type { Rng } from './cards.js';

/**
 * オセロ（8×8）。盤は 64 文字（. = 空き / B = 黒 / W = 白）、マスは y * 8 + x。黒が先。
 * 置けるところがなければパス。どちらも置けなくなったら終わり。
 */

export type Stone = 'B' | 'W';
export type OthelloLevel = 'easy' | 'normal' | 'hard';

export const OTHELLO_LEVELS: Record<OthelloLevel, { label: string; mult: number }> = {
  easy: { label: 'やさしい', mult: 1.2 },
  normal: { label: 'ふつう', mult: 1.6 },
  hard: { label: 'つよい', mult: 2.2 },
};

export const isOthelloLevel = (v: unknown): v is OthelloLevel => typeof v === 'string' && Object.hasOwn(OTHELLO_LEVELS, v);

export const other = (s: Stone): Stone => (s === 'B' ? 'W' : 'B');

export function initialBoard(): string {
  const b = Array<string>(64).fill('.');
  b[27] = 'W';
  b[28] = 'B';
  b[35] = 'B';
  b[36] = 'W';
  return b.join('');
}

const DIRS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/** そこに置いたときに返る石（置けなければ空） */
export function flipsFor(board: string, color: Stone, idx: number): number[] {
  if (idx < 0 || idx > 63 || board[idx] !== '.') return [];
  const x0 = idx % 8;
  const y0 = Math.floor(idx / 8);
  const opp = other(color);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const line: number[] = [];
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && board[y * 8 + x] === opp) {
      line.push(y * 8 + x);
      x += dx;
      y += dy;
    }
    if (line.length && x >= 0 && x < 8 && y >= 0 && y < 8 && board[y * 8 + x] === color) out.push(...line);
  }
  return out;
}

export function legalMoves(board: string, color: Stone): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) if (board[i] === '.' && flipsFor(board, color, i).length) out.push(i);
  return out;
}

export function applyMove(board: string, color: Stone, idx: number): string | undefined {
  const flips = flipsFor(board, color, idx);
  if (!flips.length) return undefined;
  const b = board.split('');
  b[idx] = color;
  for (const f of flips) b[f] = color;
  return b.join('');
}

export function countStones(board: string): { B: number; W: number } {
  let B = 0;
  let W = 0;
  for (const c of board) {
    if (c === 'B') B++;
    else if (c === 'W') W++;
  }
  return { B, W };
}

/** 置いたあと、次はだれの番か（パスも入れる）。null は終わり */
export function nextTurn(board: string, justMoved: Stone): Stone | null {
  const o = other(justMoved);
  if (legalMoves(board, o).length) return o;
  if (legalMoves(board, justMoved).length) return justMoved;
  return null;
}

/** 終わったときの勝ち（引き分けは null） */
export function winnerOf(board: string): Stone | null {
  const { B, W } = countStones(board);
  return B > W ? 'B' : W > B ? 'W' : null;
}

// ───────── CPU ─────────

/** マスの強さ（角が強く、角の隣は弱い） */
const WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120, -20, -40, -5, -5, -5, -5, -40, -20, 20, -5, 15, 3, 3, 15, -5, 20, 5, -5, 3, 3, 3, 3, -5, 5, 5, -5, 3, 3, 3, 3, -5, 5, 20, -5, 15, 3, 3, 15, -5,
  20, -20, -40, -5, -5, -5, -5, -40, -20, 120, -20, 20, 5, 5, 20, -20, 120,
];

function evaluate(board: string, me: Stone): number {
  const opp = other(me);
  let pos = 0;
  let empties = 0;
  for (let i = 0; i < 64; i++) {
    if (board[i] === me) pos += WEIGHTS[i]!;
    else if (board[i] === opp) pos -= WEIGHTS[i]!;
    else empties++;
  }
  const mob = legalMoves(board, me).length - legalMoves(board, opp).length;
  if (empties === 0) {
    const c = countStones(board);
    return (c[me] - c[opp]) * 1000;
  }
  return pos + mob * 8;
}

function search(board: string, toMove: Stone, me: Stone, depth: number, alpha: number, beta: number, exact: boolean): number {
  const moves = legalMoves(board, toMove);
  if (!moves.length) {
    if (!legalMoves(board, other(toMove)).length) {
      const c = countStones(board);
      return (c[me] - c[other(me)]) * 1000;
    }
    return search(board, other(toMove), me, depth, alpha, beta, exact);
  }
  if (depth <= 0 && !exact) return evaluate(board, me);
  const maximizing = toMove === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(applyMove(board, toMove, m)!, other(toMove), me, depth - 1, alpha, beta, exact);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (beta <= alpha) break;
  }
  return best;
}

/** CPU の手（置けなければ undefined）。同じくらいの手は乱数で選ぶ */
export function cpuMove(board: string, color: Stone, level: OthelloLevel, rng: Rng): number | undefined {
  const moves = legalMoves(board, color);
  if (!moves.length) return undefined;
  const pick = (list: number[]) => list[rng(list.length)]!;
  if (level === 'easy') {
    // 半分はでたらめ、半分はたくさん返せる手
    if (rng(2) === 0) return pick(moves);
    const most = Math.max(...moves.map((m) => flipsFor(board, color, m).length));
    return pick(moves.filter((m) => flipsFor(board, color, m).length === most));
  }
  const empties = [...board].filter((c) => c === '.').length;
  const exact = level === 'hard' && empties <= 8;
  const depth = level === 'hard' ? 4 : 1;
  const scored = moves.map((m) => ({ m, v: search(applyMove(board, color, m)!, other(color), color, depth - 1, -Infinity, Infinity, exact) }));
  const best = Math.max(...scored.map((s) => s.v));
  // ふつうは少し迷う（いちばんより少し下の手も選ぶ）
  const slack = level === 'normal' ? 12 : 0;
  return pick(scored.filter((s) => s.v >= best - slack).map((s) => s.m));
}

export type OthelloState = {
  board: string;
  /** 次に置く色（null は終わり） */
  turn: Stone | null;
  last?: number;
  /** CPU 相手のとき: 人の色・強さ */
  you?: Stone;
  level?: OthelloLevel;
};

/** 人が置く（CPU 相手なら、CPU の番が続くかぎり CPU も置く）。置けない手なら undefined */
export function othelloPlay(s: OthelloState, color: Stone, idx: number, rng?: Rng): OthelloState | undefined {
  if (s.turn !== color) return undefined;
  const board = applyMove(s.board, color, idx);
  if (!board) return undefined;
  let next: OthelloState = { ...s, board, turn: nextTurn(board, color), last: idx };
  if (s.level && s.you && rng) {
    while (next.turn && next.turn !== s.you) {
      const cpu = next.turn;
      const m = cpuMove(next.board, cpu, s.level, rng);
      if (m === undefined) break;
      const b = applyMove(next.board, cpu, m)!;
      next = { ...next, board: b, turn: nextTurn(b, cpu), last: m };
    }
  }
  return next;
}
