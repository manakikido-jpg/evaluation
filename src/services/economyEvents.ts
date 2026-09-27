import { and, asc, desc, eq, gt, isNull, lte } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { economyEvents, type EconomyEvent } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { audit } from './audit.js';

/**
 * 期間限定イベント（ボーナス週間・セール）。始まりから終わりまでの間だけ、BOT の設定に入れる。
 * - voice: 通話でもらえる{通貨}が value%（200 = 2 倍）
 * - shop: 授与品が value% 引き（免罪符・贈り物はのぞく）
 * - gacha: 物御籤が value% 引き
 * 同じ種類が重なったら、いちばん大きいものが効く。
 */

export type EventKind = EconomyEvent['kind'];

export const EVENT_KINDS: Record<EventKind, { label: string; emoji: string; unit: string; min: number; max: number }> = {
  voice: { label: '通話ボーナス', emoji: '🎙', unit: '%（200 で 2 倍）', min: 110, max: 1000 },
  shop: { label: '授与品セール', emoji: '🏮', unit: '% 引き', min: 1, max: 90 },
  gacha: { label: '物御籤セール', emoji: '🎁', unit: '% 引き', min: 1, max: 90 },
};

export const isEventKind = (v: unknown): v is EventKind => typeof v === 'string' && Object.hasOwn(EVENT_KINDS, v);

export const validEventValue = (kind: EventKind, v: number) => Number.isInteger(v) && v >= EVENT_KINDS[kind].min && v <= EVENT_KINDS[kind].max;

/** イベントの効き目の短い説明（通話 2 倍・授与品 30% 引き） */
export function eventEffect(e: Pick<EconomyEvent, 'kind' | 'value'>, coin: string): string {
  if (e.kind === 'voice') return `通話でもらえる${coin}が ${e.value % 100 === 0 ? `${e.value / 100} 倍` : `${e.value}%`}`;
  return `${e.kind === 'shop' ? '授与品' : '物御籤'}が ${e.value}% 引き`;
}

export async function createEvent(
  db: Db,
  input: { kind: EventKind; value: number; title: string; startsAt: Date; endsAt: Date; announceChannelId?: string },
  by: string,
): Promise<EconomyEvent> {
  const [row] = await db
    .insert(economyEvents)
    .values({ ...input, announceChannelId: input.announceChannelId ?? null, createdBy: by })
    .returning();
  await audit(db, { actorId: by, action: 'economy.event.create', detail: { id: row!.id, kind: input.kind, value: input.value, title: input.title }, via: 'web' });
  return row!;
}

export async function cancelEvent(db: Db, id: number, by: string, now = new Date()): Promise<void> {
  await db
    .update(economyEvents)
    .set({ cancelledAt: now })
    .where(and(eq(economyEvents.id, id), isNull(economyEvents.cancelledAt)));
  await audit(db, { actorId: by, action: 'economy.event.cancel', detail: { id }, via: 'web' });
}

/** これからのもの・いま効いているもの・最近終わったもの */
export async function listEvents(db: Db, limit = 30): Promise<EconomyEvent[]> {
  return db.select().from(economyEvents).orderBy(desc(economyEvents.startsAt), desc(economyEvents.id)).limit(limit);
}

export async function activeEvents(db: Db, now = new Date()): Promise<EconomyEvent[]> {
  return db
    .select()
    .from(economyEvents)
    .where(and(isNull(economyEvents.cancelledAt), lte(economyEvents.startsAt, now), gt(economyEvents.endsAt, now)))
    .orderBy(asc(economyEvents.startsAt));
}

export type EventState = 'upcoming' | 'active' | 'ended' | 'cancelled';
export function eventState(e: EconomyEvent, now = new Date()): EventState {
  if (e.cancelledAt) return 'cancelled';
  if (e.startsAt > now) return 'upcoming';
  return e.endsAt > now ? 'active' : 'ended';
}

/** いま効いているイベントを設定に入れる（同じ種類はいちばん大きいもの） */
export function applyEvents(cfg: GuildConfig, events: Pick<EconomyEvent, 'kind' | 'value'>[]): GuildConfig {
  if (!events.length) return cfg;
  const best = (k: EventKind, base: number) => Math.max(base, ...events.filter((e) => e.kind === k).map((e) => e.value));
  return {
    ...cfg,
    economy: {
      ...cfg.economy,
      voiceEventPercent: best('voice', cfg.economy.voiceEventPercent),
      shopSalePercent: best('shop', cfg.economy.shopSalePercent),
      gachaSalePercent: best('gacha', cfg.economy.gachaSalePercent),
    },
  };
}

/** セールの値段（切り上げ）。0% ならそのまま */
export const salePrice = (price: number, percent: number) => (percent > 0 ? Math.ceil((price * (100 - percent)) / 100) : price);

/**
 * 始まった・終わったイベントを知らせる（BOT が 1 分ごとに呼ぶ）。知らせるチャンネルがなければ印だけ付ける。
 * 知らせた数を返す
 */
export async function announceEvents(ctx: { db: Db; cfg: GuildConfig; discord: DiscordActions }, now = new Date()): Promise<number> {
  const coin = `${ctx.cfg.economy.currencyEmoji}${ctx.cfg.economy.currencyName}`;
  const unix = (d: Date) => Math.floor(d.getTime() / 1000);
  let sent = 0;
  const post = async (e: EconomyEvent, text: string) => {
    if (!e.announceChannelId) return;
    try {
      await ctx.discord.sendMessage(e.announceChannelId, { embeds: [{ description: text, color: 0xd4a017 }] });
      sent++;
    } catch (err) {
      logger.warn({ err, id: e.id }, 'economy event announce failed');
    }
  };
  const starting = await ctx.db
    .select()
    .from(economyEvents)
    .where(and(isNull(economyEvents.cancelledAt), eq(economyEvents.startNotified, false), lte(economyEvents.startsAt, now)));
  for (const e of starting) {
    await ctx.db.update(economyEvents).set({ startNotified: true }).where(eq(economyEvents.id, e.id));
    // 始まる前に終わっていたもの（BOT が止まっていたなど）は知らせない
    if (e.endsAt > now) {
      await post(e, [`# ${EVENT_KINDS[e.kind].emoji} ${e.title}`, `**${eventEffect(e, coin)}**！`, `<t:${unix(e.endsAt)}:f> まで（<t:${unix(e.endsAt)}:R>）`].join('\n'));
    }
  }
  const ending = await ctx.db
    .select()
    .from(economyEvents)
    .where(and(isNull(economyEvents.cancelledAt), eq(economyEvents.startNotified, true), eq(economyEvents.endNotified, false), lte(economyEvents.endsAt, now)));
  for (const e of ending) {
    await ctx.db.update(economyEvents).set({ endNotified: true }).where(eq(economyEvents.id, e.id));
    await post(e, `${EVENT_KINDS[e.kind].emoji} **${e.title}** は終わりました。ご参加ありがとうございました！`);
  }
  return sent;
}
