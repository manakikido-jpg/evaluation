import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { galleryRewards, members, settings, type GalleryReward } from '../db/schema.js';
import { DiscordHttpError, type DiscordActions, type GalleryMessage, type GuildChannel } from '../lib/discordRest.js';
import { addCoins } from './economy.js';
import { audit } from './audit.js';
import { logger } from '../lib/logger.js';

export const GALLERY_KINDS = ['full', 'half', 'song', 'voice'] as const;
export type GalleryKind = typeof GALLERY_KINDS[number];
export const GALLERY_LABEL: Record<GalleryKind, string> = { full: '全顔', half: '半顔', song: 'うたみた', voice: 'サプボ' };
const price = z.number().int().min(0).max(10000);
export const galleryPricesSchema = z.object({ full: price.default(150), half: price.default(75), song: price.default(150), voice: price.default(150) }).strict();
export type GalleryPrices = z.infer<typeof galleryPricesSchema>;
const KEY = 'gallery_reward_prices';
const DAY = 86400000;
const JST = 9 * 3600000;
export class GalleryError extends Error {}
/** 金曜23:59:59.999まで。日曜の終了＝翌月曜0時に支払える。 */
export function galleryPeriod(posted: Date) {
  const local = new Date(posted.getTime() + JST);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const weekday = (local.getUTCDay() + 6) % 7;
  const monday = midnight - weekday * DAY;
  return { eligible: Number.isFinite(posted.getTime()) && weekday < 5,
    day: new Date(midnight).toISOString().slice(0, 10), week: new Date(monday).toISOString().slice(0, 10),
    dueAt: new Date(monday - JST + 7 * DAY) };
}
export async function loadGalleryPrices(db: Db): Promise<GalleryPrices> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return galleryPricesSchema.parse(row?.value ?? {});
}
export async function saveGalleryPrices(db: Db, input: unknown, by: string) {
  const value = galleryPricesSchema.parse(input);
  await db.transaction(async tx => {
    await tx.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    await audit(tx, { actorId: by, action: 'gallery.prices', detail: value, via: 'web' });
  });
}
export function galleryLink(raw: string, guildId: string) {
  const m = /^https:\/\/(?:www\.)?discord\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/.exec(raw.trim());
  if (!m || m[1] !== guildId) throw new GalleryError('このサーバーの投稿リンクを入れてください。');
  return { channelId: m[2]!, messageId: m[3]! };
}
const attachmentIds = (m: GalleryMessage, kind: GalleryKind) => m.attachments.filter(a =>
  kind === 'full' || kind === 'half' ? a.content_type?.startsWith('image/') : /^(audio|video)\//.test(a.content_type ?? '')
).map(a => a.id).sort();
export function sameGalleryPost(row: GalleryReward, message: GalleryMessage) {
  return message.id === row.messageId && message.channel_id === row.channelId && message.author.id === row.memberId && !message.author.bot &&
    new Date(message.timestamp).getTime() === row.postedAt.getTime() &&
    row.attachmentIds.length > 0 && row.attachmentIds.every(id => attachmentIds(message, row.kind as GalleryKind).includes(id));
}
export async function registerGalleryPost(db: Db, discord: DiscordActions, guildId: string, channels: GuildChannel[], link: string, kind: GalleryKind, by: string, now = new Date()) {
  if (!GALLERY_KINDS.includes(kind)) throw new GalleryError('区分を選んでください。');
  const { channelId, messageId } = galleryLink(link, guildId);
  const channel = channels.find(c => c.id === channelId && (c.type === 0 || c.type === 5));
  const name = channel?.name.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
  if (!name?.endsWith(kind === 'full' || kind === 'half' ? '写真館' : '動画館')) throw new GalleryError('写真は写真館、うたみた・サプボは動画館の投稿を選んでください。');
  if (!discord.galleryMessage) throw new GalleryError('Discordの投稿を確認できません。');
  const message = await discord.galleryMessage(channelId, messageId);
  const postedAt = new Date(message.timestamp);
  if (!Number.isFinite(postedAt.getTime())) throw new GalleryError('投稿日時を確認できません。');
  const period = galleryPeriod(postedAt);
  if (!period.eligible || postedAt > now || now >= period.dueAt) throw new GalleryError('月曜〜金曜の投稿を、同じ週の日曜が終わるまでに登録してください。');
  const ids = attachmentIds(message, kind);
  if (message.id !== messageId || message.channel_id !== channelId || message.author.bot || !ids.length) throw new GalleryError('対象の画像・音声・動画の添付がある本人の投稿を選んでください。');
  const [member] = await db.select().from(members).where(eq(members.id, message.author.id));
  if (!member || member.leftAt || member.isBot) throw new GalleryError('在籍中のメンバーを確認できません。');
  const amount = (await loadGalleryPrices(db))[kind];
  if (!amount) throw new GalleryError('この区分の報酬は0銭です。');
  const rows = await db.insert(galleryRewards).values({ messageId, channelId, memberId: member.id, kind, amount, postedAt,
    day: period.day, week: period.week, dueAt: period.dueAt, attachmentIds: ids, checkedBy: by }).onConflictDoNothing().returning();
  if (!rows.length) throw new GalleryError('この投稿は登録済みです。');
  await audit(db, { actorId: by, targetId: member.id, action: 'gallery.register', detail: { messageId, kind, amount }, via: 'web' });
}
export const recentGalleryPosts = (db: Db) => db.select().from(galleryRewards).orderBy(desc(galleryRewards.createdAt), desc(galleryRewards.messageId)).limit(100);
export async function invalidateGalleryPosts(db: Db, ids: string[], now = new Date()) {
  if (!ids.length) return;
  await db.update(galleryRewards).set({ status: 'removed', settledAt: now }).where(and(inArray(galleryRewards.messageId, ids), eq(galleryRewards.status, 'pending')));
}
export async function cancelGalleryPost(db: Db, messageId: string, by: string, now = new Date()) {
  await db.transaction(async tx => {
    const rows = await tx.update(galleryRewards).set({ status: 'cancelled', settledAt: now }).where(and(eq(galleryRewards.messageId, messageId), eq(galleryRewards.status, 'pending'))).returning();
    if (rows.length) await audit(tx, { actorId: by, action: 'gallery.cancel', detail: { messageId }, via: 'web' });
  });
}
/** 同じ人・週はメンバー行で直列化。残存確認で通信エラーなら、その人の週全体を保留する。 */
export async function settleGalleryRewards(db: Db, discord: DiscordActions, now = new Date()) {
  if (!discord.galleryMessage) return;
  const groups = await db.selectDistinct({ memberId: galleryRewards.memberId, week: galleryRewards.week }).from(galleryRewards)
    .where(and(eq(galleryRewards.status, 'pending'), lte(galleryRewards.dueAt, now))).limit(50);
  for (const group of groups) {
    try {
      const scope = and(eq(galleryRewards.memberId, group.memberId), eq(galleryRewards.week, group.week));
      const pending = await db.select().from(galleryRewards).where(and(scope, eq(galleryRewards.status, 'pending')));
      const valid = new Set<string>();
      // 404だけを消失と判断。権限・429・通信障害は例外のまま次回へ。
      for (const row of pending) {
        try { if (sameGalleryPost(row, await discord.galleryMessage(row.channelId, row.messageId))) valid.add(row.messageId); }
        catch (err) { if (!(err instanceof DiscordHttpError && err.status === 404)) throw err; }
      }
      await db.transaction(async tx => {
        const [member] = await tx.select().from(members).where(eq(members.id, group.memberId)).for('update');
        const rows = await tx.select().from(galleryRewards).where(scope).orderBy(desc(galleryRewards.amount), asc(galleryRewards.postedAt), asc(galleryRewards.messageId)).for('update');
        const paid = rows.filter(r => r.status === 'paid');
        const days = new Set(paid.map(r => r.day));
        let count = paid.length;
        for (const row of rows) {
          if (row.status !== 'pending' || row.dueAt > now) continue;
          // 残存確認の後で追加された行は、次回に実物を確認するまで払わない。
          if (!pending.some(p => p.messageId === row.messageId)) continue;
          const status = !member || member.leftAt || member.isBot || !valid.has(row.messageId) ? 'removed' : days.has(row.day) ? 'daily_limit' : count >= 2 ? 'weekly_limit' : 'paid';
          if (status === 'paid') {
            await addCoins(tx, row.memberId, row.amount, 'gallery_reward', { messageId: row.messageId, kind: row.kind, week: row.week });
            count++; days.add(row.day);
          }
          await tx.update(galleryRewards).set({ status, settledAt: now }).where(eq(galleryRewards.messageId, row.messageId));
        }
      });
    } catch (err) { logger.warn({ err, week: group.week }, 'gallery member settlement deferred'); }
  }
}
