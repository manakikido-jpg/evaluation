import { and, desc, eq, sql } from 'drizzle-orm';
import type { EconomyConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily } from '../db/schema.js';
import { fukuActive } from './buffs.js';
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
  /** コアタイム中なら、10 分ごとに増える分（1 日の上限に数えない）。percentOf: 役職ごとの倍率（%。10 分ごとの量・上限・コアタイムの分にかかる） */
  opts: { coreBonus?: number; percentOf?: (memberId: string) => number } = {},
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

    const pct = Math.max(0, opts.percentOf?.(memberId) ?? 100);
    const scale = (n: number) => Math.round((n * pct) / 100);
    const per10 = scale(economy.voicePer10Min);
    const cap = scale(economy.voiceDailyCap);
    const bonus = scale(Math.max(0, opts.coreBonus ?? 0));
    const amount = Math.max(0, Math.min(per10, cap - row.vcCoins));
    if (amount + bonus <= 0) continue;
    // 上限の判定と加算を同時に行う（二重に渡さない）。今日の枠と花びらは一緒に記録する
    const paid = await db.transaction(async (tx) => {
      let base = 0;
      if (amount > 0) {
        const updated = await tx
          .update(activityDaily)
          .set({ vcCoins: sql`${activityDaily.vcCoins} + ${amount}` })
          .where(
            and(
              eq(activityDaily.memberId, memberId),
              eq(activityDaily.date, date),
              sql`${activityDaily.vcCoins} + ${amount} <= ${cap}`,
            ),
          )
          .returning({ vcCoins: activityDaily.vcCoins });
        if (updated.length) base = amount;
      }
      // 🧧 福の札が効いていれば、ふつうにもらえる分をもう 1 回（上限に数えない）
      const fuku = base > 0 && (await fukuActive(tx, memberId, now)) ? base : 0;
      // 🎙 期間限定の通話ボーナス（ふつうにもらえる分の決めた %。上限に数えない）
      const event = base > 0 && economy.voiceEventPercent > 100 ? Math.floor((base * (economy.voiceEventPercent - 100)) / 100) : 0;
      // コアタイムで増えた分は、上限に届いていてももらえる
      const total = base + bonus + fuku + event;
      if (total <= 0) return 0;
      await addCoins(tx, memberId, total, 'voice', {
        date,
        minutes: row.vcMinutes,
        ...(bonus ? { coreTime: bonus } : {}),
        ...(fuku ? { fuku } : {}),
        ...(event ? { event } : {}),
        ...(pct !== 100 ? { rankPercent: pct } : {}),
      });
      return total;
    });
    if (paid) awarded.push({ memberId, amount: paid });
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
