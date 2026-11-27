import { and, count, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { ema, engawaPairs, members, ujikoKeepState } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { EMA_DAYS_TOGETHER, EMA_MESSAGE_MAX, EMA_MINUTES_PER_DAY, emaFreshSince, emaTierExpires, emaTierFor, type EmaTier } from '../domain/ema.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🎐 絵馬（評価の票）。氏子以上が、条件を満たした相手に贈る。匿名・一言つき・30日で失効。
 * 詳しくは docs/new-system-design.md。
 */

/** 2 人が同じ通話にいた「違う日数」と「合計分」（全期間・ミュートは問わない） */
export async function togetherStats(db: Db, a: string, b: string): Promise<{ days: number; minutes: number }> {
  if (a === b) return { days: 0, minutes: 0 };
  const [x, y] = a < b ? [a, b] : [b, a];
  // 縁側で（2人ともミュートでない）いっしょにいた時間。days＝その日に EMA_MINUTES_PER_DAY 分以上いた日の数
  const [row] = await db
    .select({
      days: sql<number>`count(*) filter (where ${engawaPairs.minutes} >= ${EMA_MINUTES_PER_DAY})::int`,
      minutes: sql<number>`coalesce(sum(${engawaPairs.minutes}), 0)::int`,
    })
    .from(engawaPairs)
    .where(and(eq(engawaPairs.memberA, x), eq(engawaPairs.memberB, y)));
  return { days: row?.days ?? 0, minutes: row?.minutes ?? 0 };
}

/** 票の種類（1つか、いくつか）の条件。失効する種類（参拝者の票）は30日以内のものだけ */
function tierWhere(tiers: EmaTier | readonly EmaTier[], now: Date) {
  const list = Array.isArray(tiers) ? [...tiers] : [tiers as EmaTier];
  const keep = list.filter((t) => !emaTierExpires(t));
  const expiring = list.filter((t) => emaTierExpires(t));
  const parts = [
    ...(keep.length ? [inArray(ema.tier, keep)] : []),
    ...(expiring.length ? [and(inArray(ema.tier, expiring), gte(ema.createdAt, emaFreshSince(now)))!] : []),
  ];
  return parts.length === 1 ? parts[0]! : or(...parts)!;
}

/** 有効な絵馬の枚数（取り消しを除く。氏子の票は失効していないものだけ） */
export async function validEmaCountOf(db: Db, receiverId: string, now = new Date(), tier: EmaTier | readonly EmaTier[] = 'ujiko'): Promise<number> {
  const [row] = await db.select({ n: count() }).from(ema).where(and(eq(ema.receiverId, receiverId), isNull(ema.revokedAt), tierWhere(tier, now)));
  return row?.n ?? 0;
}

/** プロフィールに飾る絵馬の一言（匿名・新しい順）。誰が贈ったかは返さない。 */
export async function emaMessagesOf(db: Db, receiverId: string, now = new Date(), tier: EmaTier | readonly EmaTier[] = 'ujiko'): Promise<{ message: string; createdAt: Date }[]> {
  return db
    .select({ message: ema.message, createdAt: ema.createdAt })
    .from(ema)
    .where(and(eq(ema.receiverId, receiverId), isNull(ema.revokedAt), tierWhere(tier, now)))
    .orderBy(desc(ema.createdAt));
}

export type EmaDenyReason = 'self' | 'no_member' | 'bot' | 'left' | 'staff_alt' | 'giver_not_ujiko' | 'giver_not_sodai' | 'giver_no_rank' | 'sanpai_to_sanpai' | 'receiver_rank' | 'not_together';

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
  const baseTier = emaTierFor({
    giverWeight: giverRank?.weight ?? 0,
    receiverKey,
    ujikoWeight: weightOf('ujiko'),
    sewayakuWeight: weightOf('sewayaku'),
    sodaiWeight: weightOf('sodai'),
    sanpaishaWeight: weightOf('sanpaisha'),
  });
  // 🍂 元氏子（位は参拝者）：参拝者・氏子のどちらにも贈れる。参拝者・元氏子からも贈ってもらえる（参拝者からの絵馬として数える）
  let tier: EmaTier | null = baseTier;
  if (!tier && giverRank?.key === 'sanpaisha' && receiverKey === 'sanpaisha') {
    const moto = new Set((await db.select({ id: ujikoKeepState.memberId }).from(ujikoKeepState).where(and(inArray(ujikoKeepState.memberId, [giverId, receiverId]), eq(ujikoKeepState.state, 'moto')))).map((r) => r.id));
    if (moto.has(receiverId)) tier = 'sanpai';
    else if (moto.has(giverId)) tier = 'ujiko';
  }
  // 贈れない：参拝者より前の人は贈れない・参拝者どうしは贈れない
  if (!tier) return { ok: false, reason: giverRank && receiverKey === 'sanpaisha' ? 'sanpai_to_sanpai' : 'giver_no_rank' };

  const { days, minutes } = await togetherStats(db, giverId, receiverId);
  if (days < EMA_DAYS_TOGETHER) return { ok: false, reason: 'not_together', days, minutes };
  return { ok: true, days, minutes, tier };
}

/**
 * 絵馬を贈る。贈れたら created（新規か贈り直しか）・今の有効枚数・票の種類（tier）を返す。
 * - 票の種類は贈る人と相手の役職で自動で決まる（参拝者・氏子→氏子の票／世話役→総代の票）。
 * - 自分・BOT・退出者・運営サブには贈れない。
 * - 縁側で1日 EMA_MINUTES_PER_DAY 分以上いっしょにいた日が EMA_DAYS_TOGETHER 日以上あること。
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

/**
 * 🎐 その人が絵馬を贈れる相手（縁側で1日30分以上の日が◯日以上・相手の役職で贈れる・まだ贈っていない）と、あと少しの相手。
 * ready＝いま贈れる（縁側の日が多い順）、soon＝あと少し（1日以上・足りない）。在籍・BOT/運営サブをのぞく。
 */
export async function emaPartners(
  db: Db,
  cfg: GuildConfig,
  viewerId: string,
  now = new Date(),
): Promise<{ ready: { id: string; name: string; days: number }[]; soon: { id: string; name: string; days: number }[] }> {
  const rows = await db
    .select({
      a: engawaPairs.memberA,
      b: engawaPairs.memberB,
      days: sql<number>`count(*) filter (where ${engawaPairs.minutes} >= ${EMA_MINUTES_PER_DAY})::int`,
    })
    .from(engawaPairs)
    .where(or(eq(engawaPairs.memberA, viewerId), eq(engawaPairs.memberB, viewerId)))
    .groupBy(engawaPairs.memberA, engawaPairs.memberB);
  const daysOf = new Map(rows.map((r) => [r.a === viewerId ? r.b : r.a, Number(r.days)] as const).filter(([, d]) => d > 0));
  if (!daysOf.size) return { ready: [], soon: [] };
  const ids = [...daysOf.keys(), viewerId];
  const [people, alts, given] = await Promise.all([
    db.select({ id: members.id, name: members.displayName, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt }).from(members).where(inArray(members.id, ids)),
    staffAlts(db),
    db.select({ receiverId: ema.receiverId, tier: ema.tier, createdAt: ema.createdAt }).from(ema).where(and(eq(ema.giverId, viewerId), isNull(ema.revokedAt))),
  ]);
  const viewer = people.find((p) => p.id === viewerId);
  if (!viewer) return { ready: [], soon: [] };
  const skip = new Set(alts.map((a) => a.id));
  const fresh = emaFreshSince(now);
  const done = new Set(given.filter((g) => !emaTierExpires(g.tier as EmaTier) || g.createdAt >= fresh).map((g) => g.receiverId));
  const weightOf = (key: string) => cfg.ranks.find((r) => r.key === key)?.weight;
  const giverWeight = highestRank(cfg.ranks, viewer.roleIds)?.weight ?? 0;
  const ready: { id: string; name: string; days: number }[] = [];
  const soon: { id: string; name: string; days: number }[] = [];
  for (const p of people) {
    if (p.id === viewerId || p.isBot || p.leftAt || skip.has(p.id) || done.has(p.id) || skip.has(viewerId)) continue;
    const tier = emaTierFor({
      giverWeight,
      receiverKey: highestRank(cfg.ranks, p.roleIds)?.key,
      ujikoWeight: weightOf('ujiko'),
      sewayakuWeight: weightOf('sewayaku'),
      sodaiWeight: weightOf('sodai'),
      sanpaishaWeight: weightOf('sanpaisha'),
    });
    if (!tier) continue;
    const days = daysOf.get(p.id) ?? 0;
    (days >= EMA_DAYS_TOGETHER ? ready : soon).push({ id: p.id, name: p.name, days });
  }
  const order = (x: { days: number; name: string }, y: { days: number; name: string }) => y.days - x.days || x.name.localeCompare(y.name, 'ja');
  return { ready: ready.sort(order), soon: soon.sort(order) };
}

/** その人がその相手に贈っている絵馬（取り消し・失効していないもの）。書き直し・取り消しの案内に使う */
export async function myEmaTo(db: Db, giverId: string, receiverId: string, now = new Date()): Promise<{ tier: EmaTier; message: string } | undefined> {
  const rows = await db
    .select({ tier: ema.tier, message: ema.message, createdAt: ema.createdAt })
    .from(ema)
    .where(and(eq(ema.giverId, giverId), eq(ema.receiverId, receiverId), isNull(ema.revokedAt)));
  const fresh = emaFreshSince(now);
  const r = rows.find((x) => !emaTierExpires(x.tier as EmaTier) || x.createdAt >= fresh);
  return r ? { tier: r.tier as EmaTier, message: r.message } : undefined;
}

/**
 * 運営（宮司）が見る、その人が受け取った絵馬の一覧（取り消していないもの・全部の種類・新しい順）。
 * 取り消しに要る giverId と tier を返すが、画面には贈った人の名前を出さない（メンバーには匿名のまま）。
 * valid は、いま票として数えられているか（氏子の票は30日で失効）。
 */
export async function emaEntriesOf(db: Db, receiverId: string, now = new Date()): Promise<{ giverId: string; tier: EmaTier; message: string; createdAt: Date; valid: boolean }[]> {
  const rows = await db
    .select({ giverId: ema.giverId, tier: ema.tier, message: ema.message, createdAt: ema.createdAt })
    .from(ema)
    .where(and(eq(ema.receiverId, receiverId), isNull(ema.revokedAt)))
    .orderBy(desc(ema.createdAt));
  const fresh = emaFreshSince(now);
  return rows.map((r) => {
    const tier = r.tier as EmaTier;
    return { ...r, tier, valid: !emaTierExpires(tier) || r.createdAt >= fresh };
  });
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
