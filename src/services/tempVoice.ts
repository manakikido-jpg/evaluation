import { and, eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { tempVoice } from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * 自分の通話部屋。
 * 「➕ 縁側をひらく」などの通話（hub）に入ると、その人の通話が同じカテゴリにでき、そこへ移動する。
 * 全員が抜けたら消す。作った人は名前・人数の上限を変えられる。
 */

/** Discord の操作（テストでは偽物に差し替える） */
export interface VoiceOps {
  /** hub と同じカテゴリ・同じ見える範囲で通話を作り、作った人に名前などの変更を許す。作った通話の ID を返す */
  create(input: { hubId: string; name: string; ownerId: string }): Promise<string>;
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
      channelId = await ctx.ops.create({ hubId: hub.channelId, name: roomName(hub.name, input.displayName), ownerId: input.userId });
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
  const n = ctx.ops.occupancy(channelId);
  if (n === undefined) {
    await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
    return false;
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

export async function removeRoom(ctx: TempVoiceCtx, channelId: string): Promise<void> {
  await ctx.ops.remove(channelId);
  await ctx.db.delete(tempVoice).where(eq(tempVoice.channelId, channelId));
}
