import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { tempVoice } from '../db/schema.js';
import { spendWithin } from './economy.js';

/**
 * 宿坊・宵宮の自分の通話部屋: 種類（公開・招待限定・シークレット・ツーショット）・人数・招待と、花びらの支払い。
 * - once（宿坊）: ひらくたびに 1 回。種類を変えたら差額だけ払う
 * - hourly（宵宮）: 1 時間ごと。払えなくなったら、招待限定などは公開に戻し、公開も払えなければ 5 分後に閉じる
 * 値段はすべて 0（無料）から。社務所Web の設定で決める。
 */

export type RoomKind = 'public' | 'invite' | 'secret' | 'twoshot';
export type RoomPlan = 'none' | 'once' | 'hourly';
export type RoomRow = typeof tempVoice.$inferSelect;

export const ROOM_KINDS: Record<RoomKind, { label: string; emoji: string; description: string }> = {
  public: { label: '公開', emoji: '🔓', description: 'だれでも入れる' },
  invite: { label: '招待限定', emoji: '🔒', description: '見えるけど、招待した人だけ入れる' },
  secret: { label: 'シークレット', emoji: '🤫', description: 'ほかの人には見えない。招待した人だけ' },
  twoshot: { label: 'ツーショット', emoji: '💞', description: '2 人だけ。招待した 1 人と' },
};
export const isRoomKind = (v: unknown): v is RoomKind => typeof v === 'string' && Object.hasOwn(ROOM_KINDS, v);

const HOUR_MS = 3_600_000;
/** 払えなくなってから閉じるまで */
export const UNPAID_CLOSE_MS = 5 * 60_000;

/** 入口の払い方（設定になければ名前から: 宿坊 → 1 回、🍶・宵宮 → 1 時間ごと） */
export function planOf(cfg: GuildConfig, hubId: string): RoomPlan {
  const hub = cfg.tempVoice.hubs.find((h) => h.channelId === hubId);
  if (!hub) return 'none';
  if (hub.plan) return hub.plan;
  if (hub.name.includes('宿坊')) return 'once';
  if (hub.name.includes('🍶') || hub.name.includes('宵宮')) return 'hourly';
  return 'none';
}

export function roomPrice(cfg: GuildConfig, plan: RoomPlan, kind: RoomKind): number {
  return plan === 'none' ? 0 : cfg.rooms[plan][kind];
}

export function priceLabel(cfg: GuildConfig, plan: RoomPlan, kind: RoomKind): string {
  const p = roomPrice(cfg, plan, kind);
  if (p <= 0) return '無料';
  return plan === 'hourly' ? `1 時間 ${p.toLocaleString('ja-JP')} 枚` : `${p.toLocaleString('ja-JP')} 枚`;
}

// ───────── 見える・入れる範囲 ─────────

export type Overwrite = { id: string; type: 0 | 1; allow: bigint; deny: bigint };

const VIEW = 1n << 10n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
/** 入れる人（作った人・招待した人・BOT） */
const MEMBER_IN = VIEW | CONNECT | SPEAK;

/**
 * 種類に合わせた権限の上書き。base はカテゴリと同じもの（宵宮なら宵参りの人だけ見える）。
 * 招待限定・ツーショット: ロール（運営のロールも）は入れない。シークレット: ロールには見えない。
 * 作った人・招待した人・BOT は、メンバーとして入れる。
 */
export function roomOverwrites(
  base: Overwrite[],
  kind: RoomKind,
  who: { ownerId: string; botId: string; invited: string[]; ownerAllow: bigint },
): Overwrite[] {
  const lock = kind === 'public' ? 0n : kind === 'secret' ? VIEW | CONNECT : CONNECT;
  const out: Overwrite[] = base
    .filter((o) => o.type === 0 || ![who.ownerId, who.botId, ...who.invited].includes(o.id))
    .map((o) => (o.type === 0 && lock ? { ...o, allow: o.allow & ~lock, deny: o.deny | lock } : { ...o }));
  const member = (id: string, allow: bigint) => {
    const cur = base.find((o) => o.type === 1 && o.id === id);
    out.push({ id, type: 1, allow: (cur?.allow ?? 0n) | allow, deny: (cur?.deny ?? 0n) & ~allow });
  };
  member(who.botId, MEMBER_IN);
  member(who.ownerId, MEMBER_IN | who.ownerAllow);
  for (const id of new Set(who.invited)) if (id !== who.ownerId && id !== who.botId) member(id, MEMBER_IN);
  return out;
}

// ───────── 支払い ─────────

export type PayResult = { status: 'ok'; charged: number } | { status: 'insufficient'; price: number };

const lockRoom = (tx: Db, channelId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'room:' + channelId}))`);

/** 部屋ができたとき: 公開の値段を払う（1 時間ごとなら最初の 1 時間） */
export async function startRoom(db: Db, cfg: GuildConfig, channelId: string, now = new Date()): Promise<PayResult> {
  return db.transaction(async (tx) => {
    await lockRoom(tx, channelId);
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
    if (!row) return { status: 'ok' as const, charged: 0 };
    const plan = planOf(cfg, row.hubId);
    const price = roomPrice(cfg, plan, 'public');
    if (price > 0 && !(await spendWithin(tx, row.ownerId, price, 'room', { channelId, kind: 'public', plan }))) {
      return { status: 'insufficient' as const, price };
    }
    await tx
      .update(tempVoice)
      .set({ paid: price, ...(plan === 'hourly' ? { paidUntil: new Date(now.getTime() + HOUR_MS) } : {}) })
      .where(eq(tempVoice.channelId, channelId));
    return { status: 'ok' as const, charged: price };
  });
}

/**
 * 種類を変える。1 回払い: これまでに払った分との差額。1 時間ごと: 今の 1 時間の差額（安くしても戻さない）。
 */
export async function changeRoomKind(db: Db, cfg: GuildConfig, channelId: string, kind: RoomKind): Promise<PayResult | { status: 'not_found' }> {
  return db.transaction(async (tx) => {
    await lockRoom(tx, channelId);
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
    if (!row) return { status: 'not_found' as const };
    const plan = planOf(cfg, row.hubId);
    const price = roomPrice(cfg, plan, kind);
    const charge = plan === 'once' ? Math.max(0, price - row.paid) : Math.max(0, price - roomPrice(cfg, plan, row.kind));
    if (charge > 0 && !(await spendWithin(tx, row.ownerId, charge, 'room', { channelId, kind, plan }))) {
      return { status: 'insufficient' as const, price: charge };
    }
    await tx
      .update(tempVoice)
      .set({ kind, paid: plan === 'once' ? row.paid + charge : row.paid })
      .where(eq(tempVoice.channelId, channelId));
    return { status: 'ok' as const, charged: charge };
  });
}

export async function addInvites(db: Db, channelId: string, ids: string[]): Promise<RoomRow | undefined> {
  const [row] = await db.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
  if (!row) return undefined;
  const invited = [...new Set([...row.invited, ...ids])].slice(-50);
  const [updated] = await db.update(tempVoice).set({ invited }).where(eq(tempVoice.channelId, channelId)).returning();
  return updated;
}

export type HourlyAction =
  | { action: 'paid'; channelId: string; charged: number }
  | { action: 'downgraded'; channelId: string; charged: number; from: RoomKind }
  | { action: 'warned'; channelId: string }
  | { action: 'close'; channelId: string };

/** 1 分ごと: 1 時間ごとの部屋で、次の 1 時間の分を払う */
export async function hourlyRooms(db: Db, cfg: GuildConfig, now = new Date()): Promise<HourlyAction[]> {
  const due = await db.select().from(tempVoice).where(and(isNotNull(tempVoice.paidUntil), lte(tempVoice.paidUntil, now)));
  const out: HourlyAction[] = [];
  for (const r of due) {
    if (planOf(cfg, r.hubId) !== 'hourly') continue;
    const a = await db.transaction(async (tx): Promise<HourlyAction | undefined> => {
      await lockRoom(tx, r.channelId);
      const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, r.channelId));
      if (!row?.paidUntil || row.paidUntil > now) return undefined;
      const next = new Date(Math.max(row.paidUntil.getTime(), now.getTime() - HOUR_MS) + HOUR_MS);
      const pay = async (kind: RoomKind) => {
        const price = roomPrice(cfg, 'hourly', kind);
        return price <= 0 || (await spendWithin(tx, row.ownerId, price, 'room', { channelId: row.channelId, kind, plan: 'hourly' })) ? price : -1;
      };
      const charged = await pay(row.kind);
      if (charged >= 0) {
        await tx.update(tempVoice).set({ paidUntil: next, unpaidSince: null }).where(eq(tempVoice.channelId, row.channelId));
        return { action: 'paid', channelId: row.channelId, charged };
      }
      // 招待限定などが払えない: 公開に戻す（公開が払えれば）
      if (row.kind !== 'public') {
        const pub = await pay('public');
        if (pub >= 0) {
          await tx.update(tempVoice).set({ kind: 'public', paidUntil: next, unpaidSince: null }).where(eq(tempVoice.channelId, row.channelId));
          return { action: 'downgraded', channelId: row.channelId, charged: pub, from: row.kind };
        }
      }
      if (!row.unpaidSince) {
        await tx.update(tempVoice).set({ unpaidSince: now }).where(eq(tempVoice.channelId, row.channelId));
        return { action: 'warned', channelId: row.channelId };
      }
      if (now.getTime() - row.unpaidSince.getTime() >= UNPAID_CLOSE_MS) return { action: 'close', channelId: row.channelId };
      return undefined;
    });
    if (a) out.push(a);
  }
  return out;
}

export async function roomOf(db: Db, channelId: string): Promise<RoomRow | undefined> {
  const [row] = await db.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
  return row;
}
