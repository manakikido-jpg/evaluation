import { chooseCall, chooseDiscard, isYakuhaiKind, type CallOption, type Threat } from '../mahjong/bot.js';
import { scoreWin, type Meld, type Score } from '../mahjong/score.js';
import { shanten, waitsOf } from '../mahjong/shanten.js';
import { countsOf, doraOf, EAST, isYaochu, KINDS, kindName, kindOf, sortTiles, TILES, WIND_NAME, YAOCHU } from '../mahjong/tiles.js';
import { nextBot } from './bots.js';
import { shuffle } from './partyBase.js';
import { fail, intOf, ok, paceMult, paceOf, str, type Credit, type Ctx, type Form, type Pace, type Step, type TableEngine, type Who } from './types.js';

/**
 * 🀄 咲楽ノ宮雀荘: 4 人打ちのリーチ麻雀（東風戦・半荘戦）。足りない席は 🤖 BOT（参加費は胴元が出す）。
 * 25,000 点持ち。赤ドラ 3 枚・喰いタンあり・後付けあり・頭ハネ（ロンは 1 人だけ）・箱下なし（0 点未満で終わり）。
 * 途中流局は九種九牌だけ。オーラスで親が和了・テンパイしてトップなら終わり（和了りやめ）。
 * 参加費は座るときに預かり、終わったら順位で配る（1 位 50%・2 位 30%・3 位 20%）。
 * 抜けた人・2 回続けて時間切れになった人は、BOT が代わりに打つ（「おまかせ」）。
 */

export const MJ_TURN_SECONDS = 15;
export const MJ_CALL_SECONDS = 8;
const RESULT_SECONDS = 20;
const BOT_MS = 900;
/** リーチ中の自動ツモ切り */
const RIICHI_AUTO_MS = 1100;
const LOBBY_MINUTES = 30;
const DONE_SECONDS = 180;
export const START_POINTS = 25_000;
export const MJ_SHARES = [50, 30, 20, 0];
export const MJ_LENGTHS = { tonpu: { label: '東風戦', winds: 1 }, hanchan: { label: '半荘戦', winds: 2 } } as const;
export type MjLength = keyof typeof MJ_LENGTHS;

/** じゃんたま風の便利ボタン: autoWin 自動和了・noCall 鳴きなし（ロンは聞く）・tsumogiri ツモ切り */
export type MjPrefs = { autoWin?: boolean; noCall?: boolean; tsumogiri?: boolean };
export const MJ_PREF_KEYS = ['autoWin', 'noCall', 'tsumogiri'] as const;
export type MjSeat = Who & { bot?: boolean; gone: boolean; timeouts: number; points: number; auto?: boolean; prefs?: MjPrefs };
export type RiverTile = { t: number; riichi?: boolean; called?: boolean; tsumogiri?: boolean };
export type MjCall = CallOption;
export type MjResponse = MjCall | { type: 'pass' };
export type MjResult = {
  kind: 'ron' | 'tsumo' | 'draw' | 'abort';
  label: string;
  winner?: number;
  from?: number | null;
  score?: Score;
  hand?: number[];
  melds?: Meld[];
  winTile?: number;
  tenpai?: boolean[];
  /** 流局で見せる手（テンパイの人だけ） */
  hands?: (number[] | null)[];
  deltas: number[];
  dora: number[];
  ura: number[];
  note?: string;
};

export type MjState = {
  seats: MjSeat[];
  entry: number;
  length: MjLength;
  pace?: Pace;
  phase: 'lobby' | 'playing' | 'result' | 'done' | 'closed';
  createdAt: number;
  deadline: number | null;
  /** 場風（0 東・1 南）・局（親の席）・本場・供託（リーチ棒の数） */
  wind: number;
  kyoku: number;
  honba: number;
  sticks: number;
  wall: number[];
  /** 王牌 14 枚: 0〜3 嶺上牌・4〜8 ドラ表示牌・9〜13 裏ドラ表示牌 */
  dead: number[];
  kans: number;
  hands: number[][];
  melds: Meld[][];
  rivers: RiverTile[][];
  riichi: boolean[];
  doubleRiichi: boolean[];
  ippatsu: boolean[];
  /** 見逃した（同巡内・リーチ後はずっと） */
  tempFuriten: boolean[];
  /** リーチを宣言した捨て牌が通るまで */
  riichiPending: number | null;
  /** 鳴きがまだない（ダブルリーチ・天和・地和・九種九牌） */
  clean: boolean;
  turn: number;
  step: 'turn' | 'call' | 'chankan';
  drawn: number | null;
  rinshan: boolean;
  /** 喰い替えで切れない種類 */
  kuikae: number[];
  last: { seat: number; t: number } | null;
  options: (MjCall[] | null)[];
  responses: (MjResponse | null)[];
  kakan: { seat: number; meld: number; t: number } | null;
  result: MjResult | null;
  renchan: boolean;
  ready: string[];
  order: string[];
  payouts: { id: string; name: string; amount: number; points: number }[];
  log: string[];
  /** 戦績（席ごと）・終わった局の数 */
  stats?: MjSeatStats[];
  handsPlayed?: number;
  /** 演出（画面が音と動きを出す。n は通し番号） */
  fx?: MjFx[];
  fxN?: number;
};

export type MjSeatStats = { wins: number; tsumo: number; dealins: number; riichi: number; best: { points: number; name: string } | null };
export type MjFxKind = 'discard' | 'riichi' | 'pon' | 'chi' | 'kan' | 'ron' | 'tsumo' | 'draw';
export type MjFx = { n: number; k: MjFxKind; seat: number; t?: number };

// ───────── 小さな道具 ─────────

const addLog = (s: MjState, line: string) => {
  s.log = [...s.log, line].slice(-14);
};
export const roundLabel = (s: Pick<MjState, 'wind' | 'kyoku' | 'honba'>) => `${WIND_NAME[s.wind]}${s.kyoku + 1}局${s.honba ? ` ${s.honba}本場` : ''}`;
export const seatWindOf = (s: Pick<MjState, 'kyoku'>, i: number) => EAST + ((i - s.kyoku + 4) % 4);
export const roundWindOf = (s: Pick<MjState, 'wind'>) => EAST + s.wind;
export const doraIndicators = (s: Pick<MjState, 'dead' | 'kans'>) => s.dead.slice(4, 5 + s.kans);
const uraIndicators = (s: MjState) => s.dead.slice(9, 10 + s.kans);
const menzen = (melds: Meld[]) => melds.every((m) => m.type === 'ankan');
const removeTiles = (hand: number[], ts: number[]) => hand.filter((t) => !ts.includes(t));
const humanActive = (x: MjSeat) => !x.bot && !x.gone;
/** BOT が代わりに打つ席（BOT・抜けた人・おまかせ中） */
const robot = (x: MjSeat) => Boolean(x.bot || x.gone || x.auto);
const name = (s: MjState, i: number) => s.seats[i]!.name;

function winScore(s: MjState, i: number, t: number, ron: boolean, chankan = false): Score | null {
  const hand = ron ? [...s.hands[i]!, t] : s.hands[i]!;
  if (shanten(countsOf(hand), s.melds[i]!.length) !== -1) return null;
  const last = s.wall.length === 0;
  const dealer = i === s.kyoku;
  return scoreWin({
    hand,
    melds: s.melds[i]!,
    winTile: t,
    ron,
    seatWind: seatWindOf(s, i),
    roundWind: roundWindOf(s),
    dealer,
    riichi: s.riichi[i],
    doubleRiichi: s.doubleRiichi[i],
    ippatsu: s.ippatsu[i],
    haitei: !ron && last && !s.rinshan,
    houtei: ron && last && !chankan,
    rinshan: !ron && s.rinshan,
    chankan,
    tenhou: !ron && dealer && s.clean && s.rivers.every((r) => r.length === 0),
    chiihou: !ron && !dealer && s.clean && s.rivers[i]!.length === 0,
    doraIndicators: doraIndicators(s),
    uraIndicators: uraIndicators(s),
  });
}

/** 待ち（13 枚のとき） */
export const waitsOfSeat = (s: MjState, i: number) => waitsOf(countsOf(s.hands[i]!), s.melds[i]!.length);

export function isFuriten(s: MjState, i: number): boolean {
  if (s.tempFuriten[i]) return true;
  const waits = waitsOfSeat(s, i);
  return s.rivers[i]!.some((r) => waits.includes(kindOf(r.t)));
}

/** いま切ってよい牌 */
export function legalDiscards(s: MjState, i: number): number[] {
  if (s.riichi[i]) return s.drawn !== null ? [s.drawn] : [s.hands[i]!.at(-1)!];
  const hand = s.hands[i]!;
  const ok = hand.filter((t) => !s.kuikae.includes(kindOf(t)));
  return ok.length ? ok : hand;
}

export function canRiichi(s: MjState, i: number): boolean {
  return !s.riichi[i] && s.drawn !== null && menzen(s.melds[i]!) && s.seats[i]!.points >= 1000 && s.wall.length >= 4;
}

/** 切るとテンパイ（リーチできる）牌 */
export function riichiDiscards(s: MjState, i: number): number[] {
  if (!canRiichi(s, i)) return [];
  const hand = s.hands[i]!;
  const c = countsOf(hand);
  const okKinds = new Set<number>();
  for (let k = 0; k < KINDS; k++) {
    if (!c[k]) continue;
    c[k]!--;
    if (shanten(c, s.melds[i]!.length) === 0) okKinds.add(k);
    c[k]!++;
  }
  return hand.filter((t) => okKinds.has(kindOf(t)));
}

export const canTsumo = (s: MjState, i: number) => s.step === 'turn' && s.turn === i && s.drawn !== null && winScore(s, i, s.drawn, false) !== null;

/** 暗槓・加槓できる種類 */
export function kanOptions(s: MjState, i: number): { type: 'ankan' | 'kakan'; k: number }[] {
  if (s.step !== 'turn' || s.turn !== i || s.drawn === null || s.riichi[i] || s.kans >= 4 || s.wall.length === 0) return [];
  const c = countsOf(s.hands[i]!);
  const out: { type: 'ankan' | 'kakan'; k: number }[] = [];
  for (let k = 0; k < KINDS; k++) if (c[k] === 4) out.push({ type: 'ankan', k });
  for (const m of s.melds[i]!) if (m.type === 'pon' && c[kindOf(m.tiles[0]!)]! >= 1) out.push({ type: 'kakan', k: kindOf(m.tiles[0]!) });
  return out;
}

export function canKyuushu(s: MjState, i: number): boolean {
  if (s.step !== 'turn' || s.turn !== i || !s.clean || s.rivers[i]!.length !== 0 || s.drawn === null) return false;
  const c = countsOf(s.hands[i]!);
  return YAOCHU.filter((k) => c[k]! > 0).length >= 9;
}

/** 見えている牌（その人から見て。待ちの残り枚数にも使う） */
export function visibleFor(s: MjState, i: number): number[] {
  const v = new Array<number>(KINDS).fill(0);
  const add = (t: number) => v[kindOf(t)]!++;
  s.hands[i]!.forEach(add);
  s.rivers.forEach((r) => r.forEach((x) => !x.called && add(x.t)));
  s.melds.forEach((ms) => ms.forEach((m) => m.tiles.forEach(add)));
  doraIndicators(s).forEach(add);
  return v;
}

const threatsFor = (s: MjState, i: number): Threat[] =>
  s.riichi.flatMap((r, j) => (r && j !== i ? [{ safe: new Set(s.rivers[j]!.map((x) => kindOf(x.t))) }] : []));

const yakuhaiFor = (s: MjState, i: number) => Array.from({ length: KINDS }, (_, k) => k).filter((k) => isYakuhaiKind(k, seatWindOf(s, i), roundWindOf(s)));

const statOf = (s: MjState, i: number): MjSeatStats => {
  s.stats ??= [0, 1, 2, 3].map(() => ({ wins: 0, tsumo: 0, dealins: 0, riichi: 0, best: null }));
  return s.stats[i]!;
};
function pushFx(s: MjState, k: MjFxKind, seat: number, t?: number): void {
  s.fxN = (s.fxN ?? 0) + 1;
  s.fx = [...(s.fx ?? []), { n: s.fxN, k, seat, ...(t !== undefined ? { t } : {}) }].slice(-8);
}

// ───────── 局の進み ─────────

function turnDeadline(s: MjState, now: number): number {
  const x = s.seats[s.turn]!;
  if (robot(x)) return now + BOT_MS;
  const win = canTsumo(s, s.turn);
  if (win && x.prefs?.autoWin) return now + RIICHI_AUTO_MS;
  if (!win && x.prefs?.tsumogiri && s.drawn !== null) return now + RIICHI_AUTO_MS;
  if (s.riichi[s.turn] && !win && kanOptions(s, s.turn).length === 0) return now + RIICHI_AUTO_MS;
  return now + MJ_TURN_SECONDS * 1000 * paceMult(s);
}

function startHand(s: MjState, ctx: Ctx): MjState {
  const all = shuffle(
    Array.from({ length: TILES }, (_, i) => i),
    ctx.rng,
  );
  s.dead = all.slice(0, 14);
  s.wall = all.slice(14);
  s.hands = [[], [], [], []];
  for (let n = 0; n < 13; n++) for (let j = 0; j < 4; j++) s.hands[(s.kyoku + j) % 4]!.push(s.wall.pop()!);
  s.hands = s.hands.map(sortTiles);
  s.melds = [[], [], [], []];
  s.rivers = [[], [], [], []];
  s.riichi = [false, false, false, false];
  s.doubleRiichi = [false, false, false, false];
  s.ippatsu = [false, false, false, false];
  s.tempFuriten = [false, false, false, false];
  s.riichiPending = null;
  s.clean = true;
  s.kans = 0;
  s.kuikae = [];
  s.last = null;
  s.options = [null, null, null, null];
  s.responses = [null, null, null, null];
  s.kakan = null;
  s.result = null;
  s.renchan = false;
  s.ready = [];
  s.phase = 'playing';
  addLog(s, `🀄 ${roundLabel(s)}（親: ${name(s, s.kyoku)}）`);
  return draw(s, s.kyoku, ctx);
}

function draw(s: MjState, i: number, ctx: Ctx): MjState {
  if (s.wall.length === 0) return exhaustiveDraw(s, ctx);
  s.turn = i;
  const t = s.wall.pop()!;
  s.hands[i] = sortTiles([...s.hands[i]!, t]);
  s.drawn = t;
  s.rinshan = false;
  s.kuikae = [];
  s.step = 'turn';
  s.deadline = turnDeadline(s, ctx.now);
  return s;
}

/** 嶺上牌を引く（槓のあと。王牌を 14 枚に保つため、山の最後を 1 枚減らす） */
function drawRinshan(s: MjState, i: number, ctx: Ctx): MjState {
  const t = s.dead[s.kans - 1]!;
  // 引いた嶺上牌の場所には、山の最後の牌が入る（その牌はもう使わない）
  s.dead[s.kans - 1] = s.wall.shift()!;
  s.turn = i;
  s.hands[i] = sortTiles([...s.hands[i]!, t]);
  s.drawn = t;
  s.rinshan = true;
  s.kuikae = [];
  s.step = 'turn';
  s.deadline = turnDeadline(s, ctx.now);
  return s;
}

function establishRiichi(s: MjState): void {
  const i = s.riichiPending;
  if (i === null) return;
  s.riichi[i] = true;
  s.seats[i]!.points -= 1000;
  s.sticks++;
  s.ippatsu[i] = true;
  s.doubleRiichi[i] = s.clean && s.rivers[i]!.length === 1;
  s.tempFuriten[i] = false;
  s.riichiPending = null;
  statOf(s, i).riichi++;
  addLog(s, `${name(s, i)}: ${s.doubleRiichi[i] ? 'ダブル' : ''}リーチ`);
}

function discard(s: MjState, i: number, tile: number, riichi: boolean, ctx: Ctx): Step<MjState> {
  if (!legalDiscards(s, i).includes(tile)) return fail('invalid');
  if (riichi && !riichiDiscards(s, i).includes(tile)) return fail('riichi');
  s.hands[i] = removeTiles(s.hands[i]!, [tile]);
  s.rivers[i]!.push({ t: tile, ...(tile === s.drawn ? { tsumogiri: true } : {}), ...(riichi ? { riichi: true } : {}) });
  if (riichi) s.riichiPending = i;
  s.ippatsu[i] = false;
  s.drawn = null;
  s.rinshan = false;
  s.kuikae = [];
  if (!s.riichi[i]) s.tempFuriten[i] = false;
  s.last = { seat: i, t: tile };
  pushFx(s, riichi ? 'riichi' : 'discard', i, tile);
  return ok(openCalls(s, i, tile, 'discard', ctx));
}

function callOptions(s: MjState, j: number, from: number, t: number, mode: 'discard' | 'chankan'): MjCall[] {
  const out: MjCall[] = [];
  if (winScore(s, j, t, true, mode === 'chankan') && !isFuriten(s, j)) out.push({ type: 'ron' });
  if (mode !== 'discard' || s.riichi[j] || s.wall.length === 0) return out;
  const k = kindOf(t);
  const hand = s.hands[j]!;
  const same = hand.filter((x) => kindOf(x) === k);
  if (same.length >= 2) out.push({ type: 'pon', use: same.slice(0, 2) });
  if (same.length >= 3 && s.kans < 4) out.push({ type: 'minkan', use: same.slice(0, 3) });
  if (j === (from + 1) % 4 && k < 27) {
    const n = k % 9;
    const pairs: [number, number][] = [];
    if (n >= 2) pairs.push([k - 2, k - 1]);
    if (n >= 1 && n <= 7) pairs.push([k - 1, k + 1]);
    if (n <= 6) pairs.push([k + 1, k + 2]);
    for (const [a, b] of pairs) {
      const ta = hand.find((x) => kindOf(x) === a);
      const tb = hand.find((x) => kindOf(x) === b);
      if (ta === undefined || tb === undefined) continue;
      // 鳴いたあと、喰い替えにならずに切れる牌があるか
      const rest = removeTiles(hand, [ta, tb]);
      const ban = kuikaeOf('chi', k, [a, b]);
      if (!rest.some((x) => !ban.includes(kindOf(x)))) continue;
      out.push({ type: 'chi', use: [ta, tb] });
    }
  }
  return out;
}

function kuikaeOf(type: 'chi' | 'pon', k: number, use: number[]): number[] {
  if (type === 'pon') return [k];
  const [a, b] = [Math.min(...use), Math.max(...use)];
  const ban = [k];
  if (k < a && (k % 9) + 3 <= 8) ban.push(k + 3);
  if (k > b && (k % 9) - 3 >= 0) ban.push(k - 3);
  return ban;
}

function botResponse(s: MjState, j: number, opts: MjCall[], t: number): MjResponse {
  return chooseCall({
    hand: s.hands[j]!,
    melds: s.melds[j]!.map((m) => ({ type: m.type, kind: kindOf(m.tiles[0]!) })),
    options: opts,
    tile: t,
    yakuhai: yakuhaiFor(s, j),
    threatened: threatsFor(s, j).length > 0,
  });
}

function openCalls(s: MjState, from: number, t: number, mode: 'discard' | 'chankan', ctx: Ctx): MjState {
  s.options = [0, 1, 2, 3].map((j) => {
    if (j === from) return null;
    const o = callOptions(s, j, from, t, mode);
    return o.length ? o : null;
  });
  s.responses = [null, null, null, null];
  if (!s.options.some(Boolean)) return afterCalls(s, mode, ctx);
  s.options.forEach((o, j) => {
    if (!o) return;
    if (robot(s.seats[j]!)) s.responses[j] = botResponse(s, j, o, t);
    else s.responses[j] = prefResponse(s.seats[j]!, o);
  });
  s.step = mode === 'discard' ? 'call' : 'chankan';
  if (s.options.every((o, j) => !o || s.responses[j])) return resolveCalls(s, ctx);
  s.deadline = ctx.now + MJ_CALL_SECONDS * 1000 * paceMult(s);
  return s;
}

/** 便利ボタンで決まる返事（自動和了ならロン・鳴きなしならスキップ。決まらなければ null で聞く） */
function prefResponse(x: MjSeat, o: MjCall[]): MjResponse | null {
  const ron = o.some((c) => c.type === 'ron');
  if (ron && x.prefs?.autoWin) return { type: 'ron' };
  if (!ron && x.prefs?.noCall) return { type: 'pass' };
  return null;
}

/** だれも鳴かなかったとき */
function afterCalls(s: MjState, mode: 'discard' | 'chankan', ctx: Ctx): MjState {
  s.options = [null, null, null, null];
  s.responses = [null, null, null, null];
  if (mode === 'chankan') return completeKakan(s, ctx);
  establishRiichi(s);
  return draw(s, (s.last!.seat + 1) % 4, ctx);
}

function resolveCalls(s: MjState, ctx: Ctx): MjState {
  const mode = s.step === 'chankan' ? 'chankan' : 'discard';
  const { seat: from, t } = s.last!;
  // ロンを見逃した人はフリテン
  s.options.forEach((o, j) => {
    if (o?.some((x) => x.type === 'ron') && s.responses[j]?.type !== 'ron') s.tempFuriten[j] = true;
  });
  const order = [1, 2, 3].map((d) => (from + d) % 4);
  const ronner = order.find((j) => s.responses[j]?.type === 'ron');
  if (ronner !== undefined) {
    s.options = [null, null, null, null];
    s.responses = [null, null, null, null];
    return win(s, ronner, from, t, ctx, mode === 'chankan');
  }
  const caller = order.find((j) => s.responses[j]?.type === 'pon' || s.responses[j]?.type === 'minkan') ?? order.find((j) => s.responses[j]?.type === 'chi');
  if (caller === undefined || mode === 'chankan') return afterCalls(s, mode, ctx);
  const resp = s.responses[caller] as Exclude<MjCall, { type: 'ron' }>;
  s.options = [null, null, null, null];
  s.responses = [null, null, null, null];
  establishRiichi(s);
  s.hands[caller] = removeTiles(s.hands[caller]!, resp.use);
  s.melds[caller]!.push({ type: resp.type, tiles: sortTiles([...resp.use, t]), from, called: t });
  s.rivers[from]!.at(-1)!.called = true;
  s.ippatsu = [false, false, false, false];
  s.clean = false;
  s.turn = caller;
  const label = { pon: 'ポン', chi: 'チー', minkan: 'カン' }[resp.type];
  pushFx(s, resp.type === 'minkan' ? 'kan' : resp.type, caller, t);
  addLog(s, `${name(s, caller)}: ${label} ${kindName(kindOf(t))}`);
  if (resp.type === 'minkan') {
    s.kans++;
    return drawRinshan(s, caller, ctx);
  }
  s.drawn = null;
  s.rinshan = false;
  s.kuikae = kuikaeOf(resp.type, kindOf(t), resp.use.map(kindOf));
  s.step = 'turn';
  s.deadline = turnDeadline(s, ctx.now);
  return s;
}

function ankan(s: MjState, i: number, k: number, ctx: Ctx): Step<MjState> {
  if (!kanOptions(s, i).some((o) => o.type === 'ankan' && o.k === k)) return fail('invalid');
  const four = s.hands[i]!.filter((t) => kindOf(t) === k);
  s.hands[i] = removeTiles(s.hands[i]!, four);
  s.melds[i]!.push({ type: 'ankan', tiles: four, from: null, called: null });
  s.kans++;
  s.ippatsu = [false, false, false, false];
  s.clean = false;
  addLog(s, `${name(s, i)}: 暗槓 ${kindName(k)}`);
  pushFx(s, 'kan', i);
  return ok(drawRinshan(s, i, ctx));
}

function kakan(s: MjState, i: number, k: number, ctx: Ctx): Step<MjState> {
  if (!kanOptions(s, i).some((o) => o.type === 'kakan' && o.k === k)) return fail('invalid');
  const meld = s.melds[i]!.findIndex((m) => m.type === 'pon' && kindOf(m.tiles[0]!) === k);
  const t = s.hands[i]!.find((x) => kindOf(x) === k)!;
  s.hands[i] = removeTiles(s.hands[i]!, [t]);
  s.drawn = null;
  s.kakan = { seat: i, meld, t };
  s.last = { seat: i, t };
  addLog(s, `${name(s, i)}: 加槓 ${kindName(k)}`);
  pushFx(s, 'kan', i, t);
  return ok(openCalls(s, i, t, 'chankan', ctx));
}

function completeKakan(s: MjState, ctx: Ctx): MjState {
  const kk = s.kakan!;
  const m = s.melds[kk.seat]![kk.meld]!;
  m.type = 'kakan';
  m.tiles = sortTiles([...m.tiles, kk.t]);
  s.kakan = null;
  s.kans++;
  s.ippatsu = [false, false, false, false];
  s.clean = false;
  return drawRinshan(s, kk.seat, ctx);
}

function win(s: MjState, w: number, from: number | null, t: number, ctx: Ctx, chankan = false): MjState {
  const ron = from !== null;
  const sc = winScore(s, w, t, ron, chankan)!;
  const deltas = [0, 0, 0, 0];
  const add = (j: number, d: number) => (deltas[j] = deltas[j]! + d);
  const h = s.honba;
  const dealer = s.kyoku;
  if (ron) {
    const pay = sc.ron + 300 * h;
    add(from, -pay);
    add(w, pay);
  } else {
    for (let j = 0; j < 4; j++) {
      if (j === w) continue;
      const pay = (w === dealer ? sc.tsumoOther : j === dealer ? sc.tsumoDealer : sc.tsumoOther) + 100 * h;
      add(j, -pay);
      add(w, pay);
    }
  }
  add(w, s.sticks * 1000);
  s.sticks = 0;
  deltas.forEach((d, j) => (s.seats[j]!.points += d));
  const label = roundLabel(s);
  s.result = {
    kind: ron ? 'ron' : 'tsumo',
    label,
    winner: w,
    from,
    score: sc,
    hand: ron ? [...s.hands[w]!, t] : s.hands[w]!,
    melds: s.melds[w]!,
    winTile: t,
    deltas,
    dora: doraIndicators(s),
    ura: s.riichi[w] ? uraIndicators(s) : [],
  };
  s.renchan = w === dealer;
  const st = statOf(s, w);
  st.wins++;
  if (!ron) st.tsumo++;
  else statOf(s, from).dealins++;
  if (!st.best || sc.total > st.best.points) st.best = { points: sc.total, name: sc.limit || sc.yaku.filter((y) => !y.name.includes('ドラ')).map((y) => y.name).slice(0, 2).join('・') };
  pushFx(s, ron ? 'ron' : 'tsumo', w, t);
  const pts = ron ? `${sc.ron.toLocaleString('ja-JP')}` : w === dealer ? `${sc.tsumoOther.toLocaleString('ja-JP')} オール` : `${sc.tsumoOther.toLocaleString('ja-JP')}・${sc.tsumoDealer.toLocaleString('ja-JP')}`;
  addLog(s, ron ? `${name(s, w)}: ロン（${name(s, from)} から）${pts}` : `${name(s, w)}: ツモ ${pts}`);
  return toResult(s, ctx);
}

function exhaustiveDraw(s: MjState, ctx: Ctx): MjState {
  const tenpai = [0, 1, 2, 3].map((j) => s.riichi[j] || shanten(countsOf(s.hands[j]!), s.melds[j]!.length) === 0);
  const n = tenpai.filter(Boolean).length;
  const deltas = [0, 0, 0, 0];
  if (n > 0 && n < 4) tenpai.forEach((tp, j) => (deltas[j] = tp ? 3000 / n : -3000 / (4 - n)));
  deltas.forEach((d, j) => (s.seats[j]!.points += d));
  s.result = {
    kind: 'draw',
    label: roundLabel(s),
    tenpai,
    hands: tenpai.map((tp, j) => (tp ? s.hands[j]! : null)),
    deltas,
    dora: doraIndicators(s),
    ura: [],
  };
  s.renchan = tenpai[s.kyoku]!;
  pushFx(s, 'draw', s.kyoku);
  addLog(s, `流局（テンパイ: ${tenpai.map((tp, j) => (tp ? name(s, j) : '')).filter(Boolean).join('・') || 'なし'}）`);
  return toResult(s, ctx);
}

function abortHand(s: MjState, i: number, ctx: Ctx): MjState {
  s.result = { kind: 'abort', label: roundLabel(s), deltas: [0, 0, 0, 0], dora: doraIndicators(s), ura: [], note: `${name(s, i)} の九種九牌`, hands: [0, 1, 2, 3].map((j) => (j === i ? s.hands[j]! : null)) };
  s.renchan = true;
  addLog(s, `途中流局（${name(s, i)} の九種九牌）`);
  return toResult(s, ctx);
}

function toResult(s: MjState, ctx: Ctx): MjState {
  s.handsPlayed = (s.handsPlayed ?? 0) + 1;
  s.phase = 'result';
  s.step = 'turn';
  s.drawn = null;
  s.ready = [];
  s.options = [null, null, null, null];
  s.responses = [null, null, null, null];
  s.deadline = ctx.now + RESULT_SECONDS * 1000 * Math.min(2, paceMult(s));
  // 人がいなければ待たない
  if (!s.seats.some(humanActive)) s.deadline = ctx.now + 2000;
  return s;
}

function nextHand(s: MjState, ctx: Ctx): Step<MjState> {
  const r = s.result!;
  if (s.seats.some((x) => x.points < 0)) return endGame(s, ctx, '0 点を下回った人が出たので終わりです');
  const lastWind = MJ_LENGTHS[s.length].winds - 1;
  const allLast = s.wind === lastWind && s.kyoku === 3;
  const dealerTop = s.seats.every((x, j) => j === s.kyoku || x.points < s.seats[s.kyoku]!.points);
  if (allLast && s.renchan && dealerTop) return endGame(s, ctx, '親がトップなので終わりです（和了りやめ）');
  if (s.renchan) s.honba++;
  else {
    s.honba = r.kind === 'draw' || r.kind === 'abort' ? s.honba + 1 : 0;
    s.kyoku++;
    if (s.kyoku === 4) {
      s.kyoku = 0;
      s.wind++;
    }
  }
  if (s.wind > lastWind) return endGame(s, ctx);
  return ok(startHand(s, ctx));
}

function endGame(s: MjState, ctx: Ctx, note?: string): Step<MjState> {
  const rank = [0, 1, 2, 3].sort((a, b) => s.seats[b]!.points - s.seats[a]!.points || a - b);
  // 残った供託はトップに
  s.seats[rank[0]!]!.points += s.sticks * 1000;
  s.sticks = 0;
  s.order = rank.map((j) => s.seats[j]!.id);
  const pot = s.entry * s.seats.length;
  const amounts = MJ_SHARES.map((p) => Math.floor((pot * p) / 100));
  amounts[0]! += pot - amounts.reduce((a, b) => a + b, 0);
  s.payouts = rank.map((j, n) => ({ id: s.seats[j]!.id, name: s.seats[j]!.name, amount: amounts[n] ?? 0, points: s.seats[j]!.points }));
  s.phase = 'done';
  s.deadline = ctx.now + DONE_SECONDS * 1000;
  addLog(s, `🏁 終局${note ? `（${note}）` : ''}: ${s.payouts.map((p, n) => `${n + 1}位 ${p.name}`).join('・')}`);
  const credits: Credit[] = s.payouts.filter((p) => p.amount > 0).map((p) => ({ memberId: p.id, amount: p.amount, reason: 'casino_win' as const }));
  // 戦績（人だけ。抜けた人も）
  const mahjong = rank.flatMap((j, n) => {
    const x = s.seats[j]!;
    if (x.bot) return [];
    const st = statOf(s, j);
    return [{ memberId: x.id, name: x.name, rank: n + 1, points: x.points, length: s.length, entry: s.entry, payout: amounts[n] ?? 0, hands: s.handsPlayed ?? 0, wins: st.wins, tsumo: st.tsumo, dealins: st.dealins, riichi: st.riichi, bestPoints: st.best?.points ?? 0, bestName: st.best?.name ?? null }];
  });
  return ok(s, { ...(credits.length ? { credits } : {}), ...(mahjong.length ? { mahjong } : {}) });
}

// ───────── BOT・おまかせ・時間切れ ─────────

function botTurn(s: MjState, i: number, ctx: Ctx): Step<MjState> {
  if (canTsumo(s, i)) return ok(win(s, i, null, s.drawn!, ctx));
  if (canKyuushu(s, i)) {
    const c = countsOf(s.hands[i]!);
    if (YAOCHU.filter((k) => c[k]! > 0).length >= 10) return ok(abortHand(s, i, ctx));
  }
  const honorKan = kanOptions(s, i).find((o) => o.type === 'ankan' && isYaochu(o.k) && threatsFor(s, i).length === 0);
  if (honorKan) return ankan(s, i, honorKan.k, ctx);
  const d = chooseDiscard({
    hand: s.hands[i]!,
    melds: s.melds[i]!.length,
    legal: legalDiscards(s, i),
    riichiable: riichiDiscards(s, i),
    visible: visibleFor(s, i),
    threats: threatsFor(s, i),
    doraKinds: doraIndicators(s).map((t) => doraOf(kindOf(t))),
    yakuhai: yakuhaiFor(s, i),
  });
  return discard(s, i, d.tile, d.riichi, ctx);
}

/** 時間切れの人の代わり（和了れるなら和了る・ほかはツモ切り） */
function timeoutTurn(s: MjState, i: number, ctx: Ctx): Step<MjState> {
  if (canTsumo(s, i)) return ok(win(s, i, null, s.drawn!, ctx));
  const legal = legalDiscards(s, i);
  const t = s.drawn !== null && legal.includes(s.drawn) ? s.drawn : legal.at(-1)!;
  return discard(s, i, t, false, ctx);
}

// ───────── 卓のエンジン ─────────

const seat = (w: Who, bot = false): MjSeat => ({ ...w, gone: false, timeouts: 0, points: START_POINTS, ...(bot ? { bot: true } : {}) });

function blank(host: Who, entry: number, length: MjLength, pace: Pace, now: number): MjState {
  return {
    seats: [seat(host)],
    entry,
    length,
    pace,
    phase: 'lobby',
    createdAt: now,
    deadline: now + LOBBY_MINUTES * 60_000,
    wind: 0,
    kyoku: 0,
    honba: 0,
    sticks: 0,
    wall: [],
    dead: [],
    kans: 0,
    hands: [],
    melds: [],
    rivers: [],
    riichi: [],
    doubleRiichi: [],
    ippatsu: [],
    tempFuriten: [],
    riichiPending: null,
    clean: true,
    turn: 0,
    step: 'turn',
    drawn: null,
    rinshan: false,
    kuikae: [],
    last: null,
    options: [],
    responses: [],
    kakan: null,
    result: null,
    renchan: false,
    ready: [],
    order: [],
    payouts: [],
    log: [],
  };
}

const entryDebit = (s: MjState, id: string, limited = true) => (s.entry > 0 ? { debits: [{ memberId: id, amount: s.entry, reason: 'casino_bet' as const, limited }] } : undefined);
const refundAll = (s: MjState) =>
  ok({ ...s, seats: [], phase: 'closed', deadline: null } as MjState, s.entry > 0 ? { credits: s.seats.map((x) => ({ memberId: x.id, amount: s.entry, reason: 'casino_refund' as const })) } : undefined);

/** 返事を待っている人がいるか */
const waitingOn = (s: MjState, i: number) =>
  s.phase === 'playing' && ((s.step === 'turn' && s.turn === i) || ((s.step === 'call' || s.step === 'chankan') && Boolean(s.options[i]) && !s.responses[i]));

export const mahjong: TableEngine<MjState> = {
  kind: 'mahjong',
  maxSeats: 4,
  create(host, f, ctx) {
    // 賭けない卓（立てる人が選ぶ・運営が賭けなしにしている）は参加費 0
    const free = !ctx.cfg.casino.mahjongBets || str(f, 'wager') === 'off';
    const entry = free ? 0 : intOf(f, 'entry');
    if (!Number.isInteger(entry) || entry < 0 || (entry > 0 && (entry < ctx.cfg.casino.minBet || entry > ctx.cfg.casino.maxBet))) return fail('bad_bet');
    const length: MjLength = str(f, 'length') === 'hanchan' ? 'hanchan' : 'tonpu';
    const s = blank(host, entry, length, paceOf(f), ctx.now);
    return ok(s, entryDebit(s, host.id));
  },
  join(s, who) {
    if (s.seats.some((x) => x.id === who.id)) return ok(s);
    if (s.phase !== 'lobby') return fail('started');
    if (s.seats.length >= 4) return fail('full');
    return ok({ ...s, seats: [...s.seats, seat(who)] }, entryDebit(s, who.id));
  },
  leave(state, id, ctx) {
    const i = state.seats.findIndex((x) => x.id === id);
    if (i < 0) return fail('not_seated');
    if (state.phase === 'lobby') {
      const seats = state.seats.filter((x) => x.id !== id);
      if (i === 0 || !seats.some((x) => !x.bot)) return refundAll(state);
      return ok({ ...state, seats }, state.entry > 0 ? { credits: [{ memberId: id, amount: state.entry, reason: 'casino_refund' }] } : undefined);
    }
    const s = structuredClone(state);
    s.seats[i]!.gone = true;
    // 人がだれもいなくなったら、いまの点数で終わり
    if ((s.phase === 'playing' || s.phase === 'result') && !s.seats.some(humanActive)) return endGame(s, ctx, '人がいなくなったので終わりです');
    if (s.phase === 'playing' || s.phase === 'result') addLog(s, `${s.seats[i]!.name} が抜けました（BOT が代わりに打ちます）`);
    if (waitingOn(s, i)) s.deadline = ctx.now;
    return ok(s);
  },
  act(state, id, f, ctx) {
    const i = state.seats.findIndex((x) => x.id === id);
    if (i < 0) return fail('not_seated');
    const a = str(f, 'action');
    if (state.phase === 'lobby') {
      if (i !== 0) return fail('invalid');
      if (a === 'add_bot') {
        if (state.seats.length >= 4) return fail('full');
        const b = nextBot(state.seats.map((x) => x.id));
        return ok({ ...state, seats: [...state.seats, seat(b, true)] }, entryDebit(state, b.id, false));
      }
      if (a === 'remove_bot') {
        const b = state.seats.find((x) => x.bot && x.id === str(f, 'bot')) ?? [...state.seats].reverse().find((x) => x.bot);
        if (!b) return fail('invalid');
        return ok({ ...state, seats: state.seats.filter((x) => x !== b) }, state.entry > 0 ? { credits: [{ memberId: b.id, amount: state.entry, reason: 'casino_refund' }] } : undefined);
      }
      if (a === 'start') {
        // 足りない席は BOT で埋める
        const s = structuredClone(state);
        const debits = [];
        while (s.seats.length < 4) {
          const b = nextBot(s.seats.map((x) => x.id));
          s.seats.push(seat(b, true));
          if (s.entry > 0) debits.push({ memberId: b.id, amount: s.entry, reason: 'casino_bet' as const, limited: false });
        }
        s.seats = shuffle(s.seats, ctx.rng);
        s.seats.forEach((x) => (x.points = START_POINTS));
        addLog(s, `${MJ_LENGTHS[s.length].label}・起家は ${s.seats[0]!.name}`);
        return ok(startHand(s, ctx), debits.length ? { debits } : undefined);
      }
      return fail('invalid');
    }
    const s = structuredClone(state);
    const me = s.seats[i]!;
    // 便利ボタン（いつでも切り替えられる）
    if (a === 'pref') {
      const key = str(f, 'key') as (typeof MJ_PREF_KEYS)[number];
      if (!(MJ_PREF_KEYS as readonly string[]).includes(key)) return fail('invalid');
      me.prefs = { ...me.prefs, [key]: str(f, 'on') === '1' };
      if (s.phase === 'playing' && waitingOn(s, i)) {
        if (s.step === 'turn') s.deadline = turnDeadline(s, ctx.now);
        else {
          const r = prefResponse(me, s.options[i]!);
          if (r) {
            s.responses[i] = r;
            if (s.options.every((o, j) => !o || s.responses[j])) return ok(resolveCalls(s, ctx));
          }
        }
      }
      return ok(s);
    }
    if (a === 'resume') {
      me.auto = false;
      me.timeouts = 0;
      if (waitingOn(s, i) && s.step === 'turn') s.deadline = turnDeadline(s, ctx.now);
      return ok(s);
    }
    if (a === 'next') {
      if (s.phase !== 'result') return ok(s);
      if (!s.ready.includes(id)) s.ready.push(id);
      if (s.seats.filter(humanActive).every((x) => s.ready.includes(x.id))) return nextHand(s, ctx);
      return ok(s);
    }
    if (s.phase !== 'playing') return fail('invalid');
    if (!waitingOn(s, i)) return fail('not_your_turn');
    me.timeouts = 0;
    me.auto = false;
    if (s.step === 'turn') {
      if (a === 'discard') return discard(s, i, intOf(f, 'tile'), str(f, 'riichi') === '1', ctx);
      if (a === 'tsumo') return canTsumo(s, i) ? ok(win(s, i, null, s.drawn!, ctx)) : fail('invalid');
      if (a === 'ankan') return ankan(s, i, intOf(f, 'k'), ctx);
      if (a === 'kakan') return kakan(s, i, intOf(f, 'k'), ctx);
      if (a === 'kyuushu') return canKyuushu(s, i) ? ok(abortHand(s, i, ctx)) : fail('invalid');
      return fail('invalid');
    }
    const opts = s.options[i]!;
    if (a === 'pass') s.responses[i] = { type: 'pass' };
    else if (a === 'ron' && opts.some((o) => o.type === 'ron')) s.responses[i] = { type: 'ron' };
    else if (a === 'pon' || a === 'chi' || a === 'minkan') {
      const use = (str(f, 'use') ?? '').split(',').map(Number);
      const o = opts.find((x) => x.type === a && (a !== 'chi' || (x as { use: number[] }).use.join(',') === use.join(',')));
      if (!o) return fail('invalid');
      s.responses[i] = o;
    } else return fail('invalid');
    if (s.options.every((o, j) => !o || s.responses[j])) return ok(resolveCalls(s, ctx));
    return ok(s);
  },
  tick(state, ctx) {
    if (state.deadline === null || state.deadline > ctx.now) return null;
    if (state.phase === 'lobby') return refundAll(state);
    if (state.phase === 'done') return ok({ ...state, phase: 'closed', deadline: null });
    const s = structuredClone(state);
    if (s.phase === 'result') return nextHand(s, ctx);
    if (s.phase !== 'playing') return null;
    if (s.step === 'turn') {
      const x = s.seats[s.turn]!;
      if (robot(x)) return botTurn(s, s.turn, ctx);
      // 便利ボタン（自動和了・ツモ切り）
      if (x.prefs?.autoWin && canTsumo(s, s.turn)) return ok(win(s, s.turn, null, s.drawn!, ctx));
      if (x.prefs?.tsumogiri && s.drawn !== null && !canTsumo(s, s.turn) && legalDiscards(s, s.turn).includes(s.drawn)) return discard(s, s.turn, s.drawn, false, ctx);
      // リーチ中のツモ切りは時間切れに数えない
      if (!(s.riichi[s.turn] && !canTsumo(s, s.turn))) {
        x.timeouts++;
        if (x.timeouts >= 2) {
          x.auto = true;
          addLog(s, `${x.name}: 時間切れが続いたので、おまかせにしました`);
        }
      }
      return timeoutTurn(s, s.turn, ctx);
    }
    s.options.forEach((o, j) => {
      if (!o || s.responses[j]) return;
      const x = s.seats[j]!;
      if (robot(x)) s.responses[j] = botResponse(s, j, o, s.last!.t);
      else s.responses[j] = o.some((c) => c.type === 'ron') ? { type: 'ron' } : { type: 'pass' };
    });
    return ok(resolveCalls(s, ctx));
  },
  due: (s) => s.deadline,
  seats: (s) => (s.phase === 'lobby' || s.phase === 'playing' || s.phase === 'result' ? s.seats.filter((x) => !x.gone && !x.bot).map((x) => x.id) : []),
  closed: (s) => s.phase === 'closed',
};

/** 画面に出す: その人の席（いなければ -1） */
export const seatOf = (s: MjState, id: string) => s.seats.findIndex((x) => x.id === id);
