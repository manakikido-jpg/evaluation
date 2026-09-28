import { and, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, inviteActive, inviteLinks, invites, members, type Invite, type InviteLink } from '../db/schema.js';
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

/**
 * 招待した人を記録する（前に記録があれば変えない）。
 * link: その人の招待リンクで入った（入ったとき）／ answer: 申請で選んだ（承認したとき）
 */
export async function recordInvite(db: Db, memberId: string, inviterId: unknown, source: 'answer' | 'link' = 'answer'): Promise<boolean> {
  if (!isSnowflake(inviterId) || inviterId === memberId) return false;
  const rows = await db.insert(invites).values({ memberId, inviterId, source }).onConflictDoNothing().returning();
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
  return (await inviteOf(db, memberId))?.inviterId;
}

/** 招待の記録（だれが・リンクか申請か） */
export async function inviteOf(db: Db, memberId: string): Promise<{ inviterId: string; source: string } | undefined> {
  const [row] = await db.select({ inviterId: invites.inviterId, source: invites.source }).from(invites).where(eq(invites.memberId, memberId));
  return row;
}

// ───────── BOT が作る招待リンク ─────────

/** その人の今の招待リンク */
export async function activeLinkOf(db: Db, inviterId: string): Promise<InviteLink | undefined> {
  const [row] = await db
    .select()
    .from(inviteLinks)
    .where(and(eq(inviteLinks.inviterId, inviterId), isNull(inviteLinks.revokedAt)))
    .orderBy(desc(inviteLinks.createdAt))
    .limit(1);
  return row;
}

export async function saveLink(db: Db, link: { code: string; inviterId: string; channelId: string; uses: number; label?: string | null; createdBy?: string | null }): Promise<void> {
  await db.insert(inviteLinks).values(link).onConflictDoUpdate({ target: inviteLinks.code, set: { uses: link.uses, revokedAt: null } });
}

// ───────── 社務所Web の「招待」 ─────────

/** BOT が作った、今使える招待リンク（メンバーのものと共通のもの）。新しい順 */
export async function liveLinks(db: Db): Promise<InviteLink[]> {
  return db.select().from(inviteLinks).where(isNull(inviteLinks.revokedAt)).orderBy(desc(inviteLinks.createdAt));
}

/** BOT が作ったことのあるリンクのコード（消したものも） */
export async function knownLinkCodes(db: Db): Promise<Set<string>> {
  return new Set((await db.select({ code: inviteLinks.code }).from(inviteLinks)).map((r) => r.code));
}

/** だれがだれを招待したか（新しい順） */
export async function recentInviteJoins(db: Db, limit = 200): Promise<Invite[]> {
  return db.select().from(invites).orderBy(desc(invites.createdAt)).limit(limit);
}

/** リンクを使えなくしたと記録する（メンバーのものも共通のものも） */
export async function revokeLink(db: Db, code: string, now = new Date()): Promise<boolean> {
  const rows = await db.update(inviteLinks).set({ revokedAt: now }).where(and(eq(inviteLinks.code, code), isNull(inviteLinks.revokedAt))).returning();
  return rows.length > 0;
}

/** 運営が作る共通の招待リンク（SNS・ポスター用など）の持ち主。だれの招待にもならない */
export const SHARED_INVITER = 'shared';

/** 共通の招待リンク（使えるもの）。新しい順 */
export async function sharedLinks(db: Db): Promise<InviteLink[]> {
  return db
    .select()
    .from(inviteLinks)
    .where(and(eq(inviteLinks.inviterId, SHARED_INVITER), isNull(inviteLinks.revokedAt)))
    .orderBy(desc(inviteLinks.createdAt));
}

/** 名前が同じ共通リンク（名前なしどうしも同じとみなす） */
export async function sharedLinkNamed(db: Db, label: string | null): Promise<InviteLink | undefined> {
  return (await sharedLinks(db)).find((l) => (l.label ?? '') === (label ?? ''));
}

/** 共通リンクを使えなくしたと記録する */
export async function revokeSharedLink(db: Db, code: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(inviteLinks)
    .set({ revokedAt: now })
    .where(and(eq(inviteLinks.code, code), eq(inviteLinks.inviterId, SHARED_INVITER), isNull(inviteLinks.revokedAt)))
    .returning();
  return rows.length > 0;
}

/** https://discord.gg/abc・discord.com/invite/abc・abc のどれでもコードにする */
export function inviteCodeOf(text: string): string {
  const t = text.trim();
  const m = t.match(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i);
  return m ? m[1]! : t.replace(/^\/+|\/+$/g, '');
}

/**
 * だれかが入ったとき: 今の招待リンクの使われた回数と、覚えている回数を比べて、増えたリンクの持ち主を返す。
 * 増えたリンクが 1 つだけのときだけ（同時に入ったなど、分からなければ undefined）。回数は覚え直し、Discord にないリンクは無効にする。
 */
export async function matchJoin(db: Db, current: { code: string; uses: number }[], now = new Date()): Promise<string | undefined> {
  const stored = await db.select().from(inviteLinks).where(isNull(inviteLinks.revokedAt));
  const byCode = new Map(current.map((c) => [c.code, c.uses]));
  const grew: InviteLink[] = [];
  for (const s of stored) {
    const uses = byCode.get(s.code);
    if (uses === undefined) {
      await db.update(inviteLinks).set({ revokedAt: now }).where(eq(inviteLinks.code, s.code));
      continue;
    }
    if (uses > s.uses) grew.push(s);
    if (uses !== s.uses) await db.update(inviteLinks).set({ uses }).where(eq(inviteLinks.code, s.code));
  }
  return grew.length === 1 ? grew[0]!.inviterId : undefined;
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
