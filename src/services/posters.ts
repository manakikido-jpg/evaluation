import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { intros, members } from '../db/schema.js';

/**
 * 「🌸 朱印を押す」ボタンで選べる相手: そのチャンネルに投稿している人（新しく投稿した順）。
 * 最近のメッセージの書いた人と、#絵馬 の自己紹介の記録を合わせる。BOT・退出した人・自分は除く。
 */

export type Poster = { id: string; name: string; lastAt: number };

/** 1 ページに出す人数（Discord の選ぶ欄は 25 まで） */
export const POSTERS_PER_PAGE = 25;

export async function channelPosters(
  db: Db,
  channelId: string,
  /** 最近のメッセージの書いた人と日時（BOT はのぞいて渡す） */
  recent: { authorId: string; at: number }[],
  selfId: string,
): Promise<Poster[]> {
  const last = new Map<string, number>();
  const note = (id: string, at: number) => last.set(id, Math.max(last.get(id) ?? 0, at));
  for (const m of recent) note(m.authorId, m.at);
  for (const i of await db.select({ id: intros.memberId, at: intros.postedAt }).from(intros).where(eq(intros.channelId, channelId))) note(i.id, i.at.getTime());
  last.delete(selfId);
  const ids = [...last.keys()];
  if (!ids.length) return [];
  const rows = await db
    .select({ id: members.id, name: members.displayName })
    .from(members)
    .where(and(inArray(members.id, ids), isNull(members.leftAt), eq(members.isBot, false)));
  return rows.map((r) => ({ id: r.id, name: r.name, lastAt: last.get(r.id)! })).sort((a, b) => b.lastAt - a.lastAt);
}

/** ページで分ける（0 から） */
export function posterPage(list: Poster[], page: number): { items: Poster[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / POSTERS_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { items: list.slice(p * POSTERS_PER_PAGE, (p + 1) * POSTERS_PER_PAGE), page: p, pages };
}
