import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invites, members, settings } from '../db/schema.js';
import { audit } from './audit.js';
import { inviteBlocks, isInviteBlocked } from './inviteBlock.js';

/**
 * 🚨 招待の急増を見張る。共通リンクはのぞき、メンバーの招待リンクで短い間にたくさん入ったら「警戒」にする。
 * - ⚠️ 警戒: 10 分で 5 人以上
 * - 🚨 超警戒: 20 分で 10 人以上
 * 警戒の人から招待された人と、「招待を作れない人」のリンクで入った人には「案内停止」ロールを付ける。
 */
export const INVITE_ALERT_RULES = [
  { level: 'severe', minutes: 20, count: 10, label: '🚨 超警戒' },
  { level: 'warn', minutes: 10, count: 5, label: '⚠️ 警戒' },
] as const;
export type InviteAlertLevel = (typeof INVITE_ALERT_RULES)[number]['level'];
export type InviteAlert = { id: string; level: InviteAlertLevel; at: string; count: number };
export const GUIDE_HOLD_ROLE_NAME = '案内停止';
const KEY = 'invite.alert';
const rank = (l?: InviteAlertLevel) => (l === 'severe' ? 2 : l === 'warn' ? 1 : 0);
export const alertLabel = (l: InviteAlertLevel) => INVITE_ALERT_RULES.find((r) => r.level === l)!.label;

export async function inviteAlerts(db: Db): Promise<InviteAlert[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = row?.value as { list?: unknown } | undefined;
  return Array.isArray(v?.list) ? (v.list as InviteAlert[]).filter((x) => typeof x?.id === 'string') : [];
}

/** その人の招待で、この何分の間に入った人（メンバーの招待リンクで入った分だけ） */
async function recentInvitees(db: Db, inviterId: string, minutes: number, now: Date): Promise<string[]> {
  const rows = await db.select({ id: invites.memberId }).from(invites)
    .where(and(eq(invites.inviterId, inviterId), eq(invites.source, 'link'), gte(invites.createdAt, new Date(now.getTime() - minutes * 60_000))));
  return rows.map((r) => r.id);
}

/**
 * 入った人の招待した人を調べる。警戒の段階が上がったら記録して、その間に入った人（ロールを付ける相手）を返す
 */
export async function checkInviteBurst(db: Db, inviterId: string, now = new Date()): Promise<{ level: InviteAlertLevel; count: number; invitees: string[] } | undefined> {
  for (const rule of INVITE_ALERT_RULES) {
    const ids = await recentInvitees(db, inviterId, rule.minutes, now);
    if (ids.length < rule.count) continue;
    const raised = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
      const list = await inviteAlerts(tx);
      const prev = list.find((a) => a.id === inviterId);
      if (rank(prev?.level) >= rank(rule.level)) return false;
      const next = [...list.filter((a) => a.id !== inviterId), { id: inviterId, level: rule.level, at: now.toISOString(), count: ids.length }];
      await tx.insert(settings).values({ key: KEY, value: { list: next }, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value: { list: next }, updatedBy: 'system', updatedAt: now } });
      await audit(tx, { actorId: 'system', targetId: inviterId, action: 'invite.alert', detail: { level: rule.level, count: ids.length }, via: 'discord' });
      return true;
    });
    return raised ? { level: rule.level, count: ids.length, invitees: ids } : undefined;
  }
  return undefined;
}

/** 警戒を外す（運営が確かめたあと） */
export async function clearInviteAlert(db: Db, inviterId: string, by: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${KEY}))`);
    const list = await inviteAlerts(tx);
    if (!list.some((a) => a.id === inviterId)) return false;
    const next = list.filter((a) => a.id !== inviterId);
    await tx.insert(settings).values({ key: KEY, value: { list: next }, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value: { list: next }, updatedBy: by, updatedAt: new Date() } });
    await audit(tx, { actorId: by, targetId: inviterId, action: 'invite.alert_clear', detail: {}, via: 'web' });
    return true;
  });
}

/** この人の招待で入った人に「案内停止」を付けるか（警戒中・招待を作れない人） */
export async function holdsGuide(db: Db, inviterId: string): Promise<'alert' | 'blocked' | undefined> {
  if ((await inviteAlerts(db)).some((a) => a.id === inviterId)) return 'alert';
  if (await isInviteBlocked(db, inviterId)) return 'blocked';
  return undefined;
}

/**
 * 👁 要注意の人か（見張る人・警戒中の人に招待された人）。本人には知らせず、ロールも付けない。
 * 案内所に入ったら、案内人ではなく運営だけに知らせる
 */
export async function watchReason(db: Db, memberId: string): Promise<{ inviterId: string; why: 'alert' | 'blocked' } | undefined> {
  const [row] = await db.select({ inviterId: invites.inviterId }).from(invites).where(eq(invites.memberId, memberId));
  if (!row) return undefined;
  const why = await holdsGuide(db, row.inviterId);
  return why ? { inviterId: row.inviterId, why } : undefined;
}

/** 👁 いまサーバーにいる要注意の人（社務所Web の一覧用） */
export async function watchedMembers(db: Db): Promise<{ memberId: string; inviterId: string }[]> {
  const ids = [...new Set([...(await inviteAlerts(db)).map((a) => a.id), ...(await inviteBlocks(db)).map((b) => b.id)])];
  if (!ids.length) return [];
  return db.select({ memberId: invites.memberId, inviterId: invites.inviterId }).from(invites)
    .innerJoin(members, eq(members.id, invites.memberId))
    .where(and(inArray(invites.inviterId, ids), isNull(members.leftAt))).limit(500);
}
