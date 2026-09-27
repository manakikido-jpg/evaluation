import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, inviteActive, invites, members } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { jstDate } from './activity.js';
import { addCoins } from './economy.js';

/**
 * 招待のお礼。入鯖申請で「招待してくれた人」を選んでもらい、
 * 招待された人が 🔰参拝者 になったとき（承認 → 自己紹介）に、招待した人へお礼の花びらを渡す。
 * 招待された人 1 人につき 1 回だけ（抜けて入り直しても、もう一度は渡さない）。
 */

const isSnowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v);

/** 申請を承認したとき: 招待した人を記録する（前に記録があれば変えない） */
export async function recordInvite(db: Db, memberId: string, inviterId: unknown): Promise<boolean> {
  if (!isSnowflake(inviterId) || inviterId === memberId) return false;
  const rows = await db.insert(invites).values({ memberId, inviterId }).onConflictDoNothing().returning();
  return rows.length > 0;
}

export type InviteRewardResult = { status: 'rewarded'; inviterId: string; amount: number } | { status: 'none' | 'already' | 'inviter_gone' | 'disabled' };

/** 招待された人が 🔰参拝者 になったとき: 招待した人にお礼（1 回だけ） */
export async function rewardInviter(ctx: { db: Db; cfg: GuildConfig; discord: Pick<DiscordActions, 'sendDm'> }, memberId: string, now = new Date()): Promise<InviteRewardResult> {
  const amount = ctx.cfg.economy.inviteReward;
  const [inv] = await ctx.db.select().from(invites).where(eq(invites.memberId, memberId));
  if (!inv) return { status: 'none' };
  if (inv.rewardedAt) return { status: 'already' };
  if (amount <= 0) {
    // お礼はなしでも、参拝者になった日は記録する（浮上のボーナスはここから数える）
    await ctx.db.update(invites).set({ rewardedAt: now, reward: 0 }).where(and(eq(invites.memberId, memberId), isNull(invites.rewardedAt)));
    return { status: 'disabled' };
  }
  // 招待した人がもういない・BOT なら渡さない
  const [inviter] = await ctx.db.select().from(members).where(eq(members.id, inv.inviterId));
  if (!inviter || inviter.leftAt || inviter.isBot) return { status: 'inviter_gone' };
  const done = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(invites)
      .set({ rewardedAt: now, reward: amount })
      .where(and(eq(invites.memberId, memberId), isNull(invites.rewardedAt)))
      .returning();
    if (!row) return false;
    await addCoins(tx, inv.inviterId, amount, 'invite', { memberId });
    return true;
  });
  if (!done) return { status: 'already' };
  const e = ctx.cfg.economy;
  await ctx.discord
    .sendDm(inv.inviterId, `🌸 あなたが招待した <@${memberId}> さんが、咲楽ノ宮に参拝しました（🔰参拝者）。\n招待のお礼に ${e.currencyEmoji}${e.currencyName} を ${amount} 枚お渡ししました。ありがとうございます！`)
    .catch((err: unknown) => logger.warn({ err }, 'invite dm failed'));
  return { status: 'rewarded', inviterId: inv.inviterId, amount };
}

/** 招待した人数（参拝者になった人・まだの人） */
export async function inviteCountOf(db: Db, inviterId: string): Promise<{ joined: number; pending: number }> {
  const [joined] = await db.select({ n: count() }).from(invites).where(and(eq(invites.inviterId, inviterId), isNotNull(invites.rewardedAt)));
  const [all] = await db.select({ n: count() }).from(invites).where(eq(invites.inviterId, inviterId));
  return { joined: joined?.n ?? 0, pending: (all?.n ?? 0) - (joined?.n ?? 0) };
}

/** 招待した人（招待された人から） */
export async function inviterOf(db: Db, memberId: string): Promise<string | undefined> {
  const [row] = await db.select({ inviterId: invites.inviterId }).from(invites).where(eq(invites.memberId, memberId));
  return row?.inviterId;
}

/** 浮上したとみなす通話の分数（発言は 1 回でよい） */
export const ACTIVE_VC_MINUTES = 10;
const DAY = 86_400_000;

/**
 * 10 分ごと: 招待された人が今日浮上していたら（発言した・通話に 10 分いた）、招待した人にボーナス（1 日 1 回）。
 * 招待された人が 🔰参拝者 になってから inviteActiveDays 日の間だけ。どちらかが抜けていたら渡さない。
 */
export async function inviteActiveTick(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ memberId: string; inviterId: string }[]> {
  const amount = cfg.economy.inviteActiveReward;
  if (amount <= 0) return [];
  const date = jstDate(now);
  const since = new Date(now.getTime() - cfg.economy.inviteActiveDays * DAY);
  const rows = await db
    .select({ memberId: invites.memberId, inviterId: invites.inviterId })
    .from(invites)
    .innerJoin(activityDaily, and(eq(activityDaily.memberId, invites.memberId), eq(activityDaily.date, date)))
    .innerJoin(members, eq(members.id, invites.memberId))
    .leftJoin(inviteActive, and(eq(inviteActive.memberId, invites.memberId), eq(inviteActive.date, date)))
    .where(
      and(
        isNotNull(invites.rewardedAt),
        gte(invites.rewardedAt, since),
        isNull(members.leftAt),
        isNull(inviteActive.memberId),
        sql`(${activityDaily.messageCount} > 0 or ${activityDaily.vcMinutes} >= ${ACTIVE_VC_MINUTES})`,
      ),
    );
  const paid: { memberId: string; inviterId: string }[] = [];
  for (const r of rows) {
    const [inviter] = await db.select({ leftAt: members.leftAt, isBot: members.isBot }).from(members).where(eq(members.id, r.inviterId));
    if (!inviter || inviter.leftAt || inviter.isBot) continue;
    const ok = await db.transaction(async (tx) => {
      const [row] = await tx.insert(inviteActive).values({ memberId: r.memberId, date, inviterId: r.inviterId, amount }).onConflictDoNothing().returning();
      if (!row) return false;
      await addCoins(tx, r.inviterId, amount, 'invite_active', { memberId: r.memberId, date });
      return true;
    });
    if (ok) paid.push(r);
  }
  return paid;
}
