import { and, arrayOverlaps, asc, desc, eq, gt, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { TICKET_KINDS, type GuildConfig, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { economyEvents, eventTicketGrants, members, voiceUsage, type EconomyEvent } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { jstDate } from './activity.js';
import { audit } from './audit.js';
import { addTickets, ticketName } from './tickets.js';

/**
 * 期間限定イベント（ボーナス週間・セール）。始まりから終わりまでの間だけ、BOT の設定に入れる。
 * - voice: 通話でもらえる{通貨}が value%（200 = 2 倍）
 * - shop: 授与品が value% 引き（免罪符・贈り物はのぞく）
 * - gacha: 物御籤が value% 引き
 * - voice_ticket: その日（日本時間）の通話が value 分になった人に、券を ticket_count 枚（その日 1 回）
 * 同じ種類が重なったら、いちばん大きいものが効く（voice_ticket は重なった分だけ配る）。
 */

export type EventKind = EconomyEvent['kind'];

export const EVENT_KINDS: Record<EventKind, { label: string; emoji: string; unit: string; min: number; max: number }> = {
  voice: { label: '通話ボーナス', emoji: '🎙', unit: '%（200 で 2 倍）', min: 110, max: 1000 },
  shop: { label: '授与品セール', emoji: '🏮', unit: '% 引き', min: 1, max: 90 },
  gacha: { label: '物御籤セール', emoji: '🎁', unit: '% 引き', min: 1, max: 90 },
  voice_ticket: { label: '通話で券', emoji: '🎫', unit: '分（その日の通話がこの分数で券）', min: 1, max: 600 },
};

/** voice_ticket で一度に配れる枚数 */
export const EVENT_TICKET_MAX = 10;

export const isTicketKind = (v: unknown): v is TicketKind => typeof v === 'string' && (TICKET_KINDS as readonly string[]).includes(v);

export const isEventKind = (v: unknown): v is EventKind => typeof v === 'string' && Object.hasOwn(EVENT_KINDS, v);

export const validEventValue = (kind: EventKind, v: number) => Number.isInteger(v) && v >= EVENT_KINDS[kind].min && v <= EVENT_KINDS[kind].max;

/** イベントの効き目の短い説明（通話 2 倍・授与品 30% 引き） */
export function eventEffect(e: Pick<EconomyEvent, 'kind' | 'value'> & Partial<Pick<EconomyEvent, 'ticket' | 'ticketCount'>>, coin: string): string {
  if (e.kind === 'voice_ticket') {
    const t = isTicketKind(e.ticket) ? e.ticket : 'gacha_free';
    return `その日の通話が ${e.value} 分になると ${ticketName(t)} ×${e.ticketCount ?? 1}（1 日 1 回）`;
  }
  if (e.kind === 'voice') return `通話でもらえる${coin}が ${e.value % 100 === 0 ? `${e.value / 100} 倍` : `${e.value}%`}`;
  return `${e.kind === 'shop' ? '授与品' : '物御籤'}が ${e.value}% 引き`;
}

export async function createEvent(
  db: Db,
  input: { kind: EventKind; value: number; title: string; startsAt: Date; endsAt: Date; announceChannelId?: string; ticket?: TicketKind; ticketCount?: number },
  by: string,
): Promise<EconomyEvent> {
  const ticket = input.kind === 'voice_ticket' ? (input.ticket ?? 'gacha_free') : 'gacha_free';
  const ticketCount = input.kind === 'voice_ticket' ? Math.min(EVENT_TICKET_MAX, Math.max(1, Math.floor(input.ticketCount ?? 1))) : 1;
  const [row] = await db
    .insert(economyEvents)
    .values({ ...input, ticket, ticketCount, announceChannelId: input.announceChannelId ?? null, createdBy: by })
    .returning();
  await audit(db, {
    actorId: by,
    action: 'economy.event.create',
    detail: { id: row!.id, kind: input.kind, value: input.value, title: input.title, ...(input.kind === 'voice_ticket' ? { ticket, ticketCount } : {}) },
    via: 'web',
  });
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

/**
 * 通話で券（voice_ticket）: 開催中なら、今日（日本時間）の通話の合計が決めた分数になった人に券を配る（BOT が 1 分ごとに呼ぶ）。
 * 数えるのは「通話の記録」（AFK と除外した通話をのぞく。1 人でいた分も入る）。
 * 位（ランク）のロールを持っていて、サーバーにいる人だけ。同じイベントでは 1 人 1 日 1 回。
 * 配った人を返す（BOT が DM で知らせる）
 */
export async function voiceTicketTick(
  db: Db,
  cfg: Pick<GuildConfig, 'ranks'> & { economy: Pick<GuildConfig['economy'], 'excludedVoiceChannelIds'> },
  now = new Date(),
): Promise<{ event: EconomyEvent; memberId: string; minutes: number }[]> {
  const events = (await activeEvents(db, now)).filter((e) => e.kind === 'voice_ticket');
  if (!events.length) return [];
  const rankRoles = cfg.ranks.map((r) => r.roleId);
  if (!rankRoles.length) return [];
  const date = jstDate(now);
  const excluded = cfg.economy.excludedVoiceChannelIds;
  const minutes = sql<number>`sum(${voiceUsage.minutes})::int`;
  const least = Math.min(...events.map((e) => e.value));
  const rows = await db
    .select({ memberId: voiceUsage.memberId, minutes })
    .from(voiceUsage)
    .innerJoin(members, eq(members.id, voiceUsage.memberId))
    .where(
      and(
        eq(voiceUsage.date, date),
        excluded.length ? notInArray(voiceUsage.channelId, excluded) : undefined,
        isNull(members.leftAt),
        eq(members.isBot, false),
        arrayOverlaps(members.roleIds, rankRoles),
      ),
    )
    .groupBy(voiceUsage.memberId)
    .having(sql`sum(${voiceUsage.minutes}) >= ${least}`);
  if (!rows.length) return [];
  const done = await db
    .select({ eventId: eventTicketGrants.eventId, memberId: eventTicketGrants.memberId })
    .from(eventTicketGrants)
    .where(and(eq(eventTicketGrants.date, date), inArray(eventTicketGrants.eventId, events.map((e) => e.id))));
  const had = new Set(done.map((d) => `${d.eventId}:${d.memberId}`));
  const granted: { event: EconomyEvent; memberId: string; minutes: number }[] = [];
  for (const e of events) {
    const kind = isTicketKind(e.ticket) ? e.ticket : 'gacha_free';
    for (const r of rows) {
      if (r.minutes < e.value || had.has(`${e.id}:${r.memberId}`)) continue;
      const ok = await db.transaction(async (tx) => {
        const [row] = await tx.insert(eventTicketGrants).values({ eventId: e.id, memberId: r.memberId, date, minutes: r.minutes, at: now }).onConflictDoNothing().returning();
        if (!row) return false;
        await addTickets(tx, r.memberId, kind, e.ticketCount);
        return true;
      });
      if (ok) granted.push({ event: e, memberId: r.memberId, minutes: r.minutes });
    }
  }
  return granted;
}

/** 通話で券をもらった人への DM */
export function voiceTicketDm(g: { event: Pick<EconomyEvent, 'title' | 'value' | 'ticket' | 'ticketCount'>; minutes: number }): string {
  const t = isTicketKind(g.event.ticket) ? g.event.ticket : 'gacha_free';
  return [
    `🎫 **${g.event.title}**`,
    `今日の通話が ${g.event.value} 分をこえたので、${ticketName(t)} ×${g.event.ticketCount} をお渡ししました。`,
    '`/持ち物` で確かめられます（物御籤の券は `/物御籤` の「🎟 券を使う」からも使えます）。',
  ].join('\n');
}
