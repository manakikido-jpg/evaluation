import type { Rng } from './cards.js';
import { PAYLINES, type SlotSetting } from './slots.js';

/**
 * 🦊 鬼斬り白狐（AT 機）。1 ゲームの賭けは島ごとに決まっている（AT のときだけ多く賭けられないように）。
 * - 通常時: レア役（チェリー・スイカ・チャンス目・白狐目）で AT を抽選。当たると前兆（数ゲーム）を経て AT「白狐ラッシュ」へ。
 *   天井は通常時 700 ゲーム（天国モードなら 100 ゲーム）で AT 確定
 * - AT: 1 セット 40 ゲーム。押し順ベルはナビどおりに押すと 3 倍（通常時は押し順が分からないので 6 回に 1 回）。
 *   レア役で上乗せ、チャンス目で特化ゾーン「白狐乱舞」（2 ゲーム上乗せし続ける）。セットの終わりに「鬼との継続バトル」
 * - 台の状態（回転数・前兆・AT の残り）は台に残る（人が替わっても続く）
 * 払い戻し率は設定 1 でおよそ 95%・設定 6 でおよそ 103%（AT 中にナビどおり押したとき。テストのシミュレーションで確かめる）
 */

export type AtSym = 'w7' | 'r7' | 'bar' | 'bell' | 'replay' | 'cherry' | 'suika';
export const AT_SYMBOLS: Record<AtSym, { name: string; emoji: string }> = {
  w7: { name: '白狐7', emoji: '🦊' },
  r7: { name: '鬼7', emoji: '👹' },
  bar: { name: 'BAR', emoji: '▬' },
  bell: { name: 'ベル', emoji: '🔔' },
  replay: { name: 'リプレイ', emoji: '🔁' },
  cherry: { name: 'チェリー', emoji: '🍒' },
  suika: { name: 'スイカ', emoji: '🍉' },
};
export const AT_REEL_LEN = 21;
/** リールの並び（上から下へ） */
export const AT_REELS: AtSym[][] = [
  ['w7', 'bell', 'replay', 'cherry', 'bell', 'suika', 'replay', 'bell', 'bar', 'replay', 'bell', 'cherry', 'replay', 'bell', 'suika', 'r7', 'replay', 'bell', 'bar', 'replay', 'bell'],
  ['w7', 'replay', 'bell', 'suika', 'replay', 'bell', 'bar', 'replay', 'bell', 'r7', 'replay', 'bell', 'suika', 'replay', 'bell', 'replay', 'bar', 'bell', 'replay', 'r7', 'bell'],
  ['w7', 'bell', 'replay', 'suika', 'bell', 'replay', 'bar', 'bell', 'replay', 'r7', 'bell', 'replay', 'suika', 'bell', 'replay', 'bar', 'bell', 'replay', 'r7', 'bell', 'replay'],
];

/** 役（oshijun = 押し順ベル・bell = 共通ベル・wcherry 弱チェリー・scherry 強チェリー・chance チャンス目・byakko 白狐目） */
export type AtRole = 'oshijun' | 'bell' | 'replay' | 'wcherry' | 'scherry' | 'suika' | 'chance' | 'byakko' | 'none';
const W = 65536;
export const AT_ROLES: Record<Exclude<AtRole, 'none'>, { weight: number; mult: number; name: string }> = {
  oshijun: { weight: 26214, mult: 3, name: '押し順ベル' },
  bell: { weight: 3277, mult: 3, name: '共通ベル' },
  replay: { weight: 8978, mult: 1, name: 'リプレイ' },
  wcherry: { weight: 1092, mult: 2, name: '弱チェリー' },
  scherry: { weight: 328, mult: 2, name: '強チェリー' },
  suika: { weight: 819, mult: 5, name: 'スイカ' },
  chance: { weight: 437, mult: 0, name: 'チャンス目' },
  byakko: { weight: 8, mult: 1, name: '白狐目' },
};
const ROLE_KEYS = Object.keys(AT_ROLES) as Exclude<AtRole, 'none'>[];

export function drawAtRole(rng: Rng): AtRole {
  let x = rng(W);
  for (const k of ROLE_KEYS) {
    const w = AT_ROLES[k].weight;
    if (x < w) return k;
    x -= w;
  }
  return 'none';
}

// ───────── 見た目（止まる目） ─────────

const symAt = (reel: number, i: number) => AT_REELS[reel]![((i % AT_REEL_LEN) + AT_REEL_LEN) % AT_REEL_LEN]!;
/** 3 × 3（リールごとに上・中・下） */
export const atGrid = (stops: number[]) => stops.map((s, r) => [symAt(r, s - 1), symAt(r, s), symAt(r, s + 1)]);

/** ライン（SAKURA 777 と同じ 5 本）: 上段・中段・下段・右下がり・右上がり。rows はリールごとの段（0 上・1 中・2 下） */
export const AT_PAYLINES = PAYLINES;

/** 見た目の役: ベル・リプレイ・スイカ・チャンス目（BAR・リプレイ・BAR）・白狐目（白狐 7 そろい）はどれか 1 本のラインに。チェリーは左リール（中段なら強） */
type Look = Exclude<AtRole, 'oshijun' | 'none'>;
type LineLook = 'bell' | 'replay' | 'suika' | 'chance' | 'byakko';
const LINE_LOOKS: Record<LineLook, (l: AtSym[]) => boolean> = {
  bell: (l) => l.every((x) => x === 'bell'),
  replay: (l) => l.every((x) => x === 'replay'),
  suika: (l) => l.every((x) => x === 'suika'),
  chance: (l) => l[0] === 'bar' && l[1] === 'replay' && l[2] === 'bar',
  byakko: (l) => l.every((x) => x === 'w7'),
};
const LINE_KEYS = Object.keys(LINE_LOOKS) as LineLook[];
/** その目で見えている役（ラインの役はラインごと・チェリーは 1 つ） */
function looksOf(g: AtSym[][]): { look: Look; line: number }[] {
  const out: { look: Look; line: number }[] = [];
  PAYLINES.forEach((l, i) => {
    const syms = l.rows.map((row, r) => g[r]![row]!);
    for (const k of LINE_KEYS) if (LINE_LOOKS[k](syms)) out.push({ look: k, line: i });
  });
  if (g[0]![1] === 'cherry') out.push({ look: 'scherry', line: -1 });
  else if (g[0]![0] === 'cherry' || g[0]![2] === 'cherry') out.push({ look: 'wcherry', line: -1 });
  return out;
}
/** 止まった目の見た目の役（1 つだけ見えているとき。なければ none） */
export function atLookOf(stops: number[]): Look | 'none' {
  const hit = looksOf(atGrid(stops));
  return hit.length === 1 ? hit[0]!.look : 'none';
}
/** そろったライン（0〜4。チェリー・はずれは -1） */
export function atWinLine(stops: number[]): number {
  const hit = looksOf(atGrid(stops));
  return hit.length === 1 ? hit[0]!.line : -1;
}

/** 役ごとの止まり方（はじめに 1 回だけ全部しらべる。その役だけに見えるもの） */
const CANDS = (() => {
  const out = new Map<Look | 'none', number[][]>();
  for (let a = 0; a < AT_REEL_LEN; a++)
    for (let b = 0; b < AT_REEL_LEN; b++)
      for (let c = 0; c < AT_REEL_LEN; c++) {
        const st = [a, b, c];
        const hit = looksOf(atGrid(st));
        if (hit.length > 1) continue;
        const k = hit[0]?.look ?? 'none';
        out.set(k, [...(out.get(k) ?? []), st]);
      }
  return out;
})();

/** 止まったままのときの目（どの役にも見えない） */
export const AT_IDLE_STOPS = [...CANDS.get('none')![Math.floor(CANDS.get('none')!.length / 2)]!];

/** その見た目で止まる目（ベルがそろわない押し順ベルは none） */
export function atStopsFor(look: Look | 'none', rng: Rng): number[] {
  const list = CANDS.get(look)!;
  return [...list[rng(list.length)]!];
}

// ───────── 台の状態 ─────────

/** 通常時の天井（AT 確定）・天国モードの天井 */
export const AT_CEILING = 700;
export const AT_HEAVEN_CEILING = 100;
/** AT 1 セットのゲーム数 */
export const AT_SET_GAMES = 28;
/** 継続率（%）と、AT に入ったときの出やすさ（%） */
export const AT_RATES: { rate: number; odds: number }[] = [
  { rate: 50, odds: 55 },
  { rate: 66, odds: 28 },
  { rate: 80, odds: 13 },
  { rate: 90, odds: 4 },
];
/** AT が終わったあと天国モードになる割合（%） */
export const AT_HEAVEN_PERCENT = 20;

/** 設定ごとの AT 抽選の重み（設定 1 を 1 として） */
export const AT_SETTING_BOOST: Record<SlotSetting, number> = { 1: 1, 2: 1.06, 3: 1.12, 4: 1.21, 5: 1.32, 6: 1.48 };
/** 設定ごとの払い戻し率の目安（シミュレーションで出したもの。運営の画面に出す） */
export const AT_RTP_APPROX: Record<SlotSetting, number> = { 1: 0.954, 2: 0.964, 3: 0.972, 4: 0.988, 5: 1.004, 6: 1.018 };
/**
 * 🔥 チャンスゾーン「鬼退治チャンス」: 通常時のレア役で入る（設定 1 の %。設定が高いほど入りやすい）。
 * 入ったときに成功（AT）かを決め、CZ 中のレア役で引き直せる。最後のゲームで結果が出る
 */
export const AT_CZ_GAMES = 10;
export const AT_CZ_PERCENT: Partial<Record<AtRole, number>> = { wcherry: 8, suika: 10, scherry: 40, chance: 40 };
/** レア役からいきなり AT（設定 1 の %） */
export const AT_DIRECT_PERCENT: Partial<Record<AtRole, number>> = { scherry: 5, chance: 5 };
/** CZ の成功率（入ったとき）と、CZ 中のレア役で引き直すときの成功率（%） */
export const AT_CZ_WIN = 33;
export const AT_CZ_RARE_WIN: Partial<Record<AtRole, number>> = { wcherry: 25, suika: 35, scherry: 70, chance: 70, byakko: 100 };

export type AtPhase = 'normal' | 'zenchou' | 'at' | 'cz';
export type AtRun = {
  /** このセットの残りゲーム・何セット目・継続率・特化ゾーンの残り */
  left: number;
  set: number;
  rate: number;
  tokka: number;
  /** AT で回したゲーム数・上乗せしたゲーム数・払い戻し（銭） */
  games: number;
  added: number;
  won: number;
};
export type AtMachine = {
  /** 通常時のゲーム数（AT が終わってから） */
  games: number;
  heaven: boolean;
  phase: AtPhase;
  /** 前兆の残りゲーム・決まった継続率・天井で入ったか */
  zenchou: number;
  nextRate: number;
  tenjou: boolean;
  at: AtRun | null;
  /** チャンスゾーン（残りゲーム・成功するか。成功は画面には出さない） */
  cz?: { left: number; win: boolean } | null;
};
export const newAtMachine = (): AtMachine => ({ games: 0, heaven: false, phase: 'normal', zenchou: 0, nextRate: 0, tenjou: false, at: null, cz: null });

/** 画面に出す出来事 */
export type AtEvent =
  | { k: 'cz_start'; why: AtRole }
  | { k: 'cz_end'; win: boolean }
  | { k: 'at_start'; rate: number; tenjou: boolean }
  | { k: 'add'; games: number; why: AtRole }
  | { k: 'tokka_start' }
  | { k: 'tokka_end'; added: number }
  | { k: 'battle'; win: boolean; set: number }
  | { k: 'at_end'; games: number; won: number; sets: number };

/** 1 ゲームの結果（台の状態はこのあとのもの） */
export type AtStep = {
  role: AtRole;
  /** このゲームのときの状態（at = AT 中・tokka = 特化ゾーン中・cz = チャンスゾーン中） */
  during: 'normal' | 'zenchou' | 'at' | 'tokka' | 'cz';
  /** AT 中の押し順ベルのナビ（押す順のリール。[1, 2, 0] = 中 → 右 → 左） */
  navi: number[] | null;
  events: AtEvent[];
  /** 演出の強さ（0 なし・1 弱い・2 強い・3 激アツ。前兆中ほど出やすい） */
  hint: number;
};

const NAVIS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
export const randomOrder = (rng: Rng) => [...NAVIS[rng(6)]!];
export const isOrder = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && [0, 1, 2].every((i) => v.includes(i));

function drawRate(rng: Rng, atLeast = 0): number {
  let x = rng(100);
  for (const r of AT_RATES) {
    if (x < r.odds) return Math.max(r.rate, atLeast);
    x -= r.odds;
  }
  return Math.max(50, atLeast);
}

/** 上乗せのゲーム数（AT 中のレア役） */
function addFor(role: AtRole, rng: Rng): number {
  if (role === 'wcherry') return 5;
  if (role === 'scherry') return 10;
  if (role === 'suika') return rng(100) < 30 ? 10 : 0;
  if (role === 'byakko') return 100;
  return 0;
}

/** 1 ゲーム進める（レバーを叩いたとき）。台の状態は新しくして返す */
export function stepAt(prev: AtMachine, setting: SlotSetting, rng: Rng): { next: AtMachine; step: AtStep } {
  const m: AtMachine = structuredClone(prev);
  const role = drawAtRole(rng);
  const events: AtEvent[] = [];
  let navi: number[] | null = null;
  let hint = 0;
  const during: AtStep['during'] = m.phase === 'at' ? (m.at!.tokka > 0 ? 'tokka' : 'at') : m.phase;

  if (m.phase === 'at') {
    const at = m.at!;
    at.games++;
    if (role === 'oshijun') navi = randomOrder(rng);
    if (at.tokka > 0) {
      // 特化ゾーン: 毎ゲーム 5〜20 ゲーム上乗せ（AT の残りは減らない）
      const add = [5, 5, 10, 10, 15, 20][rng(6)]! + addFor(role, rng);
      at.left += add;
      at.added += add;
      events.push({ k: 'add', games: add, why: role });
      at.tokka--;
      if (at.tokka === 0) events.push({ k: 'tokka_end', added: add });
    } else {
      const add = addFor(role, rng);
      if (add > 0) {
        at.left += add;
        at.added += add;
        events.push({ k: 'add', games: add, why: role });
      }
      if (role === 'chance') {
        at.tokka = 2;
        events.push({ k: 'tokka_start' });
      }
      at.left--;
      // セットの終わり: 鬼との継続バトル
      if (at.left <= 0 && at.tokka === 0) {
        const win = rng(100) < at.rate;
        events.push({ k: 'battle', win, set: at.set });
        if (win) {
          at.set++;
          at.left = AT_SET_GAMES;
        } else {
          events.push({ k: 'at_end', games: at.games, won: at.won, sets: at.set });
          m.phase = 'normal';
          m.at = null;
          m.games = 0;
          m.heaven = rng(100) < AT_HEAVEN_PERCENT;
          m.tenjou = false;
        }
      }
    }
    hint = role === 'chance' || role === 'byakko' || role === 'scherry' ? 2 : 0;
    return { next: m, step: { role, during, navi, events, hint } };
  }

  m.games++;
  const rare = role === 'scherry' || role === 'chance' || role === 'byakko';
  if (m.phase === 'cz') {
    // 🔥 チャンスゾーン: レア役で成功を引き直す。最後のゲームで結果
    const cz = m.cz ?? { left: 1, win: false };
    cz.left--;
    if (!cz.win && rng(100) < (AT_CZ_RARE_WIN[role] ?? 0)) cz.win = true;
    hint = cz.left <= 0 ? (cz.win ? 3 : 1 + rng(2)) : rare ? 2 : role === 'wcherry' || role === 'suika' ? 1 : 0;
    if (cz.left > 0) {
      m.cz = cz;
      return { next: m, step: { role, during, navi, events, hint } };
    }
    events.push({ k: 'cz_end', win: cz.win });
    m.cz = null;
    if (cz.win) {
      m.phase = 'at';
      m.tenjou = false;
      const rate = drawRate(rng);
      m.at = { left: AT_SET_GAMES, set: 1, rate, tokka: 0, games: 0, added: 0, won: 0 };
      events.push({ k: 'at_start', rate, tenjou: false });
    } else {
      m.phase = 'normal';
      // 天井に届いていれば、そのまま前兆へ
      const ceiling = m.heaven ? AT_HEAVEN_CEILING : AT_CEILING;
      if (m.games >= ceiling) {
        m.phase = 'zenchou';
        m.zenchou = 2 + rng(4);
        m.tenjou = !m.heaven;
        m.nextRate = drawRate(rng, m.tenjou ? 66 : 0);
      }
    }
    return { next: m, step: { role, during, navi, events, hint } };
  }
  if (m.phase === 'zenchou') {
    m.zenchou--;
    // 前兆中は演出が出やすい（最後のゲームはいちばん強く）
    hint = m.zenchou <= 0 ? 3 : rng(100) < 55 ? 1 + (rng(100) < 35 ? 1 : 0) : 0;
    if (m.zenchou <= 0) {
      m.phase = 'at';
      m.at = { left: AT_SET_GAMES, set: 1, rate: m.nextRate, tokka: 0, games: 0, added: 0, won: 0 };
      events.push({ k: 'at_start', rate: m.nextRate, tenjou: m.tenjou });
    }
    return { next: m, step: { role, during, navi, events, hint } };
  }

  // 通常時: レア役で AT 直撃かチャンスゾーン・天井
  const boost = AT_SETTING_BOOST[setting];
  const x = rng(10000);
  const direct = role === 'byakko' ? 10000 : Math.round((AT_DIRECT_PERCENT[role] ?? 0) * boost * 100);
  const czp = Math.round((AT_CZ_PERCENT[role] ?? 0) * boost * 100);
  const lucky = x < direct;
  const toCz = !lucky && x < direct + czp;
  const ceiling = m.heaven ? AT_HEAVEN_CEILING : AT_CEILING;
  const tenjou = !lucky && !toCz && m.games >= ceiling;
  // ガセの演出（当たっていなくても、たまに出る）
  hint = rare ? 2 : role === 'wcherry' || role === 'suika' ? 1 : rng(100) < 4 ? 1 : 0;
  if (toCz) {
    m.phase = 'cz';
    m.cz = { left: AT_CZ_GAMES, win: rng(100) < AT_CZ_WIN };
    events.push({ k: 'cz_start', why: role });
  } else if (lucky || tenjou) {
    m.phase = 'zenchou';
    // 前兆は 2〜8 ゲーム（白狐目はすぐ）
    m.zenchou = role === 'byakko' ? 1 : 2 + rng(7);
    m.tenjou = tenjou && !m.heaven;
    m.nextRate = drawRate(rng, m.tenjou ? 66 : 0);
  }
  return { next: m, step: { role, during, navi, events, hint } };
}

/**
 * そのゲームの払い戻し（何倍か）。押し順ベル: AT 中はナビどおり（order）なら 3 倍、通常時は 6 回に 1 回（lucky）
 */
export function atMult(role: AtRole, opts: { navi: number[] | null; order?: number[] | null; lucky?: boolean }): number {
  if (role === 'none') return 0;
  if (role === 'oshijun') {
    if (opts.navi) return opts.order && opts.order.join() === opts.navi.join() ? AT_ROLES.oshijun.mult : 0;
    return opts.lucky ? AT_ROLES.oshijun.mult : 0;
  }
  return AT_ROLES[role].mult;
}

/** 止まる目の見た目（押し順ベルはそろったか） */
export function atLookFor(role: AtRole, bellHit: boolean): Look | 'none' {
  if (role === 'oshijun') return bellHit ? 'bell' : 'none';
  if (role === 'none') return 'none';
  return role;
}

/** シミュレーション（AT 中はナビどおりに押す）。払い戻し率・AT の回数・平均の長さ */
export function simulateAt(setting: SlotSetting, games: number, rng: Rng): { rtp: number; ats: number; atGames: number; maxWin: number } {
  let m = newAtMachine();
  let bet = 0;
  let back = 0;
  let ats = 0;
  let atGames = 0;
  let run = 0;
  let maxWin = 0;
  for (let i = 0; i < games; i++) {
    const { next, step } = stepAt(m, setting, rng);
    bet += 1;
    const mult = atMult(step.role, { navi: step.navi, order: step.navi, lucky: rng(6) === 0 });
    back += mult;
    if (step.during === 'at' || step.during === 'tokka') {
      atGames++;
      run += mult - 1;
    }
    for (const e of step.events) {
      if (e.k === 'at_start') {
        ats++;
        run = 0;
      }
      if (e.k === 'at_end') maxWin = Math.max(maxWin, run);
    }
    m = next;
  }
  return { rtp: back / bet, ats, atGames, maxWin };
}
