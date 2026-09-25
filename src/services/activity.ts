import { and, desc, eq, sql } from 'drizzle-orm';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily } from '../db/schema.js';
import { addCoins } from './economy.js';

/** 日本時間の日付（YYYY-MM-DD） */
export function jstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 発言数をまとめて足す（BOT は 1 分ごとにまとめて書き込む） */
export async function addMessageCounts(db: Db, counts: Map<string, number>, now: Date): Promise<void> {
  if (!counts.size) return;
  const date = jstDate(now);
  const rows = [...counts].map(([memberId, n]) => ({ memberId, date, messageCount: n }));
  await db
    .insert(activityDaily)
    .values(rows)
    .onConflictDoUpdate({
      target: [activityDaily.memberId, activityDaily.date],
      set: { messageCount: sql`${activityDaily.messageCount} + excluded.message_count` },
    });
}

export type VoiceChannelState = {
  id: string;
  members: { id: string; bot: boolean; deaf: boolean }[];
};

/**
 * 通話で数える人を選ぶ。
 * - 除外チャンネル（AFK など）は数えない
 * - BOT とスピーカーミュート中の人は数えない
 * - 数える人が 2 人以上いる通話だけ（1 人で放置しても貯まらない）
 */
export function eligibleVoiceMembers(channels: VoiceChannelState[], excluded: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const ch of channels) {
    if (excluded.has(ch.id)) continue;
    const humans = ch.members.filter((m) => !m.bot && !m.deaf);
    if (humans.length >= 2) out.push(...humans.map((m) => m.id));
  }
  return out;
}

/**
 * 1 分ごとに呼ぶ。通話している人の通話時間を 1 分足し、10 分ごとに通貨を渡す（1 日の上限まで）。
 * 返り値: 通貨をもらった人と量
 */
export async function voiceTick(
  db: Db,
  economy: EconomyConfig,
  memberIds: string[],
  now: Date,
): Promise<{ memberId: string; amount: number }[]> {
  const date = jstDate(now);
  const awarded: { memberId: string; amount: number }[] = [];
  for (const memberId of new Set(memberIds)) {
    const [row] = await db
      .insert(activityDaily)
      .values({ memberId, date, vcMinutes: 1 })
      .onConflictDoUpdate({
        target: [activityDaily.memberId, activityDaily.date],
        set: { vcMinutes: sql`${activityDaily.vcMinutes} + 1` },
      })
      .returning({ vcMinutes: activityDaily.vcMinutes, vcCoins: activityDaily.vcCoins });
    if (!row || row.vcMinutes % 10 !== 0) continue;

    const amount = Math.min(economy.voicePer10Min, economy.voiceDailyCap - row.vcCoins);
    if (amount <= 0) continue;
    // 上限の判定と加算を同時に行う（二重に渡さない）
    const updated = await db
      .update(activityDaily)
      .set({ vcCoins: sql`${activityDaily.vcCoins} + ${amount}` })
      .where(
        and(
          eq(activityDaily.memberId, memberId),
          eq(activityDaily.date, date),
          sql`${activityDaily.vcCoins} + ${amount} <= ${economy.voiceDailyCap}`,
        ),
      )
      .returning({ vcCoins: activityDaily.vcCoins });
    if (!updated.length) continue;
    await addCoins(db, memberId, amount, 'voice', { date, minutes: row.vcMinutes });
    awarded.push({ memberId, amount });
  }
  return awarded;
}

/** 直近の活動（新しい日から） */
export async function recentActivity(db: Db, memberId: string, days = 14) {
  return db
    .select()
    .from(activityDaily)
    .where(eq(activityDaily.memberId, memberId))
    .orderBy(desc(activityDaily.date))
    .limit(days);
}
