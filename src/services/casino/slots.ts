import type { Rng } from './cards.js';

/**
 * スロット（ジャグラー風・3 リール × 21 コマ）。ラインは 5 本（上段・中段・下段・右下がり・右上がり）。
 * - レバーを叩いたときに「役」を引く（小役・ボーナス・はずれ）。払い戻し率はおよそ 95%（テストで確かめる）
 * - 小役（ぶどう・チェリー・リプレイ・ベル・ピエロ）は、その回にそろって払う
 * - ボーナス（BIG・REG）を引くと GOGO ランプが光る（レバーで光る「先ペカ」か、3 本止めたら光る「後ペカ」）。
 *   そのあとは自分で 7 を狙って止める（目押し）。STOP を押した所から最大 4 コマすべって止まり、どのラインでも 7 がそろえばよい。
 *   はずしても当たりは持ち越し、狙う回は賭けない（損はしない）。うまく押せなければ「おまかせ」でそろう
 * リールの並び・すべり方は casino.js でも同じに計算する（画面の data-* で渡す）
 */

export type SlotKey = 'seven' | 'bar' | 'grape' | 'cherry' | 'bell' | 'clown' | 'replay';

export const SLOT_SYMBOLS: Record<SlotKey, { name: string; emoji: string }> = {
  seven: { name: '赤7', emoji: '7️⃣' },
  bar: { name: 'BAR', emoji: '▬' },
  grape: { name: 'ぶどう', emoji: '🍇' },
  cherry: { name: 'チェリー', emoji: '🍒' },
  bell: { name: 'ベル', emoji: '🔔' },
  clown: { name: 'ピエロ', emoji: '🤡' },
  replay: { name: 'リプレイ', emoji: '🔁' },
};
export const SLOT_KEYS = Object.keys(SLOT_SYMBOLS) as SlotKey[];

/** リールの並び（上から下へ。回ると下へ流れ、上の絵柄が中段に来る） */
export const REELS: SlotKey[][] = [
  ['seven', 'grape', 'replay', 'cherry', 'grape', 'replay', 'bar', 'grape', 'replay', 'cherry', 'grape', 'replay', 'bell', 'grape', 'replay', 'clown', 'grape', 'replay', 'cherry', 'grape', 'replay'],
  ['seven', 'replay', 'grape', 'bell', 'replay', 'grape', 'bar', 'replay', 'grape', 'clown', 'replay', 'grape', 'cherry', 'replay', 'grape', 'bell', 'replay', 'grape', 'clown', 'replay', 'grape'],
  ['seven', 'grape', 'replay', 'bell', 'grape', 'replay', 'bar', 'grape', 'replay', 'clown', 'grape', 'replay', 'bell', 'grape', 'replay', 'cherry', 'grape', 'replay', 'clown', 'grape', 'replay'],
];
export const REEL_LEN = 21;
/** STOP を押した所から、すべって止まれるコマ数 */
export const SLIP = 4;

export type SlotRole = 'big' | 'reg' | 'grape' | 'cherry' | 'replay' | 'bell' | 'clown' | 'none';
export type SlotBonus = 'big' | 'reg';

/**
 * 役（weight / 65536 の確率で引く）。mult: 賭けの何倍が戻るか。line: 中段にそろう絵柄（null はなんでも）
 * チェリーは左リールのどの段に止まっても当たり。weight は設定 1 のとき（BIG・REG・ぶどうは設定で変わる）
 */
export const SLOT_ROLES: Record<Exclude<SlotRole, 'none'>, { weight: number; mult: number; name: string; line: (SlotKey | null)[] }> = {
  big: { weight: 273, mult: 80, name: 'BIG BONUS', line: ['seven', 'seven', 'seven'] },
  reg: { weight: 164, mult: 30, name: 'REG BONUS', line: ['seven', 'seven', 'bar'] },
  grape: { weight: 9362, mult: 2.5, name: 'ぶどう', line: ['grape', 'grape', 'grape'] },
  replay: { weight: 8978, mult: 1, name: 'リプレイ', line: ['replay', 'replay', 'replay'] },
  cherry: { weight: 1311, mult: 2, name: 'チェリー', line: ['cherry', null, null] },
  bell: { weight: 66, mult: 5, name: 'ベル', line: ['bell', 'bell', 'bell'] },
  clown: { weight: 66, mult: 4, name: 'ピエロ', line: ['clown', 'clown', 'clown'] },
};
const ROLE_KEYS = Object.keys(SLOT_ROLES) as Exclude<SlotRole, 'none'>[];
const WEIGHT_TOTAL = 65536;

/** 設定（1〜6）。BIG・REG・ぶどうの重み（/ 65536）。高いほど当たりやすい */
export type SlotSetting = 1 | 2 | 3 | 4 | 5 | 6;
export const SLOT_SETTINGS: Record<SlotSetting, { big: number; reg: number; grape: number }> = {
  1: { big: 273, reg: 164, grape: 9362 },
  2: { big: 278, reg: 180, grape: 9380 },
  3: { big: 285, reg: 200, grape: 9420 },
  4: { big: 293, reg: 224, grape: 9470 },
  5: { big: 303, reg: 250, grape: 9520 },
  6: { big: 318, reg: 280, grape: 9600 },
};
export const SETTING_KEYS = [1, 2, 3, 4, 5, 6] as const;
export const isSetting = (v: unknown): v is SlotSetting => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6;
/** 「おまかせ」のとき、その日の設定の出やすさ（%） */
export const RANDOM_SETTING_ODDS: Record<SlotSetting, number> = { 1: 35, 2: 25, 3: 18, 4: 12, 5: 6, 6: 4 };

const weightOf = (k: Exclude<SlotRole, 'none'>, setting: SlotSetting) => (k === 'big' || k === 'reg' || k === 'grape' ? SLOT_SETTINGS[setting][k] : SLOT_ROLES[k].weight);
/** その設定での役の確率（1/x の x） */
export const roleOdds = (k: Exclude<SlotRole, 'none'>, setting: SlotSetting = 1) => WEIGHT_TOTAL / weightOf(k, setting);

export const isBonus = (r: SlotRole): r is SlotBonus => r === 'big' || r === 'reg';
export const roleMult = (r: SlotRole) => (r === 'none' ? 0 : SLOT_ROLES[r].mult);
/** 戻る銭（1 銭未満は切り捨て） */
export const slotPayout = (bet: number, r: SlotRole) => Math.floor(bet * roleMult(r));

/** レバーを叩いたときに引く役 */
export function drawRole(rng: Rng, setting: SlotSetting = 1): SlotRole {
  let x = rng(WEIGHT_TOTAL);
  for (const k of ROLE_KEYS) {
    const w = weightOf(k, setting);
    if (x < w) return k;
    x -= w;
  }
  return 'none';
}

/** 払い戻し率（役の確率 × 倍率） */
export function slotRtp(setting: SlotSetting = 1): number {
  return ROLE_KEYS.reduce((n, k) => n + (weightOf(k, setting) / WEIGHT_TOTAL) * SLOT_ROLES[k].mult, 0);
}

/** 「おまかせ」の設定を引く */
export function randomSetting(rng: Rng): SlotSetting {
  let x = rng(100);
  for (const k of SETTING_KEYS) {
    if (x < RANDOM_SETTING_ODDS[k]) return k;
    x -= RANDOM_SETTING_ODDS[k];
  }
  return 1;
}

const at = (reel: number, i: number) => REELS[reel]![((i % REEL_LEN) + REEL_LEN) % REEL_LEN]!;
/** 3 × 3 の見た目（リールごとに上・中・下） */
export const gridOf = (stops: number[]) => stops.map((s, i) => [at(i, s - 1), at(i, s), at(i, s + 1)]);

/** ライン（リールごとの段: 0 上・1 中・2 下） */
export const PAYLINES = [
  { key: 'top', name: '上段', rows: [0, 0, 0] },
  { key: 'mid', name: '中段', rows: [1, 1, 1] },
  { key: 'bottom', name: '下段', rows: [2, 2, 2] },
  { key: 'down', name: '右下がり', rows: [0, 1, 2] },
  { key: 'up', name: '右上がり', rows: [2, 1, 0] },
] as const;
/** ライン上に並んだ絵柄 */
export const lineOf = (stops: number[], line = 1) => stops.map((s, i) => at(i, s - 1 + PAYLINES[line]!.rows[i]!));

/** 1 本のラインの並びが何の役か */
export function roleOfLine(line: SlotKey[]): SlotRole {
  for (const k of ROLE_KEYS) {
    const want = SLOT_ROLES[k].line;
    if (want.every((w, i) => w === null || w === line[i])) return k;
  }
  return 'none';
}

/** 止まった目の役（どこかのラインにそろった役。line: そのラインの番号・なければ -1） */
export function judge(stops: number[]): { role: SlotRole; line: number; roles: SlotRole[] } {
  const found = PAYLINES.map((_, l) => roleOfLine(lineOf(stops, l)));
  const roles = [...new Set(found.filter((r) => r !== 'none'))];
  const line = found.findIndex((r) => r !== 'none');
  return { role: line < 0 ? 'none' : found[line]!, line, roles };
}

/** その役だけを見せる止まり方（決まった役のときに使う。ほかの役はどのラインにも見せない） */
export function stopsFor(role: SlotRole, rng: Rng): number[] {
  const ok = (stops: number[]) => {
    const j = judge(stops);
    return role === 'none' ? j.roles.length === 0 : j.roles.length === 1 && j.roles[0] === role;
  };
  for (let tries = 0; tries < 400; tries++) {
    const stops = [rng(REEL_LEN), rng(REEL_LEN), rng(REEL_LEN)];
    if (ok(stops)) return stops;
  }
  // 乱数がかたよっても必ず見つける（ずらしながら全部ためす）
  const o = [rng(REEL_LEN), rng(REEL_LEN), rng(REEL_LEN)];
  for (let a = 0; a < REEL_LEN; a++)
    for (let b = 0; b < REEL_LEN; b++)
      for (let c = 0; c < REEL_LEN; c++) {
        const stops = [(a + o[0]!) % REEL_LEN, (b + o[1]!) % REEL_LEN, (c + o[2]!) % REEL_LEN];
        if (ok(stops)) return stops;
      }
  throw new Error(`no stops for ${role}`);
}

/** STOP を押した所から止まれる所（すべる順） */
const slipCands = (pressed: number) => Array.from({ length: SLIP + 1 }, (_, k) => (((pressed - k) % REEL_LEN) + REEL_LEN) % REEL_LEN);
/** その止まり方で、絵柄 k が見えている段 */
const rowsOf = (reel: number, stop: number, k: SlotKey) => [0, 1, 2].filter((r) => at(reel, stop - 1 + r) === k);

/**
 * 目押しの止まり方（左から順に止める。ボーナスを持っているとき）。
 * 押した所から SLIP コマ以内で、それまでのリールとどれかのラインでつながる所に 7（右は REG なら BAR）が来れば止める。
 * そろわなければ、ほかの役に見えない所で止める
 */
export function aimStops(bonus: SlotBonus, pressed: number[]): number[] {
  const want = SLOT_ROLES[bonus].line as SlotKey[];
  const stops: number[] = [];
  for (let reel = 0; reel < 3; reel++) {
    const cands = slipCands(pressed[reel]!);
    // まだつながっているライン
    const alive = PAYLINES.map((l, i) => i).filter((l) => stops.every((st, r) => rowsOf(r, st, want[r]!).includes(PAYLINES[l]!.rows[r]!)));
    const hits = (c: number) => alive.some((l) => rowsOf(reel, c, want[reel]!).includes(PAYLINES[l]!.rows[reel]!));
    // ほかの役に見えない（左はチェリーを見せない・右はボーナス以外の役をそろえない）
    const clean = (c: number) => {
      if (reel === 0) return rowsOf(0, c, 'cherry').length === 0;
      if (reel < 2) return true;
      return judge([...stops, c]).roles.every((r) => r === bonus);
    };
    stops.push(cands.find((c) => hits(c) && clean(c)) ?? cands.find(clean) ?? cands[0]!);
  }
  return stops;
}

/** ボーナスがそろう止まり方（おまかせ。中段にそろえる） */
export const bonusStops = (bonus: SlotBonus) => (SLOT_ROLES[bonus].line as SlotKey[]).map((k, reel) => REELS[reel]!.indexOf(k));

/** GOGO ランプ（pre: レバーで光る / post: 3 本止めたら光る） */
export const slotLamp = (rng: Rng): 'pre' | 'post' => (rng(3) === 0 ? 'pre' : 'post');
