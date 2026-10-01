import type { Rng } from './cards.js';

/**
 * スロット（ジャグラー風・3 リール × 21 コマ）。払うのは中段の 1 列だけ。
 * - レバーを叩いたときに「役」を引く（小役・ボーナス・はずれ）。払い戻し率はおよそ 95%（テストで確かめる）
 * - 小役（ぶどう・チェリー・リプレイ・ベル・ピエロ）は、その回にそろって払う
 * - ボーナス（BIG・REG）を引くと GOGO ランプが光る（レバーで光る「先ペカ」か、3 本止めたら光る「後ペカ」）。
 *   そのあとは自分で 7 を狙って止める（目押し）。STOP を押した所から最大 4 コマすべって止まる。
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
 * チェリーは左リールの中段に止まれば、ほかはなんでも
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

export const isBonus = (r: SlotRole): r is SlotBonus => r === 'big' || r === 'reg';
export const roleMult = (r: SlotRole) => (r === 'none' ? 0 : SLOT_ROLES[r].mult);
/** 戻る銭（1 銭未満は切り捨て） */
export const slotPayout = (bet: number, r: SlotRole) => Math.floor(bet * roleMult(r));

/** レバーを叩いたときに引く役 */
export function drawRole(rng: Rng): SlotRole {
  let x = rng(WEIGHT_TOTAL);
  for (const k of ROLE_KEYS) {
    if (x < SLOT_ROLES[k].weight) return k;
    x -= SLOT_ROLES[k].weight;
  }
  return 'none';
}

/** 払い戻し率（役の確率 × 倍率） */
export function slotRtp(): number {
  return ROLE_KEYS.reduce((n, k) => n + (SLOT_ROLES[k].weight / WEIGHT_TOTAL) * SLOT_ROLES[k].mult, 0);
}

const at = (reel: number, i: number) => REELS[reel]![((i % REEL_LEN) + REEL_LEN) % REEL_LEN]!;
/** 中段に止まっている絵柄 */
export const lineOf = (stops: number[]) => stops.map((s, i) => at(i, s));
/** 3 × 3 の見た目（リールごとに上・中・下） */
export const gridOf = (stops: number[]) => stops.map((s, i) => [at(i, s - 1), at(i, s), at(i, s + 1)]);

/** 中段の並びが何の役か */
export function roleOfLine(line: SlotKey[]): SlotRole {
  for (const k of ROLE_KEYS) {
    const want = SLOT_ROLES[k].line;
    if (want.every((w, i) => w === null || w === line[i])) return k;
  }
  return 'none';
}

/** 左リールの上・中・下のどこかにチェリーが見えるか（チェリーでないのに見えると紛らわしい） */
const cherryShown = (s: number) => [s - 1, s, s + 1].some((i) => at(0, i) === 'cherry');

/** その役を見せる止まり方（決まった役のときに使う） */
export function stopsFor(role: SlotRole, rng: Rng): number[] {
  const ok = (stops: number[]) => roleOfLine(lineOf(stops)) === role && (role === 'cherry' || !cherryShown(stops[0]!));
  const want = role === 'none' ? [null, null, null] : SLOT_ROLES[role].line;
  const pick = (reel: number, w: SlotKey | null) => {
    const idx = REELS[reel]!.flatMap((k, i) => (w === null || k === w ? [i] : []));
    return idx[rng(idx.length)]!;
  };
  for (let tries = 0; tries < 200; tries++) {
    const stops = want.map((w, i) => pick(i, w));
    if (ok(stops)) return stops;
  }
  // 乱数がかたよっても必ず見つける
  for (let a = 0; a < REEL_LEN; a++) for (let b = 0; b < REEL_LEN; b++) for (let c = 0; c < REEL_LEN; c++) if (ok([a, b, c])) return [a, b, c];
  throw new Error(`no stops for ${role}`);
}

/**
 * 1 本止める（目押しのとき）。pressed: STOP を押したとき中段にあったコマ。
 * 狙う絵柄（want）が SLIP コマ以内にあればそこで止め、なければ紛らわしい止まり方（avoid）をよける
 */
export function slipStop(reel: number, pressed: number, want: SlotKey, avoid: (idx: number) => boolean): number {
  const cand = Array.from({ length: SLIP + 1 }, (_, k) => (((pressed - k) % REEL_LEN) + REEL_LEN) % REEL_LEN);
  return cand.find((i) => at(reel, i) === want) ?? cand.find((i) => !avoid(i)) ?? cand[0]!;
}

/** 目押しの止まり方（左から順に止める）。ボーナスがそろうか、ほかの役に見えない所で止まる */
export function aimStops(bonus: SlotBonus, pressed: number[]): number[] {
  const want = SLOT_ROLES[bonus].line as SlotKey[];
  const stops: number[] = [];
  for (let reel = 0; reel < 3; reel++) {
    const avoid = (i: number) => {
      if (reel === 0) return cherryShown(i);
      if (reel < 2) return false;
      const r = roleOfLine(lineOf([...stops, i]));
      return r !== 'none' && r !== bonus;
    };
    stops.push(slipStop(reel, pressed[reel]!, want[reel]!, avoid));
  }
  return stops;
}

/** ボーナスがそろう止まり方（おまかせ） */
export const bonusStops = (bonus: SlotBonus) => (SLOT_ROLES[bonus].line as SlotKey[]).map((k, reel) => REELS[reel]!.indexOf(k));

/** GOGO ランプ（pre: レバーで光る / post: 3 本止めたら光る） */
export const slotLamp = (rng: Rng): 'pre' | 'post' => (rng(3) === 0 ? 'pre' : 'post');
