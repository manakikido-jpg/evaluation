import { and, eq, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { members, roomPayers, tempVoice } from '../db/schema.js';
import { spendWithin } from './economy.js';

/**
 * 宿坊・宵宮の自分の通話部屋: 種類（公開・招待限定・シークレット・ツーショット）・人数・招待と、花びらの支払い。
 * - once（宿坊）: ひらくたびに 1 回。種類を変えたら差額だけ払う
 * - hourly（宵宮）: 入っている人それぞれが 1 時間ごと。払えなければ注意して、5 分後に通話から抜けてもらう
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

/** 奉納（ブースト）している人か */
async function isBoosting(db: Db, memberId: string): Promise<boolean> {
  const [m] = await db.select({ since: members.boostingSince, left: members.leftAt }).from(members).where(eq(members.id, memberId));
  return Boolean(m?.since && !m.left);
}

/** その人が払う値段（奉納している人は割引。100% なら無料） */
async function priceFor(db: Db, cfg: GuildConfig, plan: RoomPlan, kind: RoomKind, memberId: string): Promise<number> {
  const price = roomPrice(cfg, plan, kind);
  if (price <= 0) return 0;
  const off = cfg.rooms.boosterDiscountPercent;
  if (off <= 0 || !(await isBoosting(db, memberId))) return price;
  return Math.ceil((price * (100 - off)) / 100);
}

export type PayResult = { status: 'ok'; charged: number } | { status: 'insufficient'; price: number };

const lockRoom = (tx: Db, channelId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'room:' + channelId}))`);

/** 部屋ができたとき（ひらくたびに 1 回の部屋）: 作った人が公開の値段を払う */
export async function startRoom(db: Db, cfg: GuildConfig, channelId: string, now = new Date()): Promise<PayResult> {
  return db.transaction(async (tx) => {
    await lockRoom(tx, channelId);
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
    if (!row) return { status: 'ok' as const, charged: 0 };
    const plan = planOf(cfg, row.hubId);
    // 1 時間ごとの部屋は、入った人それぞれが払う（payEntry）
    if (plan !== 'once') return { status: 'ok' as const, charged: 0 };
    const price = await priceFor(tx, cfg, plan, 'public', row.ownerId);
    if (price > 0 && !(await spendWithin(tx, row.ownerId, price, 'room', { channelId, kind: 'public', plan }))) {
      return { status: 'insufficient' as const, price };
    }
    await tx.update(tempVoice).set({ paid: price }).where(eq(tempVoice.channelId, channelId));
    return { status: 'ok' as const, charged: price };
  });
}

/**
 * 種類を変える。1 回払い: 作った人が、これまでに払った分との差額。
 * 1 時間ごと: 作った人が今の 1 時間の差額（ほかの人は次の 1 時間から新しい値段。安くしても戻さない）。
 */
/** 部屋の種類を選ぶ（1 回だけ。選んだあとは公開・非公開を切り替えられない） */
export async function changeRoomKind(db: Db, cfg: GuildConfig, channelId: string, kind: RoomKind): Promise<PayResult | { status: 'not_found' } | { status: 'locked' }> {
  return db.transaction(async (tx) => {
    await lockRoom(tx, channelId);
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
    if (!row) return { status: 'not_found' as const };
    if (row.kindLocked) return { status: 'locked' as const };
    const plan = planOf(cfg, row.hubId);
    const price = await priceFor(tx, cfg, plan, kind, row.ownerId);
    const charge = plan === 'once' ? Math.max(0, price - row.paid) : Math.max(0, price - (await priceFor(tx, cfg, plan, row.kind, row.ownerId)));
    if (charge > 0 && !(await spendWithin(tx, row.ownerId, charge, 'room', { channelId, kind, plan }))) {
      return { status: 'insufficient' as const, price: charge };
    }
    await tx
      .update(tempVoice)
      .set({ kind, kindLocked: true, paid: plan === 'once' ? row.paid + charge : row.paid })
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

export type PersonAction =
  | { action: 'paid'; channelId: string; memberId: string; charged: number }
  | { action: 'warned'; channelId: string; memberId: string; price: number }
  | { action: 'kick'; channelId: string; memberId: string };

const lockPayer = (tx: Db, channelId: string, memberId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'room:' + channelId + ':' + memberId}))`);

/**
 * 1 時間ごとの部屋（宵宮）に入ったとき: その人の最初の 1 時間を払う
 * （払ってある間に出入りしても、もう一度は払わない）。無料なら何もしない。
 */
export async function payEntry(
  db: Db,
  cfg: GuildConfig,
  channelId: string,
  memberId: string,
  now = new Date(),
): Promise<{ status: 'ok' | 'free' | 'already'; charged: number } | { status: 'insufficient'; price: number }> {
  const row = await roomOf(db, channelId);
  if (!row || planOf(cfg, row.hubId) !== 'hourly') return { status: 'free', charged: 0 };
  const price = await priceFor(db, cfg, 'hourly', row.kind, memberId);
  if (price <= 0) return { status: 'free', charged: 0 };
  return db.transaction(async (tx) => {
    await lockPayer(tx, channelId, memberId);
    const [payer] = await tx.select().from(roomPayers).where(and(eq(roomPayers.channelId, channelId), eq(roomPayers.memberId, memberId)));
    if (payer && payer.paidUntil > now) return { status: 'already' as const, charged: 0 };
    if (!(await spendWithin(tx, memberId, price, 'room', { channelId, kind: row.kind, plan: 'hourly' }))) return { status: 'insufficient' as const, price };
    const paidUntil = new Date(now.getTime() + HOUR_MS);
    await tx
      .insert(roomPayers)
      .values({ channelId, memberId, paidUntil })
      .onConflictDoUpdate({ target: [roomPayers.channelId, roomPayers.memberId], set: { paidUntil, unpaidSince: null } });
    return { status: 'ok' as const, charged: price };
  });
}

/**
 * 1 分ごと: 1 時間ごとの部屋（宵宮）に今いる人それぞれが、次の 1 時間の分を払う。
 * 払えなければ注意して、5 分たっても払えなければ通話から抜けてもらう。
 * present: 部屋ごとに今いる人（BOT を除く）
 */
export async function hourlyPerPerson(
  db: Db,
  cfg: GuildConfig,
  present: { channelId: string; memberIds: string[] }[],
  now = new Date(),
): Promise<PersonAction[]> {
  const out: PersonAction[] = [];
  // なくなった部屋の記録は消す
  const alive = new Set((await db.select({ id: tempVoice.channelId }).from(tempVoice)).map((r) => r.id));
  for (const p of await db.select({ channelId: roomPayers.channelId }).from(roomPayers)) {
    if (!alive.has(p.channelId)) await db.delete(roomPayers).where(eq(roomPayers.channelId, p.channelId));
  }
  for (const room of present) {
    const row = await roomOf(db, room.channelId);
    if (!row || planOf(cfg, row.hubId) !== 'hourly') continue;
    if (roomPrice(cfg, 'hourly', row.kind) <= 0) continue;
    for (const memberId of new Set(room.memberIds)) {
      const price = await priceFor(db, cfg, 'hourly', row.kind, memberId);
      if (price <= 0) continue;
      const a = await db.transaction(async (tx): Promise<PersonAction | undefined> => {
        await lockPayer(tx, room.channelId, memberId);
        const [payer] = await tx.select().from(roomPayers).where(and(eq(roomPayers.channelId, room.channelId), eq(roomPayers.memberId, memberId)));
        if (payer && payer.paidUntil > now) return undefined;
        if (await spendWithin(tx, memberId, price, 'room', { channelId: room.channelId, kind: row.kind, plan: 'hourly' })) {
          // BOT が止まっていた間の分はさかのぼらない（今から 1 時間）
          const paidUntil = new Date(Math.max(payer?.paidUntil.getTime() ?? 0, now.getTime() - HOUR_MS) + HOUR_MS);
          await tx
            .insert(roomPayers)
            .values({ channelId: room.channelId, memberId, paidUntil })
            .onConflictDoUpdate({ target: [roomPayers.channelId, roomPayers.memberId], set: { paidUntil, unpaidSince: null } });
          return { action: 'paid', channelId: room.channelId, memberId, charged: price };
        }
        if (!payer?.unpaidSince) {
          await tx
            .insert(roomPayers)
            .values({ channelId: room.channelId, memberId, paidUntil: payer?.paidUntil ?? now, unpaidSince: now })
            .onConflictDoUpdate({ target: [roomPayers.channelId, roomPayers.memberId], set: { unpaidSince: now } });
          return { action: 'warned', channelId: room.channelId, memberId, price };
        }
        if (now.getTime() - payer.unpaidSince.getTime() >= UNPAID_CLOSE_MS) return { action: 'kick', channelId: room.channelId, memberId };
        return undefined;
      });
      if (a) out.push(a);
    }
  }
  return out;
}

export async function roomOf(db: Db, channelId: string): Promise<RoomRow | undefined> {
  const [row] = await db.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
  return row;
}

export async function listRooms(db: Db): Promise<RoomRow[]> {
  return db.select().from(tempVoice);
}
