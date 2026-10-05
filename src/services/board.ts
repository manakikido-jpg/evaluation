import { and, desc, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { boardEntries, boardPosts, settings, type BoardEntry, type BoardPost } from '../db/schema.js';
import { autoRanks, currentAutoRank } from '../domain/ranks.js';
import { addCoins, spendWithin, walletOf } from './economy.js';

/**
 * 📌 掲示板: 仕事・手伝い・仲間・イベントなどの募集。入鯖が承認された人（役職のある人）ならだれでも書ける。
 * 報酬（銭）を付けると、1 人あたり × 人数を宮が預かり、採用した人に「完了」（または期限）で渡す（市場と同じ手数料を引く）。
 * 締め切ったら、採用しなかった分は募集した人に戻す。「問題あり」は運営が決める（渡す・戻す）。
 */

export type BoardCategory = 'work' | 'help' | 'team' | 'event' | 'other';
export const BOARD_CATEGORIES: Record<BoardCategory, { label: string; emoji: string }> = {
  work: { label: '仕事・依頼', emoji: '💼' },
  help: { label: '手伝い', emoji: '🤝' },
  team: { label: '仲間', emoji: '👥' },
  event: { label: 'イベント', emoji: '🎉' },
  other: { label: 'その他', emoji: '📌' },
};
export const isBoardCategory = (v: unknown): v is BoardCategory => typeof v === 'string' && Object.hasOwn(BOARD_CATEGORIES, v);

export const BOARD = { maxSlots: 20, maxDays: 30, maxEscrow: 1_000_000 } as const;
const DAY = 86_400_000;

const lock = (tx: Db, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
export const boardFee = (cfg: GuildConfig, reward: number) => Math.floor((reward * cfg.market.feePercent) / 100);
const hasRank = (cfg: GuildConfig, roleIds: readonly string[]) => cfg.ranks.some((r) => roleIds.includes(r.roleId));

// ───────── 置き場所（設定） ─────────

const KEY = 'board';
export type BoardPlace = { channelId?: string; panelMessageId?: string };

export async function loadBoardPlace(db: Db): Promise<BoardPlace> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const id = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);
  return { channelId: id(v.channelId), panelMessageId: id(v.panelMessageId) };
}

export async function saveBoardPlace(db: Db, place: BoardPlace, by: string): Promise<void> {
  const value = { channelId: place.channelId ?? null, panelMessageId: place.panelMessageId ?? null };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

// ───────── 書く ─────────

export type PostInput = { category: string; title: string; body: string; slots: number; reward: number; days: number };
export type PostResult =
  | { status: 'ok'; post: BoardPost; balance: number }
  | { status: 'no_rank' | 'invalid' }
  | { status: 'reward_rank'; rankName: string }
  | { status: 'insufficient'; need: number; balance: number };

export async function createPost(db: Db, cfg: GuildConfig, author: { id: string; roleIds: readonly string[] }, input: PostInput, now = new Date()): Promise<PostResult> {
  if (!hasRank(cfg, author.roleIds)) return { status: 'no_rank' };
  const title = input.title.replace(/\s+/g, ' ').trim();
  const body = input.body.trim();
  const { slots, reward, days } = input;
  if (!isBoardCategory(input.category) || !title || title.length > 60 || body.length > 1000) return { status: 'invalid' };
  if (!Number.isInteger(slots) || slots < 1 || slots > BOARD.maxSlots || !Number.isInteger(days) || days < 1 || days > BOARD.maxDays) return { status: 'invalid' };
  if (!Number.isInteger(reward) || reward < 0 || reward * slots > BOARD.maxEscrow) return { status: 'invalid' };
  // 報酬を付けられるのは 2 段目の役職（氏子）以上か運営（サブ垢で銭を流せないように）
  if (reward > 0) {
    const [first, second] = autoRanks(cfg.ranks);
    const current = currentAutoRank(cfg.ranks, author.roleIds);
    const isStaff = cfg.ranks.some((r) => !r.auto && author.roleIds.includes(r.roleId));
    if (second && !isStaff && (!current || current.key === first?.key)) return { status: 'reward_rank', rankName: second.name };
  }
  const need = reward * slots;
  return db.transaction(async (tx) => {
    await lock(tx, `board:${author.id}`);
    if (need > 0 && !(await spendWithin(tx, author.id, need, 'board_hold', { title, slots, reward }))) {
      return { status: 'insufficient' as const, need, balance: (await walletOf(tx, author.id)).balance };
    }
    const [post] = await tx
      .insert(boardPosts)
      .values({ authorId: author.id, category: input.category, title, body, slots, reward, escrow: need, deadlineAt: new Date(now.getTime() + days * DAY), createdAt: now })
      .returning();
    return { status: 'ok' as const, post: post!, balance: (await walletOf(tx, author.id)).balance };
  });
}

export async function setPostMessage(db: Db, id: number, v: { channelId: string; messageId: string; threadId?: string; applyThreadId?: string }): Promise<void> {
  await db.update(boardPosts).set(v).where(eq(boardPosts.id, id));
}

/** Discord のカードを見守る募集（募集中か、まだ銭を預かっている） */
export async function livePosts(db: Db): Promise<BoardPost[]> {
  return db
    .select()
    .from(boardPosts)
    .where(and(isNotNull(boardPosts.messageId), or(eq(boardPosts.status, 'open'), gt(boardPosts.escrow, 0))));
}

export async function postByMessage(db: Db, messageId: string): Promise<BoardPost | undefined> {
  const [row] = await db.select().from(boardPosts).where(eq(boardPosts.messageId, messageId));
  return row;
}

/** 採用したあとのやり取りのスレッド（募集した人と採用された人だけ） */
export async function setEntryThread(db: Db, id: number, threadId: string): Promise<void> {
  await db.update(boardEntries).set({ threadId }).where(eq(boardEntries.id, id));
}

export async function getPost(db: Db, id: number): Promise<BoardPost | undefined> {
  const [row] = await db.select().from(boardPosts).where(eq(boardPosts.id, id));
  return row;
}

export async function getEntry(db: Db, id: number): Promise<BoardEntry | undefined> {
  const [row] = await db.select().from(boardEntries).where(eq(boardEntries.id, id));
  return row;
}

export async function entriesOf(db: Db, postId: number): Promise<BoardEntry[]> {
  return db.select().from(boardEntries).where(eq(boardEntries.postId, postId)).orderBy(boardEntries.createdAt);
}

/** 採用した人の数（完了・問題あり・戻したものも数える） */
export const hiredCount = (entries: BoardEntry[]) => entries.filter((e) => e.status !== 'applied').length;

// ───────── 応募・採用 ─────────

export type ApplyResult = { status: 'ok'; entry: BoardEntry; post: BoardPost } | { status: 'closed' | 'self' | 'already' | 'no_rank' | 'gone' };

export async function applyPost(db: Db, cfg: GuildConfig, postId: number, member: { id: string; roleIds: readonly string[] }, now = new Date()): Promise<ApplyResult> {
  const post = await getPost(db, postId);
  if (!post) return { status: 'gone' };
  if (post.status !== 'open' || post.deadlineAt <= now) return { status: 'closed' };
  if (post.authorId === member.id) return { status: 'self' };
  if (!hasRank(cfg, member.roleIds)) return { status: 'no_rank' };
  const [entry] = await db.insert(boardEntries).values({ postId, memberId: member.id, createdAt: now }).onConflictDoNothing().returning();
  if (!entry) return { status: 'already' };
  return { status: 'ok', entry, post };
}

export type HireResult = { status: 'ok'; entry: BoardEntry; post: BoardPost; full: boolean } | { status: 'not_author' | 'full' | 'not_applied' | 'gone' };

/** 採用する（募集した人）。人数がいっぱいになったら締め切る */
export async function hire(db: Db, cfg: GuildConfig, entryId: number, by: string, now = new Date()): Promise<HireResult> {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(boardEntries).where(eq(boardEntries.id, entryId));
    if (!e) return { status: 'gone' as const };
    await lock(tx, `boardpost:${e.postId}`);
    const [post] = await tx.select().from(boardPosts).where(eq(boardPosts.id, e.postId));
    if (!post || post.status === 'removed') return { status: 'gone' as const };
    if (post.authorId !== by) return { status: 'not_author' as const };
    const all = await tx.select().from(boardEntries).where(eq(boardEntries.postId, post.id));
    const cur = all.find((x) => x.id === entryId)!;
    if (cur.status !== 'applied') return { status: 'not_applied' as const };
    if (hiredCount(all) >= post.slots) return { status: 'full' as const };
    const [entry] = await tx
      .update(boardEntries)
      .set({ status: 'hired', hiredAt: now, ...(post.reward > 0 ? { releaseAt: new Date(now.getTime() + cfg.market.autoReleaseDays * DAY) } : {}) })
      .where(eq(boardEntries.id, entryId))
      .returning();
    const full = hiredCount(all) + 1 >= post.slots;
    if (full && post.status === 'open') await tx.update(boardPosts).set({ status: 'closed', closedAt: now }).where(eq(boardPosts.id, post.id));
    return { status: 'ok' as const, entry: entry!, post: full && post.status === 'open' ? { ...post, status: 'closed' as const, closedAt: now } : post, full };
  });
}

// ───────── 報酬を渡す・戻す ─────────

export type PayResult = { status: 'ok'; entry: BoardEntry; post: BoardPost; paid: number } | { status: 'not_allowed' | 'not_hired' | 'gone' };

/**
 * 採用した人に報酬を渡す（募集した人の「完了」・期限・運営）。報酬なしの募集は「完了」の印だけ。
 * 渡すのは、採用中か問題ありのものだけ
 */
export async function completeEntry(db: Db, cfg: GuildConfig, entryId: number, by: string, opts: { staff?: boolean } = {}, now = new Date()): Promise<PayResult> {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(boardEntries).where(eq(boardEntries.id, entryId));
    if (!e) return { status: 'gone' as const };
    await lock(tx, `boardpost:${e.postId}`);
    const [post] = await tx.select().from(boardPosts).where(eq(boardPosts.id, e.postId));
    if (!post) return { status: 'gone' as const };
    if (by !== 'system' && !opts.staff && by !== post.authorId) return { status: 'not_allowed' as const };
    // 問題ありは運営だけが決める
    const [cur] = await tx.select().from(boardEntries).where(eq(boardEntries.id, entryId));
    if (!cur || !(cur.status === 'hired' || (opts.staff && cur.status === 'disputed'))) return { status: 'not_hired' as const };
    const reward = Math.min(post.reward, post.escrow);
    const pay = reward - boardFee(cfg, reward);
    if (pay > 0) await addCoins(tx, cur.memberId, pay, 'board_reward', { postId: post.id, entryId, from: post.authorId, fee: reward - pay });
    const [p] = await tx.update(boardPosts).set({ escrow: post.escrow - reward }).where(eq(boardPosts.id, post.id)).returning();
    const [entry] = await tx.update(boardEntries).set({ status: 'done', paid: Math.max(0, pay), closedAt: now, decidedBy: by }).where(eq(boardEntries.id, entryId)).returning();
    return { status: 'ok' as const, entry: entry!, post: p!, paid: Math.max(0, pay) };
  });
}

/** 「問題あり」（募集した人か採用された人）。採用中のものだけ。運営が決めるまで期限で渡さない */
export async function disputeEntry(db: Db, entryId: number, by: string): Promise<{ entry: BoardEntry; post: BoardPost } | undefined> {
  const e = await getEntry(db, entryId);
  const post = e ? await getPost(db, e.postId) : undefined;
  if (!e || !post || (by !== post.authorId && by !== e.memberId) || post.reward <= 0) return undefined;
  const [entry] = await db.update(boardEntries).set({ status: 'disputed' }).where(and(eq(boardEntries.id, entryId), eq(boardEntries.status, 'hired'))).returning();
  return entry ? { entry, post } : undefined;
}

/** 運営: 問題ありの報酬を募集した人に戻す */
export async function refundEntry(db: Db, entryId: number, by: string, now = new Date()): Promise<{ entry: BoardEntry; post: BoardPost } | undefined> {
  return db.transaction(async (tx) => {
    const [e] = await tx.select().from(boardEntries).where(eq(boardEntries.id, entryId));
    if (!e) return undefined;
    await lock(tx, `boardpost:${e.postId}`);
    const [post] = await tx.select().from(boardPosts).where(eq(boardPosts.id, e.postId));
    const [entry] = await tx
      .update(boardEntries)
      .set({ status: 'refunded', closedAt: now, decidedBy: by })
      .where(and(eq(boardEntries.id, entryId), inArray(boardEntries.status, ['hired', 'disputed'])))
      .returning();
    if (!post || !entry) return undefined;
    const back = Math.min(post.reward, post.escrow);
    if (back > 0) await addCoins(tx, post.authorId, back, 'board_refund', { postId: post.id, entryId });
    const [p] = await tx.update(boardPosts).set({ escrow: post.escrow - back }).where(eq(boardPosts.id, post.id)).returning();
    return { entry, post: p! };
  });
}

// ───────── 締め切る ─────────

/**
 * 締め切る（本人・期限・運営の取り下げ）。採用しなかった分の報酬を募集した人に戻す。
 * 採用した人の分は、そのまま「完了」を待つ
 */
export async function closePost(db: Db, postId: number, by: string, opts: { staff?: boolean } = {}, now = new Date()): Promise<{ post: BoardPost; refunded: number } | undefined> {
  return db.transaction(async (tx) => {
    await lock(tx, `boardpost:${postId}`);
    const [post] = await tx.select().from(boardPosts).where(eq(boardPosts.id, postId));
    if (!post || post.status === 'removed') return undefined;
    if (by !== 'system' && !opts.staff && by !== post.authorId) return undefined;
    if (post.status === 'closed' && !opts.staff) return undefined;
    const all = await tx.select().from(boardEntries).where(eq(boardEntries.postId, postId));
    const waiting = all.filter((x) => x.status === 'hired' || x.status === 'disputed').length;
    // 預かっている分のうち、採用中の人の分は残す
    const refunded = Math.max(0, post.escrow - waiting * post.reward);
    if (refunded > 0) await addCoins(tx, post.authorId, refunded, 'board_refund', { postId, unfilled: true });
    const [p] = await tx
      .update(boardPosts)
      .set({ status: opts.staff ? 'removed' : 'closed', closedAt: post.closedAt ?? now, escrow: post.escrow - refunded })
      .where(eq(boardPosts.id, postId))
      .returning();
    return { post: p!, refunded };
  });
}

/** 10 分ごと: 期限が来た募集を締め切り、期限が来た採用に報酬を渡す */
export async function boardTick(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ closed: BoardPost[]; paid: { entry: BoardEntry; post: BoardPost; paid: number }[] }> {
  const due = await db.select().from(boardPosts).where(and(eq(boardPosts.status, 'open'), lte(boardPosts.deadlineAt, now)));
  const closed: BoardPost[] = [];
  for (const p of due) {
    const r = await closePost(db, p.id, 'system', {}, now);
    if (r) closed.push(r.post);
  }
  const dueEntries = await db.select().from(boardEntries).where(and(eq(boardEntries.status, 'hired'), lte(boardEntries.releaseAt, now)));
  const paid: { entry: BoardEntry; post: BoardPost; paid: number }[] = [];
  for (const e of dueEntries) {
    const r = await completeEntry(db, cfg, e.id, 'system', {}, now);
    if (r.status === 'ok') paid.push(r);
  }
  return { closed, paid };
}

// ───────── 管理画面 ─────────

export async function recentPosts(db: Db, limit = 100): Promise<BoardPost[]> {
  return db.select().from(boardPosts).orderBy(desc(boardPosts.createdAt)).limit(limit);
}

export async function entriesFor(db: Db, postIds: number[]): Promise<BoardEntry[]> {
  return postIds.length ? db.select().from(boardEntries).where(inArray(boardEntries.postId, postIds)) : [];
}
