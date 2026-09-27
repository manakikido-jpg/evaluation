import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { intros, type Intro } from '../db/schema.js';

/**
 * 自己紹介（絵馬）の記録。#絵馬-男性・#絵馬-女性 に書かれたら、その人のいちばん新しいものを覚える。
 * プロフィールに本文のはじめとリンクを出す。
 */

export const INTRO_EXCERPT_MAX = 300;

export async function recordIntro(db: Db, input: { memberId: string; channelId: string; messageId: string; content: string; postedAt: Date }): Promise<void> {
  const excerpt = input.content.trim().slice(0, INTRO_EXCERPT_MAX);
  await db
    .insert(intros)
    .values({ memberId: input.memberId, channelId: input.channelId, messageId: input.messageId, excerpt, postedAt: input.postedAt })
    .onConflictDoUpdate({
      target: intros.memberId,
      set: { channelId: input.channelId, messageId: input.messageId, excerpt, postedAt: input.postedAt },
      // 古い書き込みで、新しい記録を上書きしない
      setWhere: sql`${intros.postedAt} <= excluded.posted_at`,
    });
}

export async function introOf(db: Db, memberId: string): Promise<Intro | undefined> {
  const [row] = await db.select().from(intros).where(eq(intros.memberId, memberId));
  return row;
}

export const introUrl = (guildId: string, i: Pick<Intro, 'channelId' | 'messageId'>) => `https://discord.com/channels/${guildId}/${i.channelId}/${i.messageId}`;
