import { eq, inArray, sql } from 'drizzle-orm';
import { introInviterText } from '../domain/introInviter.js';
import type { Db } from '../db/client.js';
import { intros, settings, type Intro } from '../db/schema.js';

/**
 * 自己紹介（絵馬）の記録。#絵馬-男性・#絵馬-女性・#運営紹介（とその中のスレッド）に書かれたら、その人のいちばん新しいものを覚える。
 * プロフィールに本文のはじめとリンクを出す。
 */

export const INTRO_EXCERPT_MAX = 300;

export async function recordIntro(db: Db, input: { memberId: string; channelId: string; messageId: string; content: string; postedAt: Date }): Promise<void> {
  const excerpt = input.content.trim().slice(0, INTRO_EXCERPT_MAX);
  const inviterText = input.content.trim() ? introInviterText(input.content) : null;
  await db
    .insert(intros)
    .values({ memberId: input.memberId, channelId: input.channelId, messageId: input.messageId, excerpt, inviterText, postedAt: input.postedAt })
    .onConflictDoUpdate({
      target: intros.memberId,
      set: { channelId: input.channelId, messageId: input.messageId, excerpt, inviterText, postedAt: input.postedAt },
      // 古い書き込みで、新しい記録を上書きしない
      setWhere: sql`${intros.postedAt} <= excluded.posted_at`,
    });
}

export async function introOf(db: Db, memberId: string): Promise<Intro | undefined> {
  const [row] = await db.select().from(intros).where(eq(intros.memberId, memberId));
  return row;
}

export const introUrl = (guildId: string, i: Pick<Intro, 'channelId' | 'messageId'>) => `https://discord.com/channels/${guildId}/${i.channelId}/${i.messageId}`;

/** 消えた投稿の候補を残さない。別の新しい投稿の記録は消さない。 */
export async function removeIntroMessages(db: Db, messageIds: string[]): Promise<void> {
  if (messageIds.length) await db.delete(intros).where(inArray(intros.messageId, messageIds));
}

/** 自己紹介のチャンネルを、いちばん古い書き込みまで読み直したか（1 回だけ。読み直したチャンネルを覚える） */
const BACKFILL_KEY = 'intros.backfill';
export async function introBackfillDone(db: Db): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, BACKFILL_KEY));
  const v = row?.value as { channels?: unknown } | undefined;
  return Array.isArray(v?.channels) ? v.channels.filter((x): x is string => typeof x === 'string') : [];
}
export async function markIntroBackfill(db: Db, channelIds: string[]): Promise<void> {
  const value = { channels: [...new Set(channelIds)], at: new Date().toISOString() };
  await db.insert(settings).values({ key: BACKFILL_KEY, value, updatedBy: 'system' }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: new Date() } });
}
