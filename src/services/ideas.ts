import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ideaComments, ideas, ideaVotes, type Idea, type IdeaComment } from '../db/schema.js';

/**
 * 💡 アイデア・共有メモ（社務所Web・運営どうし）。
 * 足したい機能・共有したいこと・不具合・メモを書いて、状態（アイデア → 検討中 → やる → 作業中 → できた／見送り）で追いかける。
 * コメントと 👍（1 人 1 回）。書いた人と宮司は直せる・消せる
 */

export const IDEA_KINDS = {
  idea: { emoji: '💡', label: '足したい機能' },
  share: { emoji: '📢', label: '共有' },
  bug: { emoji: '🐞', label: '不具合' },
  memo: { emoji: '📝', label: 'メモ' },
} as const;
export type IdeaKind = keyof typeof IDEA_KINDS;
export const isIdeaKind = (v: unknown): v is IdeaKind => typeof v === 'string' && Object.hasOwn(IDEA_KINDS, v);

export const IDEA_STATUSES = {
  new: { emoji: '💭', label: 'アイデア' },
  review: { emoji: '🔍', label: '検討中' },
  todo: { emoji: '✅', label: 'やる' },
  doing: { emoji: '🛠', label: '作業中' },
  done: { emoji: '🎉', label: 'できた' },
  dropped: { emoji: '⏸', label: '見送り' },
} as const;
export type IdeaStatus = keyof typeof IDEA_STATUSES;
export const isIdeaStatus = (v: unknown): v is IdeaStatus => typeof v === 'string' && Object.hasOwn(IDEA_STATUSES, v);
/** まだ終わっていない状態 */
export const OPEN_STATUSES: IdeaStatus[] = ['new', 'review', 'todo', 'doing'];

export const IDEA_TITLE_MAX = 100;
export const IDEA_BODY_MAX = 4000;
export const IDEA_COMMENT_MAX = 2000;

export type IdeaRow = Idea & { votes: number; comments: number; voted: boolean };

const clean = (s: string, max: number) => s.replace(/\r\n/g, '\n').trim().slice(0, max);

/** 一覧（ピン留め → 新しく動いた順）。open: 終わっていないものだけ */
export async function listIdeas(db: Db, viewer: string, opts: { kind?: IdeaKind; status?: IdeaStatus | 'open'; q?: string } = {}): Promise<IdeaRow[]> {
  const conds = [
    ...(opts.kind ? [eq(ideas.kind, opts.kind)] : []),
    ...(opts.status === 'open' ? [inArray(ideas.status, OPEN_STATUSES)] : opts.status ? [eq(ideas.status, opts.status)] : []),
    ...(opts.q?.trim() ? [or(ilike(ideas.title, `%${opts.q.trim()}%`), ilike(ideas.body, `%${opts.q.trim()}%`))!] : []),
  ];
  const rows = await db
    .select({
      idea: ideas,
      votes: sql<number>`(select count(*)::int from ${ideaVotes} where ${ideaVotes.ideaId} = ${ideas.id})`,
      comments: sql<number>`(select count(*)::int from ${ideaComments} where ${ideaComments.ideaId} = ${ideas.id})`,
      voted: sql<boolean>`exists(select 1 from ${ideaVotes} where ${ideaVotes.ideaId} = ${ideas.id} and ${ideaVotes.memberId} = ${viewer})`,
    })
    .from(ideas)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ideas.pinned), desc(ideas.updatedAt), desc(ideas.id))
    .limit(300);
  return rows.map((r) => ({ ...r.idea, votes: r.votes, comments: r.comments, voted: r.voted }));
}

/** 状態ごと・種類ごとの数 */
export async function ideaCounts(db: Db): Promise<{ byStatus: Record<string, number>; byKind: Record<string, number>; open: number }> {
  const rows = await db.select({ kind: ideas.kind, status: ideas.status, n: sql<number>`count(*)::int` }).from(ideas).groupBy(ideas.kind, ideas.status);
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let open = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r.n;
    if ((OPEN_STATUSES as string[]).includes(r.status)) open += r.n;
  }
  return { byStatus, byKind, open };
}

export async function getIdea(db: Db, id: number, viewer: string): Promise<{ idea: IdeaRow; comments: IdeaComment[]; voters: string[] } | undefined> {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!idea) return undefined;
  const [comments, votes] = await Promise.all([
    db.select().from(ideaComments).where(eq(ideaComments.ideaId, id)).orderBy(asc(ideaComments.at), asc(ideaComments.id)),
    db.select({ memberId: ideaVotes.memberId }).from(ideaVotes).where(eq(ideaVotes.ideaId, id)).orderBy(asc(ideaVotes.at)),
  ]);
  const voters = votes.map((v) => v.memberId);
  return { idea: { ...idea, votes: voters.length, comments: comments.length, voted: voters.includes(viewer) }, comments, voters };
}

export async function createIdea(db: Db, input: { kind: IdeaKind; title: string; body: string; by: string }): Promise<Idea | undefined> {
  const title = clean(input.title, IDEA_TITLE_MAX);
  if (!title) return undefined;
  const [row] = await db.insert(ideas).values({ kind: input.kind, title, body: clean(input.body, IDEA_BODY_MAX), createdBy: input.by, updatedBy: input.by }).returning();
  return row;
}

/** 直せるのは書いた人と宮司 */
export const canEditIdea = (idea: Pick<Idea, 'createdBy'>, who: { userId: string; guji: boolean }) => who.guji || idea.createdBy === who.userId;

export async function updateIdea(db: Db, id: number, input: { kind: IdeaKind; title: string; body: string; by: string }): Promise<boolean> {
  const title = clean(input.title, IDEA_TITLE_MAX);
  if (!title) return false;
  const r = await db
    .update(ideas)
    .set({ kind: input.kind, title, body: clean(input.body, IDEA_BODY_MAX), updatedBy: input.by, updatedAt: new Date() })
    .where(eq(ideas.id, id))
    .returning({ id: ideas.id });
  return r.length > 0;
}

/** 状態を変える（だれでも。運営どうしで進めるので） */
export async function setIdeaStatus(db: Db, id: number, status: IdeaStatus, by: string): Promise<Idea | undefined> {
  const [row] = await db.update(ideas).set({ status, updatedBy: by, updatedAt: new Date() }).where(eq(ideas.id, id)).returning();
  return row;
}

export async function setIdeaPinned(db: Db, id: number, pinned: boolean, by: string): Promise<boolean> {
  const r = await db.update(ideas).set({ pinned, updatedBy: by }).where(eq(ideas.id, id)).returning({ id: ideas.id });
  return r.length > 0;
}

export async function deleteIdea(db: Db, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.delete(ideaComments).where(eq(ideaComments.ideaId, id));
    await tx.delete(ideaVotes).where(eq(ideaVotes.ideaId, id));
    const r = await tx.delete(ideas).where(eq(ideas.id, id)).returning({ id: ideas.id });
    return r.length > 0;
  });
}

export async function addIdeaComment(db: Db, id: number, body: string, by: string): Promise<IdeaComment | undefined> {
  const text = clean(body, IDEA_COMMENT_MAX);
  if (!text) return undefined;
  const [idea] = await db.select({ id: ideas.id }).from(ideas).where(eq(ideas.id, id));
  if (!idea) return undefined;
  const [row] = await db.insert(ideaComments).values({ ideaId: id, body: text, by }).returning();
  // コメントが付いたら、一覧の上に来るように
  await db.update(ideas).set({ updatedAt: new Date() }).where(eq(ideas.id, id));
  return row;
}

export async function deleteIdeaComment(db: Db, commentId: number, who: { userId: string; guji: boolean }): Promise<number | undefined> {
  const [c] = await db.select().from(ideaComments).where(eq(ideaComments.id, commentId));
  if (!c || !(who.guji || c.by === who.userId)) return undefined;
  await db.delete(ideaComments).where(eq(ideaComments.id, commentId));
  return c.ideaId;
}

/** 👍 を付ける・外す。付いたら true */
export async function toggleIdeaVote(db: Db, id: number, memberId: string): Promise<boolean | undefined> {
  const [idea] = await db.select({ id: ideas.id }).from(ideas).where(eq(ideas.id, id));
  if (!idea) return undefined;
  const removed = await db
    .delete(ideaVotes)
    .where(and(eq(ideaVotes.ideaId, id), eq(ideaVotes.memberId, memberId)))
    .returning({ id: ideaVotes.ideaId });
  if (removed.length) return false;
  await db.insert(ideaVotes).values({ ideaId: id, memberId }).onConflictDoNothing();
  return true;
}
