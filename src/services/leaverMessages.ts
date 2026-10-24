import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { castSessions, memberMessages, supportTickets } from '../db/schema.js';

/**
 * 🧹 抜けた人の書き込みを消すために、書き込みの番号（だれが・どのチャンネルに）だけを覚えておく。中身は残さない。
 */
export async function recordMessage(db: Db, m: { id: string; channelId: string; authorId: string; at?: Date }): Promise<void> {
  await db.insert(memberMessages).values({ messageId: m.id, channelId: m.channelId, authorId: m.authorId, createdAt: m.at ?? new Date() }).onConflictDoNothing();
}

/** 消された書き込みは忘れる */
export async function forgetMessages(db: Db, ids: string[]): Promise<void> {
  if (ids.length) await db.delete(memberMessages).where(inArray(memberMessages.messageId, ids));
}

/** その人の覚えている書き込みを、チャンネルごとにまとめて取り出す（取り出したら忘れる） */
export async function takeMessages(db: Db, authorId: string): Promise<Map<string, { id: string; at: Date }[]>> {
  const rows = await db.delete(memberMessages).where(eq(memberMessages.authorId, authorId)).returning();
  const out = new Map<string, { id: string; at: Date }[]>();
  for (const r of rows) {
    const list = out.get(r.channelId) ?? [];
    list.push({ id: r.messageId, at: r.createdAt });
    out.set(r.channelId, list);
  }
  return out;
}

/** 残すチャンネル: キャストの予約のスレッド・お問い合わせ（チケット）のチャンネル */
export async function keptChannelIds(db: Db): Promise<Set<string>> {
  const [threads, tickets] = await Promise.all([
    db.selectDistinct({ id: castSessions.threadId }).from(castSessions).where(isNotNull(castSessions.threadId)),
    db.selectDistinct({ id: supportTickets.channelId }).from(supportTickets).where(and(isNotNull(supportTickets.channelId))),
  ]);
  return new Set([...threads, ...tickets].map((r) => r.id).filter((id): id is string => Boolean(id)));
}
