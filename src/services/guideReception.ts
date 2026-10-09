import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { employeePayroll, guideEmployees, guideReceptions, settings } from '../db/schema.js';
import { addCoins } from './economy.js';
import { audit } from './audit.js';

const snowflake = z.string().regex(/^\d{17,20}$/);
export const GUIDE_LINKS = [
  ['1557360345054715924', '1553189423200473188'],
  ['1557360442022559825', '1553189424697970738'],
  ['1557360568879419392', '1557053092283818094'],
  ['1557360649506394182', '1556682563836186634'],
  ['1557360704414023751', '1556685944717971456'],
  ['1557360917057110046', '1553189433052889238', '1553487265525923971'],
].map(([emojiId, ...channelIds], i) => ({ emojiId: emojiId!, emojiName: `a_00${i + 1}`, channelIds }));
export const guideConfigSchema = z.object({
  voiceChannelIds: z.array(snowflake).max(20).default([]), staffChannelId: snowflake.optional(), roleId: snowflake.optional(),
  salary: z.number().int().min(0).max(1_000_000).default(150),
  links: z.array(z.object({ emojiId: snowflake, emojiName: z.string().regex(/^\w{1,32}$/), channelIds: z.array(snowflake).min(1).max(3) })).max(10).default(GUIDE_LINKS),
});
/** 絵文字とDiscordのチャンネルリンクを、そのまま設定欄に貼れる */
export function parseGuideLinks(body: Record<string, unknown>): GuideConfig['links'] {
  if (typeof body.bulkLinks === 'string' && body.bulkLinks.trim()) {
    const rows = body.bulkLinks.trim().split(/\r?\n/).filter(line => line.trim());
    if (rows.length > 10) throw new Error('案内は10行までです');
    const pasted: Record<string, unknown> = {};
    rows.forEach((line, n) => {
      const match = /^\s*(<a?:[a-zA-Z0-9_]{1,32}:\d{17,20}>)\s+(.+)$/.exec(line);
      if (!match) throw new Error('案内文を確認してください');
      pasted[`emoji_${n}`] = match[1];
      pasted[`links_${n}`] = match[2]!.replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
    });
    return parseGuideLinks(pasted);
  }
  const links: GuideConfig['links'] = [];
  for (let n = 0; n < 10; n++) {
    const emoji = String(body[`emoji_${n}`] ?? '').trim();
    const targets = String(body[`links_${n}`] ?? '').trim();
    if (!emoji && !targets) continue;
    const match = /^<a?:([a-zA-Z0-9_]{1,32}):(\d{17,20})>$/.exec(emoji);
    if (!match) throw new Error('絵文字を確認してください');
    const channelIds = targets.split(/\s+/).map(t => {
      const url = /^https:\/\/discord\.com\/channels\/\d{17,20}\/(\d{17,20})\/?$/.exec(t);
      const mention = /^<#(\d{17,20})>$/.exec(t);
      return url?.[1] ?? mention?.[1] ?? t;
    });
    links.push({ emojiId: match[2]!, emojiName: match[1]!, channelIds });
  }
  return guideConfigSchema.shape.links.parse(links);
}
export type GuideConfig = z.infer<typeof guideConfigSchema>;
export async function loadGuideConfig(db: Db): Promise<GuideConfig> {
  const [r] = await db.select().from(settings).where(eq(settings.key, 'guide_reception'));
  const parsed = guideConfigSchema.safeParse(r?.value ?? {});
  return parsed.success ? parsed.data : guideConfigSchema.parse({});
}
export async function saveGuideConfig(db: Db, config: GuideConfig, by: string) {
  const value = guideConfigSchema.parse(config);
  await db.insert(settings).values({ key: 'guide_reception', value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  await audit(db, { actorId: by, action: 'guide.settings', via: 'web' });
}
/** 「案内人の受付」のパネルを出したチャンネル（いちばん下に置き直す） */
const PANEL_KEY = 'guide_panel_channels';
export async function guidePanelChannels(db: Db): Promise<string[]> {
  const [r] = await db.select().from(settings).where(eq(settings.key, PANEL_KEY));
  const v = r?.value as { channelIds?: unknown } | undefined;
  return Array.isArray(v?.channelIds) ? v.channelIds.filter((x): x is string => typeof x === 'string' && /^\d{17,20}$/.test(x)) : [];
}
export async function addGuidePanelChannel(db: Db, channelId: string, by = 'system') {
  const cur = await guidePanelChannels(db);
  if (cur.includes(channelId)) return;
  const value = { channelIds: [...cur, channelId].slice(-10) };
  await db.insert(settings).values({ key: PANEL_KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}
export async function registerGuide(db: Db, memberId: string) {
  await db.insert(guideEmployees).values({ memberId }).onConflictDoNothing();
}
export async function setGuideStatus(db: Db, memberId: string, status: 'active' | 'paused', by: string) {
  await db.update(guideEmployees).set({ status, waiting: false }).where(eq(guideEmployees.memberId, memberId));
  await audit(db, { actorId: by, targetId: memberId, action: `guide.${status}`, via: 'web' });
}
export async function setGuideWaiting(db: Db, memberId: string, waiting: boolean) {
  return (await db.update(guideEmployees).set({ waiting }).where(and(eq(guideEmployees.memberId, memberId), eq(guideEmployees.status, 'active'))).returning()).length > 0;
}
export async function openGuideReception(db: Db, visitorId: string, channelId: string, now = new Date()) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`guide:${visitorId}`}))`);
    const [last] = await tx.select().from(guideReceptions).where(eq(guideReceptions.visitorId, visitorId)).orderBy(desc(guideReceptions.id)).limit(1);
    if (last && !last.departedAt) return undefined;
    // 出入りを繰り返しても通知を増やさない
    if (last && now.getTime() - last.createdAt.getTime() < 10 * 60_000) return undefined;
    const [r] = await tx.insert(guideReceptions).values({ visitorId, channelId, createdAt: now }).returning();
    return r;
  });
}
export async function assignGuide(db: Db, id: number, memberId: string) {
  return db.transaction(async tx => {
    const [e] = await tx.select().from(guideEmployees).where(eq(guideEmployees.memberId, memberId));
    if (e?.status !== 'active') return undefined;
    const [r] = await tx.update(guideReceptions).set({ status: 'assigned', guideId: memberId }).where(and(eq(guideReceptions.id, id), eq(guideReceptions.status, 'waiting'), sql`${guideReceptions.visitorId} <> ${memberId}`)).returning();
    return r;
  });
}
export async function leaveGuideReception(db: Db, visitorId: string, now = new Date()) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`guide:${visitorId}`}))`);
    await tx.update(guideReceptions).set({ departedAt: now }).where(and(eq(guideReceptions.visitorId, visitorId), isNull(guideReceptions.departedAt)));
    return tx.update(guideReceptions).set({ status: 'left', finishedAt: now }).where(and(eq(guideReceptions.visitorId, visitorId), inArray(guideReceptions.status, ['waiting', 'assigned']))).returning();
  });
}
export async function completeGuide(db: Db, id: number, memberId: string, now = new Date()) {
  const config = await loadGuideConfig(db);
  return db.transaction(async tx => {
    const [e] = await tx.select().from(guideEmployees).where(eq(guideEmployees.memberId, memberId));
    if (e?.status !== 'active') return undefined;
    const [r] = await tx.update(guideReceptions).set({ status: 'done', finishedAt: now }).where(and(eq(guideReceptions.id, id), eq(guideReceptions.guideId, memberId), eq(guideReceptions.status, 'assigned'))).returning();
    if (!r) return undefined;
    const date = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
    let amount = 0;
    if (config.salary > 0) {
      const [p] = await tx.insert(employeePayroll).values({ memberId, job: 'guide', sourceId: String(id), visitorId: r.visitorId, date, amount: config.salary }).onConflictDoNothing().returning();
      if (p) { amount = p.amount; await addCoins(tx, memberId, amount, 'employee_salary', { job: 'guide', receptionId: id }); }
    }
    await audit(tx as Db, { actorId: memberId, targetId: r.visitorId, action: 'guide.complete', detail: { receptionId: id, amount }, via: 'discord' });
    return { reception: r, amount };
  });
}
