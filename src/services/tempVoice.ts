import { and, eq, isNotNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { roomPayers, tempVoice } from '../db/schema.js';
import { audit } from './audit.js';
import { logger } from '../lib/logger.js';
import { spendWithin } from './economy.js';
import { isBoosting } from './rooms.js';

/**
 * 自分の通話部屋。
 * 「➕ 縁側をひらく」などの通話（hub）に入ると、その人の通話が同じカテゴリにでき、そこへ移動する。
 * 全員が抜けたら消す。作った人は名前・人数の上限を変えられる。
 */

/** Discord の操作（テストでは偽物に差し替える） */
export interface VoiceOps {
  /**
   * hub と同じカテゴリ・同じ見える範囲で通話を作り、作った人に名前などの変更を許す。作った通話の ID を返す。
   * fromHub: カテゴリではなく入口の見える範囲に合わせる（💎 極の部屋: VIP だけ）
   */
  create(input: { hubId: string; name: string; ownerId: string; fromHub?: boolean; /** 最初から見えない部屋（🤫 シクレの入口） */ secret?: boolean; /** 入口の通話がないときに作るカテゴリ */ parentId?: string }): Promise<string>;
  /** 通話に移動させる（その人が通話にいなければ失敗する） */
  move(userId: string, channelId: string): Promise<void>;
  /** 通話を消す（すでになければ何もしない） */
  remove(channelId: string): Promise<void>;
  /** 今いる人数。通話がなければ undefined */
  occupancy(channelId: string): number | undefined;
}

export type TempVoiceCtx = { db: Db; cfg: GuildConfig; ops: VoiceOps };

export type JoinResult = { status: 'created' | 'moved'; channelId: string } | { status: 'ignored' | 'failed' };

/** できたばかりの部屋は、まだ人がいないように見えることがある（Discord から入ったお知らせが届く前）ので、しばらく消さない */
const GRACE_MS = 30_000;

/** 表示名を入れた通話の名前（長すぎる名前は切る。Discord の上限は 100 文字） */
export function roomName(template: string, displayName: string): string {
  const name = [...displayName.trim()].slice(0, 20).join('') || '名無し';
  return template.replaceAll('{name}', name).slice(0, 100);
}

/** 同じ人が続けて入ったときに 2 つ作らないように */
const busy = new Set<string>();

/** 通話に入った（移動した）とき。hub なら部屋を作って移動させる */
export async function onVoiceJoin(ctx: TempVoiceCtx, input: { userId: string; displayName: string; channelId: string }): Promise<JoinResult> {
  const hub = ctx.cfg.tempVoice.hubs.find((h) => h.channelId === input.channelId);
  if (!hub || busy.has(input.userId)) return { status: 'ignored' };
  busy.add(input.userId);
  try {
    // この入口で作った自分の部屋がまだあれば、そこへ戻す（ほかの入口の部屋はそのまま）
    for (const row of await ctx.db
      .select()
      .from(tempVoice)
      .where(and(eq(tempVoice.ownerId, input.userId), eq(tempVoice.hubId, hub.channelId)))) {
      if (ctx.ops.occupancy(row.channelId) === undefined) {
        await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, row.channelId));
        continue;
      }
      await ctx.ops.move(input.userId, row.channelId);
      return { status: 'moved', channelId: row.channelId };
    }

    let channelId: string;
    try {
      channelId = await ctx.ops.create({
        hubId: hub.channelId,
        name: roomName(hub.name, input.displayName),
        ownerId: input.userId,
        ...(ctx.cfg.rooms.vip?.hubId === hub.channelId ? { fromHub: true } : {}),
        ...(hub.kind === 'secret' ? { secret: true } : {}),
      });
    } catch (err) {
      logger.warn(
        { err },
        '通話部屋を作れませんでした。BOT のロールに「チャンネルの管理」「メンバーを移動」の権限があるか確認してください',
      );
      return { status: 'failed' };
    }
    await ctx.db.insert(tempVoice).values({ channelId, ownerId: input.userId, hubId: hub.channelId });
    try {
      await ctx.ops.move(input.userId, channelId);
    } catch {
      // 作っている間に通話から抜けていた
      await removeRoom(ctx, channelId);
      return { status: 'failed' };
    }
    return { status: 'created', channelId };
  } finally {
    busy.delete(input.userId);
  }
}

/** 通話から抜けた（移動した）とき。自分の通話部屋が空になったら消す */
export async function onVoiceLeave(ctx: TempVoiceCtx, channelId: string, now = new Date()): Promise<boolean> {
  const [row] = await ctx.db.select().from(tempVoice).where(eq(tempVoice.channelId, channelId));
  if (!row) return false;
  if (now.getTime() - row.createdAt.getTime() < GRACE_MS) return false;
  // パネルで作ったシクレ部屋は、作った人が入るのを待つ（期限が来ても入らなければ消す）
  if (row.pendingUntil && row.pendingUntil > now) return false;
  // 🏨 買った宿は、期限まではだれもいなくても残す
  if (row.keepUntil && row.keepUntil > now) return false;
  // 1日延長と空室の削除を同じ行のロックで順番にする。古い期限を見て消さない。
  if (row.keepUntil && !row.renewHourly) {
    return ctx.db.transaction(async (tx) => {
      const [current] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId)).for('update');
      if (!current || !current.keepUntil || current.renewHourly || current.keepUntil > now) return false;
      const n = ctx.ops.occupancy(channelId);
      if (n === undefined) {
        await tx.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
        return false;
      }
      if (n > 0) return false;
      await ctx.ops.remove(channelId);
      await tx.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
      return true;
    });
  }
  const n = ctx.ops.occupancy(channelId);
  if (n === undefined) {
    await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
    return false;
  }
  // ⏱ 1 時間ごとの宿: 払う時刻に人がいれば、部屋主が次の 1 時間を払う（足りなければ閉じる）
  if (n > 0 && row.renewHourly && row.keepUntil) {
    if (await renewHourlyStay(ctx, row.channelId, row.ownerId, row.keepUntil, now)) return false;
    await removeRoom(ctx, channelId);
    return true;
  }
  if (n > 0) return false;
  await removeRoom(ctx, channelId);
  return true;
}

/** 起動したときと 1 分ごと: BOT が止まっていた間に空になった部屋を消す */
export async function cleanupRooms(ctx: TempVoiceCtx, now = new Date()): Promise<number> {
  let removed = 0;
  for (const row of await ctx.db.select().from(tempVoice)) {
    try {
      if (await onVoiceLeave(ctx, row.channelId, now)) removed++;
    } catch (err) {
      logger.warn({ err, channelId: row.channelId }, 'temp voice cleanup failed');
    }
  }
  return removed;
}

/** 🤫 パネルで作ったシクレ部屋を、作った人が入るまで待つ時間 */
export const SECRET_PENDING_MS = 5 * 60_000;

export type SecretRoomResult = { status: 'created' | 'exists'; channelId: string } | { status: 'busy' } | { status: 'failed'; reason?: string };

/**
 * 🤫 パネルのボタンでシクレ部屋を作る（どの通話も通らないので、だれにも見えない）。
 * 部屋代はまだ取らない（作った人が入ったときに取る）。5 分入らなければ消す。同じ入口の自分の部屋がまだあれば、それを返す
 */
export async function createSecretRoom(ctx: TempVoiceCtx, input: { hubId: string; userId: string; displayName: string; parentId?: string }, now = new Date()): Promise<SecretRoomResult> {
  const hub = ctx.cfg.tempVoice.hubs.find((h) => h.channelId === input.hubId);
  if (!hub) return { status: 'failed' };
  if (busy.has(input.userId)) return { status: 'busy' };
  busy.add(input.userId);
  try {
    for (const row of await ctx.db.select().from(tempVoice).where(and(eq(tempVoice.ownerId, input.userId), eq(tempVoice.hubId, hub.channelId)))) {
      if (ctx.ops.occupancy(row.channelId) === undefined) {
        await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, row.channelId));
        continue;
      }
      return { status: 'exists', channelId: row.channelId };
    }
    let channelId: string;
    try {
      channelId = await ctx.ops.create({ hubId: hub.channelId, name: roomName(hub.name, input.displayName), ownerId: input.userId, secret: true, ...(input.parentId ? { parentId: input.parentId } : {}) });
    } catch (err) {
      logger.warn({ err }, 'シクレ部屋を作れませんでした（BOT の「チャンネルの管理」権限）');
      return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
    await ctx.db.insert(tempVoice).values({ channelId, ownerId: input.userId, hubId: hub.channelId, createdAt: now, pendingUntil: new Date(now.getTime() + SECRET_PENDING_MS) });
    return { status: 'created', channelId };
  } finally {
    busy.delete(input.userId);
  }
}

/** パネルで作った部屋に、作った人がはじめて入った: 待ちを外す（1 回だけ true） */
export async function claimSecretRoom(db: Db, channelId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .update(tempVoice)
    .set({ pendingUntil: null })
    .where(and(eq(tempVoice.channelId, channelId), eq(tempVoice.ownerId, userId), isNotNull(tempVoice.pendingUntil)))
    .returning();
  return Boolean(row);
}

/** 🏨 買った宿が、だれもいなくても残る時間 */
export const STAY_MS = 24 * 60 * 60_000;
/** ⏱ 1 時間ごとの宿の、1 回分 */
export const HOURLY_STAY_MS = 60 * 60_000;
export type StayMode = 'day' | 'hourly';

/** 1日延長も、新しく24時間の宿を立てるときと同じ値段。 */
export async function stayDayPrice(db: Db, cfg: GuildConfig, ownerId: string): Promise<number> {
  return (await isBoosting(db, ownerId)) ? 0 : cfg.rooms.stayPrice;
}

export type ExtendStayResult =
  | { status: 'ok'; keepUntil: Date; charged: number }
  | { status: 'not_found' | 'not_owner' | 'not_daily' | 'changed' }
  | { status: 'insufficient'; price: number };

/** 確認した期限・料金が今も同じときだけ、部屋主が1日分を払う。削除処理とも排他する。 */
export async function extendStayRoom(db: Db, cfg: GuildConfig, input: {
  channelId: string; userId: string; expectedUntil: number; expectedPrice: number;
}, at?: Date): Promise<ExtendStayResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, input.channelId)).for('update');
    if (!row) return { status: 'not_found' };
    if (row.ownerId !== input.userId) return { status: 'not_owner' };
    if (!row.keepUntil || row.renewHourly) return { status: 'not_daily' };
    const price = await stayDayPrice(tx, cfg, row.ownerId);
    if (row.keepUntil.getTime() !== input.expectedUntil || price !== input.expectedPrice) return { status: 'changed' };
    const now = at ?? new Date();
    const keepUntil = new Date(Math.max(row.keepUntil.getTime(), now.getTime()) + STAY_MS);
    if (price > 0 && !(await spendWithin(tx, row.ownerId, price, 'room', {
      channelId: row.channelId, stay: true, extension: true, hours: 24,
      previousUntil: row.keepUntil.toISOString(), keepUntil: keepUntil.toISOString(),
    }))) return { status: 'insufficient', price };
    await tx.update(tempVoice).set({ keepUntil }).where(eq(tempVoice.channelId, row.channelId));
    return { status: 'ok', keepUntil, charged: price };
  });
}

/** ⏱ 次の 1 時間を払って延ばす。同じ時刻の分は 1 回だけ（keep_until が変わっていれば払わない）。払えなければ false */
async function renewHourlyStay(ctx: TempVoiceCtx, channelId: string, ownerId: string, due: Date, now: Date): Promise<boolean> {
  // 🏮 奉納（ブースト）している人は、宿代が無料
  const price = (await isBoosting(ctx.db, ownerId)) ? 0 : ctx.cfg.rooms.stayHourlyPrice;
  return ctx.db.transaction(async (tx) => {
    // 止まっていた間の分はさかのぼらず、今から 1 時間
    const next = new Date(Math.max(due.getTime(), now.getTime()) + HOURLY_STAY_MS);
    const [claimed] = await tx.update(tempVoice).set({ keepUntil: next }).where(and(eq(tempVoice.channelId, channelId), eq(tempVoice.keepUntil, due))).returning();
    if (!claimed) return true;
    if (price > 0 && !(await spendWithin(tx, ownerId, price, 'room', { channelId, stay: true, hourly: true }))) {
      await tx.update(tempVoice).set({ keepUntil: due }).where(eq(tempVoice.channelId, channelId));
      return false;
    }
    return true;
  });
}

export type StayRoomResult = { status: 'created' | 'exists'; channelId: string; keepUntil: Date; charged?: number } | { status: 'busy' } | { status: 'failed'; reason?: string } | { status: 'insufficient'; price: number };

/**
 * 🏨 パネルで銭を払って、24 時間残る宿を立てる。作れてから払う（足りなければ部屋を消す）。
 * 同じ入口の自分の宿がまだ残っていれば、それを返す（二重には買わない）
 */
/** 運営は宿をいくつまで同時に持てるか（運営でない人は 1 つ） */
export const STAFF_STAY_LIMIT = 5;
export async function createStayRoom(ctx: TempVoiceCtx, input: { hubId: string; userId: string; displayName: string; mode?: StayMode; parentId?: string; staff?: boolean }, now = new Date()): Promise<StayRoomResult> {
  const hourly = input.mode === 'hourly';
  const hub = ctx.cfg.tempVoice.hubs.find((h) => h.channelId === input.hubId);
  if (!hub) return { status: 'failed' };
  if (busy.has(input.userId)) return { status: 'busy' };
  busy.add(input.userId);
  try {
    // 運営は 2 つ目からも立てられる（STAFF_STAY_LIMIT まで）。運営でない人は、残っている宿を返す
    const live: { channelId: string; keepUntil: Date }[] = [];
    for (const row of await ctx.db.select().from(tempVoice).where(and(eq(tempVoice.ownerId, input.userId), eq(tempVoice.hubId, hub.channelId)))) {
      if (ctx.ops.occupancy(row.channelId) === undefined) {
        await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, row.channelId));
        continue;
      }
      if (row.keepUntil && row.keepUntil > now) live.push({ channelId: row.channelId, keepUntil: row.keepUntil });
    }
    if (live.length >= (input.staff ? STAFF_STAY_LIMIT : 1)) return { status: 'exists', ...live[live.length - 1]! };
    let channelId: string;
    try {
      channelId = await ctx.ops.create({ hubId: hub.channelId, name: `${hourly ? '⏱' : '🏨'} ${roomName(hub.name, input.displayName)}`.slice(0, 100), ownerId: input.userId, ...(input.parentId ? { parentId: input.parentId } : {}) });
    } catch (err) {
      logger.warn({ err }, '宿を作れませんでした（BOT の「チャンネルの管理」権限）');
      return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
    }
    // 🏮 奉納（ブースト）している人は、宿代が無料
    const price = (await isBoosting(ctx.db, input.userId)) ? 0 : hourly ? ctx.cfg.rooms.stayHourlyPrice : ctx.cfg.rooms.stayPrice;
    const keepUntil = new Date(now.getTime() + (hourly ? HOURLY_STAY_MS : STAY_MS));
    // 宿代で公開の部屋代もふくむ（種類を変えたときは、公開との差額だけ払う）
    const ok = await ctx.db.transaction(async (tx) => {
      if (price > 0 && !(await spendWithin(tx, input.userId, price, 'room', { channelId, stay: true, ...(hourly ? { hourly: true } : { hours: STAY_MS / 3_600_000 }) }))) return false;
      await tx.insert(tempVoice).values({ channelId, ownerId: input.userId, hubId: hub.channelId, createdAt: now, keepUntil, renewHourly: hourly, paid: ctx.cfg.rooms.once.public });
      return true;
    });
    if (!ok) {
      await ctx.ops.remove(channelId).catch((err) => logger.warn({ err, channelId }, 'stay room cleanup failed'));
      return { status: 'insufficient', price };
    }
    return { status: 'created', channelId, keepUntil, charged: price };
  } finally {
    busy.delete(input.userId);
  }
}

/**
 * 🗑 宿を今すぐ消す（部屋主・運営が手で消すとき）。払った宿代は返さない。
 * 1日延長・1時間ごとの払い・空いたときの自動削除と同じ鍵（select … for update）を取り、ぶつからないようにする。
 * removeChannel（Discord のチャンネルを消す）が失敗したら、記録は消さずに全部戻す。もう消えていた（10003・404）のは成功あつかい
 */
export async function closeRoomNow(db: Db, channelId: string, removeChannel: (channelId: string) => Promise<void>, by: string, via: 'discord' | 'web'): Promise<'ok' | 'not_found'> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(tempVoice).where(eq(tempVoice.channelId, channelId)).for('update');
    if (!row) return 'not_found' as const;
    try { await removeChannel(channelId); }
    catch (err) {
      const code = err && typeof err === 'object' ? ((err as { code?: unknown }).code ?? (err as { status?: unknown }).status) : undefined;
      if (code !== 10003 && code !== 404) throw err;
    }
    await tx.delete(roomPayers).where(eq(roomPayers.channelId, channelId));
    await tx.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
    await audit(tx, { actorId: by, targetId: row.ownerId, action: 'room.delete', detail: { channelId, kind: row.kind, keepUntil: row.keepUntil?.toISOString() ?? null, renewHourly: row.renewHourly }, via });
    return 'ok' as const;
  });
}

export async function removeRoom(ctx: TempVoiceCtx, channelId: string): Promise<void> {
  await ctx.ops.remove(channelId);
  await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
}
