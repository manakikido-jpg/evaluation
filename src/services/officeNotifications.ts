import { createHash } from 'node:crypto';
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import { webAccessOf, type GuildConfig, type WebAccess, type WebPage } from '../config.js';
import type { Db } from '../db/client.js';
import { applications, auditLogs, guideReceptions, officeApp, officeSubscriptions, soudan, type AdminSession } from '../db/schema.js';
import { canViewOffice } from '../domain/officeAccess.js';
import { getAccount, accountAccessWithOrg } from './webAccounts.js';
import { loadOrg, orgPagesOf } from './orgChart.js';
import { isStaffAlt } from './staffAlts.js';
import type { DiscordApi } from '../web/discordApi.js';

export const OFFICE_TOPICS = [
  { key: 'applications', label: '申請の対応待ち', page: 'applications', href: '/applications' },
  { key: 'soudan', label: '相談の対応待ち', page: 'soudan', href: '/soudan' },
  { key: 'guide', label: '案内所の対応待ち', page: 'guide', href: '/guide' },
  { key: 'security', label: '重要な警告（過去24時間）', page: 'security', href: '/security' },
] as const;
export type OfficeTopic = typeof OFFICE_TOPICS[number]['key'];
export type OfficeSignal = { key: string; topic: OfficeTopic };
export async function officeSignals(db: Db, now = new Date()): Promise<OfficeSignal[]> {
  const [apps, consultations, guides, alerts] = await Promise.all([
    db.select({ id: applications.id }).from(applications).where(eq(applications.status, 'pending')),
    db.select({ id: soudan.id }).from(soudan).where(eq(soudan.status, 'open')),
    db.select({ id: guideReceptions.id }).from(guideReceptions).where(eq(guideReceptions.status, 'waiting')),
    db.select({ id: auditLogs.id }).from(auditLogs).where(and(gte(auditLogs.at, new Date(now.getTime() - 86400_000)), inArray(auditLogs.action, ['security.raid_start', 'security.role_alert', 'security.role_reverted', 'invite.alert']))),
  ]);
  return [apps, consultations, guides, alerts].flatMap((rows, i) => rows.map(r => ({ key: `${OFFICE_TOPICS[i]!.key}:${r.id}`, topic: OFFICE_TOPICS[i]!.key })));
}
export function allowedSignals(signals: OfficeSignal[], access: { level: string; pages: readonly string[] | null }, topics: readonly string[]) {
  return signals.filter(s => topics.includes(s.topic) && canViewOffice(access, OFFICE_TOPICS.find(t => t.key === s.topic)!.page));
}
export async function ensureOfficeApp(db: Db) {
  const [existing] = await db.select().from(officeApp).where(eq(officeApp.id, 1));
  if (existing) return existing;
  const keys = webpush.generateVAPIDKeys();
  try {
    await db.insert(officeApp).values({ id: 1, publicKey: keys.publicKey, privateKey: keys.privateKey }).onConflictDoNothing();
  } catch {
    // DB例外にはSQLの値が入る場合があるため、秘密鍵を含む元の例外を外へ渡さない。
    throw new Error('通知設定を用意できませんでした。');
  }
  const [row] = await db.select().from(officeApp).where(eq(officeApp.id, 1));
  return row!;
}
/** Web Push の既知の配信先だけ。任意のURL・社内ホストへリクエストしない。 */
export function validPushEndpoint(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && (
      u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
      u.hostname === 'web.push.apple.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname)
    );
  } catch { return false; }
}
export const pushSchema = z.object({
  endpoint: z.string().max(2048).refine(validPushEndpoint),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/) }),
});
export async function subscribeOffice(db: Db, session: AdminSession, input: unknown, topics: string[], now = new Date()) {
  const sub = pushSchema.parse(input);
  const selected = OFFICE_TOPICS.filter(t => topics.includes(t.key) && canViewOffice(session, t.page)).map(t => t.key);
  if (!selected.length) throw new Error('通知する項目を選んでください。');
  const id = createHash('sha256').update(sub.endpoint).digest('hex');
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${session.userId}))`);
    const rows = await tx.select({ id: officeSubscriptions.id }).from(officeSubscriptions).where(eq(officeSubscriptions.userId, session.userId));
    if (rows.length >= 10 && !rows.some(r => r.id === id)) throw new Error('端末は10台までです。古い端末を解除してください。');
    // 同じブラウザで別の運営に切り替えた場合も、前の人の通知を残さない。
    await tx.insert(officeSubscriptions).values({ id, userId: session.userId, accountId: session.accountId, sessionId: session.id, subscription: sub, topics: selected, expiresAt: new Date(now.getTime() + 30 * 86400_000), nextAttemptAt: now }).onConflictDoUpdate({ target: officeSubscriptions.id, set: { userId: session.userId, accountId: session.accountId, sessionId: session.id, subscription: sub, topics: selected, lastKeys: [], expiresAt: new Date(now.getTime() + 30 * 86400_000), nextAttemptAt: now } });
  });
}
export async function unsubscribeOffice(db: Db, session: AdminSession, endpoint?: string) {
  await db.delete(officeSubscriptions).where(and(eq(officeSubscriptions.userId, session.userId), endpoint ? eq(officeSubscriptions.id, createHash('sha256').update(endpoint).digest('hex')) : eq(officeSubscriptions.sessionId, session.id)));
}
export type PushAccess = (owner: { userId: string; accountId: number | null }) => Promise<WebAccess | undefined>;
export function pushAccess(db: Db, cfg: () => GuildConfig, api: DiscordApi): PushAccess {
  return async owner => {
    if (owner.accountId !== null) { const a = await getAccount(db, owner.accountId); return a ? accountAccessWithOrg(db, a) : undefined; }
    if (await isStaffAlt(db, owner.userId)) return undefined;
    const c = cfg();
    const roles = await api.memberRoles(c.guildId, owner.userId);
    return roles ? webAccessOf(c, owner.userId, roles, orgPagesOf(await loadOrg(db), owner.userId)) : undefined;
  };
}
export type PushSend = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;
/** 1分ごとにまとめて1通。失敗時は5分後。通信エラー時は古い権限で送らない。 */
export async function deliverOfficePush(db: Db, accessOf: PushAccess, baseUrl: string, now = new Date(), send: PushSend = webpush.sendNotification) {
  await db.delete(officeSubscriptions).where(lt(officeSubscriptions.expiresAt, now));
  const due = await db.select({ id: officeSubscriptions.id }).from(officeSubscriptions).where(lte(officeSubscriptions.nextAttemptAt, now)).limit(200);
  if (!due.length) return;
  const signals = await officeSignals(db, now);
  const keys = await ensureOfficeApp(db);
  for (const candidate of due) await db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${candidate.id})) as locked`) as { rows: { locked: boolean }[] };
    if (!(lock.rows[0] as { locked: boolean } | undefined)?.locked) return;
    const [sub] = await tx.select().from(officeSubscriptions).where(eq(officeSubscriptions.id, candidate.id));
    if (!sub || sub.nextAttemptAt > now) return;
    try {
      const access = await accessOf(sub);
      if (!access) { await tx.delete(officeSubscriptions).where(eq(officeSubscriptions.id, sub.id)); return; }
      const visible = allowedSignals(signals, access, sub.topics);
      const fresh = visible.filter(s => !sub.lastKeys.includes(s.key));
      if (fresh.length) {
        // ロック画面には人名・本文・件数・種類を載せない。開いた先で権限をもう一度確認する。
        if (!validPushEndpoint(sub.subscription.endpoint)) throw new Error('invalid endpoint');
        await send(sub.subscription, JSON.stringify({ title: '咲楽ノ宮 社務所', body: '確認が必要なお知らせがあります。社務所を開いて確認してください。', url: '/office/app' }), { TTL: 300, timeout: 5000, vapidDetails: { subject: new URL(baseUrl).origin, publicKey: keys.publicKey, privateKey: keys.privateKey } });
      }
      await tx.update(officeSubscriptions).set({ lastKeys: visible.map(s => s.key), nextAttemptAt: new Date(now.getTime() + 60_000) }).where(eq(officeSubscriptions.id, sub.id));
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await tx.delete(officeSubscriptions).where(eq(officeSubscriptions.id, sub.id));
      else await tx.update(officeSubscriptions).set({ nextAttemptAt: new Date(now.getTime() + 300_000) }).where(eq(officeSubscriptions.id, sub.id));
    }
  });
}
