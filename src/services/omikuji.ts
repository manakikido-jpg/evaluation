import { and, eq } from 'drizzle-orm';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { omikuji } from '../db/schema.js';
import { jstDate } from './activity.js';
import { addCoins, walletOf } from './economy.js';

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

/** 運勢のほかに出す一言（毎回ひとつずつ選ぶ） */
export const SAYINGS: { label: string; list: string[] }[] = [
  { label: '📞 待ち人', list: ['通話で来る', '遅れて来る', '意外な人', 'すぐそばにいる', 'ゲームの中で出会う', '来ない。こちらから行け'] },
  { label: '🎮 勝負事', list: ['勝てる。攻めよ', '引き分けが吉', '慎重に進め', '味方を信じよ', '今日は観戦が吉', '初めてのゲームが吉'] },
  { label: '🌙 寝落ち', list: ['よく眠れる', '誰かと一緒なら吉', '早寝が吉', '夜ふかし注意', '子守唄が吉', '朝まで話が弾む'] },
  { label: '🍀 ラッキー場所', list: ['拝殿', '縁側', '屋台', '宿坊', '手水舎', '絵馬'] },
];

type Rand = () => number;

export function drawFortune(rand: Rand = Math.random): Fortune {
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

export type OmikujiResult =
  | { status: 'drawn'; fortune: Fortune; amount: number; balance: number; sayings: { label: string; text: string }[] }
  | { status: 'already'; fortune: Fortune };

export async function drawOmikuji(db: Db, economy: EconomyConfig, memberId: string, now: Date, rand: Rand = Math.random): Promise<OmikujiResult> {
  const date = jstDate(now);
  const fortune = drawFortune(rand);
  const amount = omikujiReward(economy, fortune);
  // (member_id, date) が主キーなので、同じ日に 2 回目は入らない（連打しても 1 回だけ）
  // 引いた記録と花びらを一緒に（途中で失敗したら、その日はまた引ける）
  const balance = await db.transaction(async (tx) => {
    const inserted = await tx.insert(omikuji).values({ memberId, date, fortune: fortune.key, amount }).onConflictDoNothing().returning();
    if (!inserted.length) return undefined;
    return amount > 0 ? addCoins(tx, memberId, amount, 'omikuji', { date, fortune: fortune.key }) : (await walletOf(tx, memberId)).balance;
  });
  if (balance === undefined) {
    const [row] = await db
      .select()
      .from(omikuji)
      .where(and(eq(omikuji.memberId, memberId), eq(omikuji.date, date)));
    return { status: 'already', fortune: FORTUNES.find((f) => f.key === row?.fortune) ?? fortune };
  }
  const sayings = SAYINGS.map((s) => ({ label: s.label, text: s.list[Math.floor(rand() * s.list.length)]! }));
  return { status: 'drawn', fortune, amount, balance, sayings };
}
