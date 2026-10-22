import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { fortuneRounds, fortuneTickets, settings, type FortuneRound } from '../../db/schema.js';

/**
 * 📮 週末宝くじの結果を知らせる（日曜 21 時の抽選のあと）。
 * - 買った人みんなに、当たり・はずれを DM
 * - 当たった人は、宝くじ売り場のチャンネルに出す
 * 1 回の抽選に 1 回だけ（fortune_rounds.notified_at が目印）
 */

const CHANNEL_KEY = 'lottery.channel';

/** 宝くじ売り場のチャンネル（/パネル 宝くじ を置いた所） */
export async function lotteryChannel(db: Db): Promise<string | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, CHANNEL_KEY));
  const v = row?.value as { channelId?: unknown } | undefined;
  return typeof v?.channelId === 'string' ? v.channelId : undefined;
}

export async function setLotteryChannel(db: Db, channelId: string, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: CHANNEL_KEY, value: { channelId }, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: { channelId }, updatedBy: by, updatedAt: new Date() } });
}

export type LotteryResult = { round: FortuneRound; holders: { memberId: string; numbers: number[] }[] };

/** まだ知らせていない、抽選が終わった回を取る（取った回には目印を付ける。同時に呼んでも 1 回だけ） */
export async function claimLotteryResults(db: Db, now = new Date()): Promise<LotteryResult[]> {
  const due = await db.select({ id: fortuneRounds.id }).from(fortuneRounds).where(and(isNotNull(fortuneRounds.settledAt), isNull(fortuneRounds.notifiedAt)));
  const out: LotteryResult[] = [];
  for (const { id } of due) {
    const [round] = await db.update(fortuneRounds).set({ notifiedAt: now }).where(and(eq(fortuneRounds.id, id), isNull(fortuneRounds.notifiedAt))).returning();
    if (!round) continue;
    const tickets = await db.select({ memberId: fortuneTickets.memberId, number: fortuneTickets.number }).from(fortuneTickets).where(eq(fortuneTickets.roundId, id));
    const by = new Map<string, number[]>();
    for (const t of tickets) by.set(t.memberId, [...(by.get(t.memberId) ?? []), t.number]);
    out.push({ round, holders: [...by].map(([memberId, numbers]) => ({ memberId, numbers: numbers.sort((a, b) => a - b) })) });
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString('ja-JP');
const nums = (n: number[]) => (n.length > 10 ? `${n.slice(0, 10).map((x) => `${x} 番`).join('・')} ほか ${n.length - 10} 枚` : n.map((x) => `${x} 番`).join('・'));

/** 当たった券（等ごと）。前の回は 1 本だけ */
export const roundWinners = (r: FortuneRound) =>
  r.winners ?? (r.winnerId && r.winningNumber !== null ? [{ tier: '1等', number: r.winningNumber, memberId: r.winnerId, payout: r.payout }] : []);

/** 等ごとの当選番号（「1等 12 番 ／ 2等 3 番・40 番」） */
const tierLines = (r: FortuneRound) => {
  const by = new Map<string, number[]>();
  for (const w of roundWinners(r)) by.set(w.tier, [...(by.get(w.tier) ?? []), w.number]);
  return [...by].map(([tier, n]) => `${tier} ${n.map((x) => `${x} 番`).join('・')}`).join(' ／ ');
};

/** 1 人への DM の文 */
export function lotteryDm(r: FortuneRound, h: { memberId: string; numbers: number[] }, coin: string): string {
  const mine = roundWinners(r).filter((w) => w.memberId === h.memberId);
  const total = mine.reduce((n, w) => n + w.payout, 0);
  return mine.length
    ? `🎉 **週末宝くじ、当たりました！**\n${mine.map((w) => `・${w.tier}（${w.number} 番）… ${coin} ${fmt(w.payout)} 枚`).join('\n')}\n合わせて ${coin} ${fmt(total)} 枚をお渡ししました。おめでとうございます！\n（当選番号: ${tierLines(r)}）`
    : `🎫 週末宝くじの結果です。\n当選番号は ${tierLines(r)} でした。\nあなたの券（${nums(h.numbers)}）は、はずれでした。また来週の宝くじをお待ちしています。`;
}

/** 売り場に出す当選の知らせ（だれも買っていなければ出さない） */
export function lotteryWinnerPost(r: FortuneRound, coin: string): string | undefined {
  const ws = roundWinners(r);
  if (!ws.length) return undefined;
  return [`🎉 **週末宝くじの当選者が決まりました！**（${fmt(r.sold)} 枚の中から）`, ...ws.slice(0, 30).map((w) => `${w.tier} **${w.number} 番** <@${w.memberId}> さん … ${coin} ${fmt(w.payout)} 枚`), ws.length > 30 ? `ほか ${ws.length - 30} 本` : '', 'おめでとうございます！'].filter(Boolean).join('\n');
}
