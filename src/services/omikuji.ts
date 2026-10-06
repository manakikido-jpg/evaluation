import { and, desc, eq, gte, notLike, sql } from 'drizzle-orm';
import { omikujiTextsSchema, type EconomyConfig, type OmikujiSpecialConfig, type OmikujiStreakConfig, type OmikujiTextsConfig, type StreakReward } from '../config.js';
import { toneOf, type FortuneKey } from '../omikujiTexts.js';
import type { Db } from '../db/client.js';
import { omikuji } from '../db/schema.js';
import { jstDate } from './activity.js';
import { addCoins, walletOf } from './economy.js';
import { addTickets, TICKET_LABEL } from './tickets.js';

/**
 * おみくじ（1 日 1 回のログボ）。運勢に応じて花びらがもらえる。ご縁には影響しない。
 * 日本時間の 0 時に引き直せる。
 */

export type Fortune = { key: string; name: string; /** 出やすさ（合計 100） */ weight: number; /** 花びらの倍率 */ mult: number; message: string; color: number };

export const FORTUNES: Fortune[] = [
  { key: 'daikichi', name: '大吉', weight: 8, mult: 3, message: 'ご縁が大きく花ひらく日。思いきって話しかけてみて', color: 0xd4a017 },
  { key: 'chukichi', name: '中吉', weight: 15, mult: 2, message: '良いご縁に恵まれる日。いつもの通話に顔を出してみて', color: 0xd7003a },
  { key: 'shokichi', name: '小吉', weight: 20, mult: 1.5, message: 'ささやかな幸せが見つかる日', color: 0xe0607e },
  { key: 'kichi', name: '吉', weight: 27, mult: 1, message: '穏やかに過ごせる日', color: 0xe0607e },
  { key: 'suekichi', name: '末吉', weight: 15, mult: 0.8, message: 'あとから良いことがある日。夜に期待', color: 0x8fbc8f },
  { key: 'kyo', name: '凶', weight: 10, mult: 0.5, message: '無理は禁物。今日は早めに寝よう', color: 0x808080 },
  { key: 'daikyo', name: '大凶', weight: 5, mult: 0.5, message: 'あとは上がるだけ。逆に縁起がいいかも', color: 0x5b0e14 },
];

/** 運勢のほかに出す項目（運勢の向きに合わせて選ぶ。毎日出す項目＋日替わり 1 つ＋ラッキー場所） */
export type Saying = { emoji: string; label: string; text: string };

const pick = <T>(list: readonly T[], rand: Rand): T => list[Math.floor(rand() * list.length)]!;

export function omikujiSayings(texts: OmikujiTextsConfig, fortuneKey: string, rand: Rand = Math.random): Saying[] {
  const tone = toneOf(specialIndex(fortuneKey) !== undefined ? 'daikichi' : fortuneKey);
  const usable = texts.items.filter((it) => it[tone].length);
  const rotating = usable.filter((it) => !it.fixed);
  const today = rotating.length ? pick(rotating, rand) : undefined;
  const out: Saying[] = usable.filter((it) => it.fixed || it === today).map((it) => ({ emoji: it.emoji, label: it.label, text: pick(it[tone], rand) }));
  if (texts.places.length) out.push({ emoji: '🍀', label: 'ラッキー場所', text: pick(texts.places, rand) });
  return out;
}

/**
 * 一言を選ぶ。同じ人には、その運勢の文をひととおり出し切るまで同じ文を出さない（前に出た文を数えて外す）。
 * 運営吉は決めたひとこと。number: 第〇番（文の何番目か）
 */
export async function chooseMessage(db: Db, memberId: string, fortune: Fortune, texts: OmikujiTextsConfig, rand: Rand = Math.random): Promise<{ message: string; number?: number }> {
  if (specialIndex(fortune.key) !== undefined) return { message: fortune.message };
  const pool = texts.messages[fortune.key as FortuneKey]?.length ? texts.messages[fortune.key as FortuneKey] : [fortune.message];
  let candidates = pool;
  if (pool.length > 1) {
    const rows = await db
      .select({ message: omikuji.message })
      .from(omikuji)
      .where(and(eq(omikuji.memberId, memberId), eq(omikuji.fortune, fortune.key)))
      .orderBy(desc(omikuji.createdAt))
      .limit(pool.length - 1);
    const recent = rows.map((r) => r.message);
    candidates = pool.filter((m) => !recent.includes(m));
    if (!candidates.length) candidates = pool.filter((m) => m !== recent[0]);
  }
  const message = pick(candidates, rand);
  return { message, number: pool.indexOf(message) + 1 };
}


type Rand = () => number;
/** 運営吉の設定（確率の決め方は書かなければ「決めた確率」） */
type SpecialCfg = Pick<OmikujiSpecialConfig, 'enabled' | 'percent' | 'mult' | 'list'> & Partial<Pick<OmikujiSpecialConfig, 'mode' | 'everyDays' | 'minPercent' | 'maxPercent'>>;
const DEFAULT_TEXTS = omikujiTextsSchema.parse({});

/** 🎴 運営吉の運勢（key は unei1〜unei4。何番目かで絵が決まる） */
export const SPECIAL_COLOR = 0xd4a017;
export const specialIndex = (key: string): number | undefined => {
  const m = /^unei([1-9])$/.exec(key);
  return m ? Number(m[1]) : undefined;
};
export function specialFortune(cfg: SpecialCfg, n: number): Fortune | undefined {
  const s = cfg.list[n - 1];
  if (!s) return undefined;
  return { key: `unei${n}`, name: s.name, weight: 0, mult: cfg.mult, message: s.message || '運営からの特別なおみくじ。今日はきっといい日', color: s.color ? parseInt(s.color.slice(1), 16) : SPECIAL_COLOR };
}
/** 引いた記録の key から運勢（運営吉は今の設定から。消えていれば名前だけ） */
export function fortuneOf(key: string, special?: SpecialCfg): Fortune | undefined {
  const n = specialIndex(key);
  if (n !== undefined) return (special && specialFortune(special, n)) ?? { key, name: '運営吉', weight: 0, mult: 0, message: '', color: SPECIAL_COLOR };
  return FORTUNES.find((f) => f.key === key);
}

export function drawFortune(rand: Rand = Math.random, special?: SpecialCfg): Fortune {
  // 🎴 運営吉（決めた確率で。出たら、その中から 1 つ）
  if (special?.enabled && special.list.length && special.percent > 0 && rand() * 100 < special.percent) {
    return specialFortune(special, 1 + Math.floor(rand() * special.list.length))!;
  }
  let r = rand() * FORTUNES.reduce((n, f) => n + f.weight, 0);
  for (const f of FORTUNES) {
    r -= f.weight;
    if (r < 0) return f;
  }
  return FORTUNES[FORTUNES.length - 1]!;
}

/** もらえる花びら（基本の量 × 倍率。基本が 0 ならなし） */
export function omikujiReward(economy: Pick<EconomyConfig, 'omikujiBase'>, f: Fortune): number {
  return economy.omikujiBase > 0 ? Math.max(1, Math.round(economy.omikujiBase * f.mult)) : 0;
}

/** 掲示などに書く「〇〜〇 枚」 */
export function omikujiRange(economy: Pick<EconomyConfig, 'omikujiBase'>): string {
  const amounts = FORTUNES.map((f) => omikujiReward(economy, f));
  return `${Math.min(...amounts)}〜${Math.max(...amounts)}`;
}

/** 連続日数: 今日（または昨日）から、1 日も空けずに引いた日数。今日まだ引いていなければ昨日までの分 */
export function streakOf(dates: readonly string[], today: string): number {
  const set = new Set(dates);
  const prev = (d: string) => jstDate(new Date(new Date(`${d}T12:00:00+09:00`).getTime() - 86_400_000));
  let d = set.has(today) ? today : prev(today);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = prev(d);
  }
  return n;
}

/** その日数でもらえるおまけ */
export const streakHits = (cfg: OmikujiStreakConfig, streak: number): StreakReward[] =>
  cfg.rewards.filter((r) => (r.repeat ? streak > 0 && streak % r.days === 0 : streak === r.days));

/** 次のおまけ（いちばん近いもの）。何日後か */
export function nextStreakReward(cfg: OmikujiStreakConfig, streak: number): { reward: StreakReward; left: number } | undefined {
  let best: { reward: StreakReward; left: number } | undefined;
  for (const r of cfg.rewards) {
    const at = r.repeat ? (Math.floor(streak / r.days) + 1) * r.days : r.days;
    if (at <= streak) continue;
    if (!best || at - streak < best.left) best = { reward: r, left: at - streak };
  }
  return best;
}

/** おまけの中身（「🪙銭 50・🎁物御籤の無料券 ×1・<@&ロール>」） */
export function streakRewardText(r: StreakReward, economy: Pick<EconomyConfig, 'currencyEmoji' | 'currencyName'>): string {
  return [
    ...(r.coins > 0 ? [`${economy.currencyEmoji}${economy.currencyName} ${r.coins.toLocaleString('ja-JP')}`] : []),
    ...(r.ticket !== 'none' && r.tickets > 0 ? [`${TICKET_LABEL[r.ticket].emoji}${TICKET_LABEL[r.ticket].name} ×${r.tickets}`] : []),
    ...(r.roleId ? [`<@&${r.roleId}>`] : []),
  ].join('・');
}

/** 掲示に書く、おまけの一覧（「7 日ごとに …／30 日目に …」。なければ「なし」） */
export function describeStreakRewards(cfg: OmikujiStreakConfig, economy: Pick<EconomyConfig, 'currencyEmoji' | 'currencyName'>): string {
  const list = [...cfg.rewards].sort((a, b) => a.days - b.days).filter((r) => streakRewardText(r, economy));
  return list.length ? list.map((r) => `${r.days} 日${r.repeat ? 'ごとに' : '目に'} ${streakRewardText(r, economy)}`).join('／') : 'なし';
}

/** おみくじを引いた日（もう 1 回の分は除く） */
async function drawnDates(db: Db, memberId: string): Promise<string[]> {
  const rows = await db
    .select({ date: omikuji.date })
    .from(omikuji)
    .where(and(eq(omikuji.memberId, memberId), notLike(omikuji.date, '%#%')))
    .orderBy(desc(omikuji.date))
    .limit(800);
  return rows.map((r) => r.date);
}

export async function omikujiStreak(db: Db, memberId: string, now: Date): Promise<number> {
  return streakOf(await drawnDates(db, memberId), jstDate(now));
}

export type OmikujiResult =
  | {
      status: 'drawn';
      fortune: Fortune;
      amount: number;
      balance: number;
      /** 一言（第〇番は number） */
      message: string;
      number?: number;
      sayings: Saying[];
      /** 連続日数（もう 1 回のときは 0） */
      streak: number;
      /** 今日もらえたおまけ（ロールは呼び出し側が付ける） */
      bonus: StreakReward[];
    }
  | { status: 'already'; fortune: Fortune; streak: number };

/** ショップの「もう 1 回」は、その日の 2 回目として別の日付の印で記録する（1 日 1 回まで） */
const extraKey = (date: string) => `${date}#2`;

/** 今日のおみくじ: 引いたか・もう 1 回を使ったか */
export async function omikujiToday(db: Db, memberId: string, now: Date): Promise<{ drawn: boolean; extraUsed: boolean }> {
  const date = jstDate(now);
  const rows = await db.select({ date: omikuji.date }).from(omikuji).where(eq(omikuji.memberId, memberId));
  return { drawn: rows.some((r) => r.date === date), extraUsed: rows.some((r) => r.date === extraKey(date)) };
}

// ───────── 🎴 運営吉の確率（出したい間隔から） ─────────

/** 最近何日のおみくじの回数で計るか */
export const SPECIAL_WINDOW_DAYS = 30;
let dailyCache: { at: number; avg: number } | undefined;

/** 最近 30 日のおみくじの 1 日の平均回数（「もう 1 回」も入れる。10 分おぼえておく） */
export async function omikujiDailyAverage(db: Db, now: Date, opts: { fresh?: boolean } = {}): Promise<number> {
  if (!opts.fresh && dailyCache && now.getTime() - dailyCache.at < 10 * 60_000 && now.getTime() >= dailyCache.at) return dailyCache.avg;
  const since = new Date(now.getTime() - SPECIAL_WINDOW_DAYS * 86_400_000);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(omikuji).where(gte(omikuji.createdAt, since));
  const avg = Number(row?.n ?? 0) / SPECIAL_WINDOW_DAYS;
  dailyCache = { at: now.getTime(), avg };
  return avg;
}

/**
 * 今の運営吉の確率（%）。fixed なら決めた確率。interval なら 100 ÷（1 日の平均回数 × 出したい日数）を下限・上限におさめる
 * （まだおみくじが引かれていなければ上限）
 */
export function specialPercent(cfg: Pick<SpecialCfg, 'mode' | 'percent' | 'everyDays' | 'minPercent' | 'maxPercent'>, dailyAverage: number): number {
  if (cfg.mode !== 'interval') return cfg.percent;
  const lo = Math.min(cfg.minPercent ?? 0.01, cfg.maxPercent ?? 1);
  const hi = Math.max(cfg.minPercent ?? 0.01, cfg.maxPercent ?? 1);
  if (dailyAverage <= 0) return hi;
  return Math.min(hi, Math.max(lo, 100 / (dailyAverage * (cfg.everyDays ?? 30))));
}

export async function drawOmikuji(
  db: Db,
  economy: EconomyConfig,
  memberId: string,
  now: Date,
  rand: Rand = Math.random,
  opts: { extra?: boolean; streak?: OmikujiStreakConfig; special?: SpecialCfg; texts?: OmikujiTextsConfig } = {},
): Promise<OmikujiResult> {
  const date = opts.extra ? extraKey(jstDate(now)) : jstDate(now);
  // 🎴 運営吉: 間隔で決めるときは、最近のおみくじの回数から今の確率を出す
  const special = opts.special?.enabled && opts.special.mode === 'interval' ? { ...opts.special, percent: specialPercent(opts.special, await omikujiDailyAverage(db, now)) } : opts.special;
  const fortune = drawFortune(rand, special);
  const amount = omikujiReward(economy, fortune);
  const texts = opts.texts ?? DEFAULT_TEXTS;
  const chosen = await chooseMessage(db, memberId, fortune, texts, rand);
  // (member_id, date) が主キーなので、同じ日に 2 回目は入らない（連打しても 1 回だけ）
  // 引いた記録と花びらを一緒に（途中で失敗したら、その日はまた引ける）
  // 連続日数のおまけも同じ記録と一緒に（その日の記録は 1 つだけなので、おまけも 1 回だけ）
  const done = await db.transaction(async (tx) => {
    const inserted = await tx.insert(omikuji).values({ memberId, date, fortune: fortune.key, amount, message: chosen.message, createdAt: now }).onConflictDoNothing().returning();
    if (!inserted.length) return undefined;
    let balance = amount > 0 ? await addCoins(tx, memberId, amount, 'omikuji', { date, fortune: fortune.key }) : (await walletOf(tx, memberId)).balance;
    const streak = opts.extra ? 0 : streakOf(await drawnDates(tx, memberId), date);
    const bonus = opts.streak && streak ? streakHits(opts.streak, streak) : [];
    for (const b of bonus) {
      if (b.coins > 0) balance = await addCoins(tx, memberId, b.coins, 'omikuji_streak', { date, streak, days: b.days });
      if (b.ticket !== 'none' && b.tickets > 0) await addTickets(tx, memberId, b.ticket, b.tickets);
    }
    return { balance, streak, bonus };
  });
  if (done === undefined) {
    const [row] = await db
      .select()
      .from(omikuji)
      .where(and(eq(omikuji.memberId, memberId), eq(omikuji.date, date)));
    return { status: 'already', fortune: (row && fortuneOf(row.fortune, opts.special)) ?? fortune, streak: await omikujiStreak(db, memberId, now) };
  }
  const sayings = omikujiSayings(texts, fortune.key, rand);
  return { status: 'drawn', fortune, amount, balance: done.balance, message: chosen.message, ...(chosen.number ? { number: chosen.number } : {}), sayings, streak: done.streak, bonus: done.bonus };
}
