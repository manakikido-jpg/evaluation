import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { ema, members, voicePairs } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { EMA_DAYS_TOGETHER, EMA_MESSAGE_MAX, EMA_MINUTES_TOGETHER, emaFreshSince, emaTierExpires, emaTierFor, type EmaTier } from '../domain/ema.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🎐 絵馬（評価の票）。氏子以上が、条件を満たした相手に贈る。匿名・一言つき・30日で失効。
 * 詳しくは docs/new-system-design.md。
 */

/** 2 人が同じ通話にいた「違う日数」と「合計分」（全期間・ミュートは問わない） */
export async function togetherStats(db: Db, a: string, b: string): Promise<{ days: number; minutes: number }> {
  if (a === b) return { days: 0, minutes: 0 };
  const [x, y] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select({
      days: sql<number>`count(distinct ${voicePairs.date})::int`,
      minutes: sql<number>`coalesce(sum(${voicePairs.minutes}), 0)::int`,
    })
    .from(voicePairs)
    .where(and(eq(voicePairs.memberA, x), eq(voicePairs.memberB, y)));
  return { days: row?.days ?? 0, minutes: row?.minutes ?? 0 };
}

/** 有効な絵馬の枚数（取り消しを除く。氏子の票は失効していないものだけ） */
export async function validEmaCountOf(db: Db, receiverId: string, now = new Date(), tier: EmaTier = 'ujiko'): Promise<number> {
  const conds = [eq(ema.receiverId, receiverId), eq(ema.tier, tier), isNull(ema.revokedAt)];
  if (emaTierExpires(tier)) conds.push(gte(ema.createdAt, emaFreshSince(now)));
  const [row] = await db.select({ n: count() }).from(ema).where(and(...conds));
  return row?.n ?? 0;
}

/** プロフィールに飾る絵馬の一言（匿名・新しい順）。誰が贈ったかは返さない。 */
export async function emaMessagesOf(db: Db, receiverId: string, now = new Date(), tier: EmaTier = 'ujiko'): Promise<{ message: string; createdAt: Date }[]> {
  const conds = [eq(ema.receiverId, receiverId), eq(ema.tier, tier), isNull(ema.revokedAt)];
  if (emaTierExpires(tier)) conds.push(gte(ema.createdAt, emaFreshSince(now)));
  const rows = await db
    .select({ message: ema.message, createdAt: ema.createdAt })
    .from(ema)
    .where(and(...conds))
    .orderBy(desc(ema.createdAt));
  return rows;
}

export type EmaDenyReason = 'self' | 'no_member' | 'bot' | 'left' | 'staff_alt' | 'giver_not_ujiko' | 'giver_not_sodai' | 'receiver_rank' | 'not_together';

export type EmaCheck =
  | { ok: true; days: number; minutes: number; tier: EmaTier }
  | { ok: false; reason: EmaDenyReason; days?: number; minutes?: number };

export type GiveEmaResult =
  | { ok: true; created: boolean; count: number; days: number; minutes: number; tier: EmaTier }
  | { ok: false; reason: EmaDenyReason; days?: number; minutes?: number };

/**
 * 絵馬を贈れるか確かめるだけ（書きこまない）。入口のモーダルを出す前の確認に使う。
 * 贈る票の種類（tier）は、贈る人と相手の役職で自動で決まる（emaTierFor）。
 * 条件は giveEma と同じ（位・相手の位・いっしょにいた時間）。
 */
export async function checkGiveEma(
  db: Db,
  cfg: GuildConfig,
  giverId: string,
  receiverId: string,
): Promise<EmaCheck> {
  if (giverId === receiverId) return { ok: false, reason: 'self' };
  const rows = await db
    .select({ id: members.id, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt })
    .from(members)
    .where(sql`${members.id} in (${giverId}, ${receiverId})`);
  const giver = rows.find((r) => r.id === giverId);
  const receiver = rows.find((r) => r.id === receiverId);
  if (!giver || !receiver) return { ok: false, reason: 'no_member' };
  if (receiver.isBot || giver.isBot) return { ok: false, reason: 'bot' };
  if (receiver.leftAt) return { ok: false, reason: 'left' };
  const alts = new Set((await staffAlts(db)).map((a) => a.id));
  if (alts.has(giverId) || alts.has(receiverId)) return { ok: false, reason: 'staff_alt' };

  const weightOf = (key: string) => cfg.ranks.find((r) => r.key === key)?.weight;
  const giverRank = highestRank(cfg.ranks, giver.roleIds);
  const receiverRank = highestRank(cfg.ranks, receiver.roleIds);
  const receiverKey = receiverRank?.key;
  // 相手の位：参拝者・氏子・世話役だけが受け取れる（総代以上・役職なしは不可）
  if (receiverKey !== 'sanpaisha' && receiverKey !== 'ujiko' && receiverKey !== 'sewayaku') {
    return { ok: false, reason: 'receiver_rank' };
  }
  const tier = emaTierFor({
    giverWeight: giverRank?.weight ?? 0,
    receiverKey,
    ujikoWeight: weightOf('ujiko'),
    sewayakuWeight: weightOf('sewayaku'),
    sodaiWeight: weightOf('sodai'),
  });
  // 贈る側の位が足りない：世話役へは総代・運営だけ、それ以外は氏子以上
  if (!tier) return { ok: false, reason: receiverKey === 'sewayaku' ? 'giver_not_sodai' : 'giver_not_ujiko' };

  const { days, minutes } = await togetherStats(db, giverId, receiverId);
  if (days < EMA_DAYS_TOGETHER || minutes < EMA_MINUTES_TOGETHER) return { ok: false, reason: 'not_together', days, minutes };
  return { ok: true, days, minutes, tier };
}

/**
 * 絵馬を贈る。贈れたら created（新規か贈り直しか）・今の有効枚数・票の種類（tier）を返す。
 * - 票の種類は贈る人と相手の役職で自動で決まる（参拝者→氏子の票／氏子→世話役の票または氏子の票／世話役→総代の票）。
 * - 自分・BOT・退出者・運営サブには贈れない。
 * - 相手と違う日に EMA_DAYS_TOGETHER 日以上・合計 EMA_MINUTES_TOGETHER 分以上いっしょにいたこと。
 * - 同じ相手・同じ種類への票は 1 枚。贈り直すと一言と期限（created_at）を新しくする。
 */
export async function giveEma(
  db: Db,
  cfg: GuildConfig,
  giverId: string,
  receiverId: string,
  message: string,
  now = new Date(),
): Promise<GiveEmaResult> {
  const check = await checkGiveEma(db, cfg, giverId, receiverId);
  if (!check.ok) return check;
  const { days, minutes, tier } = check;

  const [existing] = await db
    .select({ revokedAt: ema.revokedAt })
    .from(ema)
    .where(and(eq(ema.giverId, giverId), eq(ema.receiverId, receiverId), eq(ema.tier, tier)));
  const created = !existing || existing.revokedAt !== null;
  const text = message.trim().slice(0, EMA_MESSAGE_MAX);
  await db
    .insert(ema)
    .values({ giverId, receiverId, tier, message: text, createdAt: now, revokedAt: null })
    .onConflictDoUpdate({ target: [ema.giverId, ema.receiverId, ema.tier], set: { message: text, createdAt: now, revokedAt: null } });
  const total = await validEmaCountOf(db, receiverId, now, tier);
  return { ok: true, created, count: total, days, minutes, tier };
}

/** 絵馬を取り消す（運営用）。あれば true。 */
export async function revokeEma(db: Db, giverId: string, receiverId: string, now = new Date(), tier: EmaTier = 'ujiko'): Promise<boolean> {
  const res = await db
    .update(ema)
    .set({ revokedAt: now })
    .where(and(eq(ema.giverId, giverId), eq(ema.receiverId, receiverId), eq(ema.tier, tier), isNull(ema.revokedAt)))
    .returning({ giverId: ema.giverId });
  return res.length > 0;
}
