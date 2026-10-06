import { deflateRawSync, crc32 } from 'node:zlib';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ideaComments, ideaFiles, ideas, ideaVotes, type Idea, type IdeaComment, type IdeaFile } from '../db/schema.js';
import { detectImage } from './notices.js';

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

/** 外側の ideas.id（idea_files にも id があるので、表の名前つきで書く） */
const IDEAS_ID = sql.raw('"ideas"."id"');

export type IdeaRow = Idea & { votes: number; comments: number; voted: boolean; files: number; thumb: number | null };

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
      votes: sql<number>`(select count(*)::int from ${ideaVotes} v where v.idea_id = ${IDEAS_ID})`,
      comments: sql<number>`(select count(*)::int from ${ideaComments} c where c.idea_id = ${IDEAS_ID})`,
      voted: sql<boolean>`exists(select 1 from ${ideaVotes} v where v.idea_id = ${IDEAS_ID} and v.member_id = ${viewer})`,
      files: sql<number>`(select count(*)::int from ${ideaFiles} f where f.idea_id = ${IDEAS_ID})`,
      thumb: sql<number | null>`(select f.id from ${ideaFiles} f where f.idea_id = ${IDEAS_ID} and f.comment_id is null and f.content_type like 'image/%' order by f.at, f.id limit 1)`,
    })
    .from(ideas)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ideas.pinned), desc(ideas.updatedAt), desc(ideas.id))
    .limit(300);
  return rows.map((r) => ({ ...r.idea, votes: r.votes, comments: r.comments, voted: r.voted, files: r.files, thumb: r.thumb === null ? null : Number(r.thumb) }));
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

export async function getIdea(db: Db, id: number, viewer: string): Promise<{ idea: IdeaRow; comments: IdeaComment[]; voters: string[]; files: IdeaFile[] } | undefined> {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, id));
  if (!idea) return undefined;
  const [comments, votes, files] = await Promise.all([
    db.select().from(ideaComments).where(eq(ideaComments.ideaId, id)).orderBy(asc(ideaComments.at), asc(ideaComments.id)),
    db.select({ memberId: ideaVotes.memberId }).from(ideaVotes).where(eq(ideaVotes.ideaId, id)).orderBy(asc(ideaVotes.at)),
    listIdeaFiles(db, id),
  ]);
  const voters = votes.map((v) => v.memberId);
  const thumb = files.find((f) => f.commentId === null && f.contentType.startsWith('image/'))?.id ?? null;
  return { idea: { ...idea, votes: voters.length, comments: comments.length, voted: voters.includes(viewer), files: files.length, thumb }, comments, voters, files };
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
    await tx.delete(ideaFiles).where(eq(ideaFiles.ideaId, id));
    await tx.delete(ideaComments).where(eq(ideaComments.ideaId, id));
    await tx.delete(ideaVotes).where(eq(ideaVotes.ideaId, id));
    const r = await tx.delete(ideas).where(eq(ideas.id, id)).returning({ id: ideas.id });
    return r.length > 0;
  });
}

/** コメントを書く。allowEmpty: 写真・ファイルだけのコメント */
export async function addIdeaComment(db: Db, id: number, body: string, by: string, opts: { allowEmpty?: boolean } = {}): Promise<IdeaComment | undefined> {
  const text = clean(body, IDEA_COMMENT_MAX);
  if (!text && !opts.allowEmpty) return undefined;
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
  await db.delete(ideaFiles).where(eq(ideaFiles.commentId, commentId));
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

// ───────── 📎 写真・ファイル ─────────

export const IDEA_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** 1 回に付けられる数 */
export const IDEA_FILES_PER_POST = 10;
/** 写真のほかに付けられるファイル（ダウンロードだけ。中身はそのまま渡す） */
export const IDEA_FILE_EXTS = ['pdf', 'zip', 'txt', 'md', 'csv', 'json', 'mp4', 'mov', 'mp3', 'm4a', 'wav', 'psd', 'clip'];
export const IDEA_FILE_ACCEPT = ['image/*', ...IDEA_FILE_EXTS.map((e) => `.${e}`)].join(',');

/** ファイル名をきれいに（フォルダ・制御文字を外して 100 文字まで） */
export function cleanFileName(name: string, fallback = 'file'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const n = [...base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim()].slice(-100).join('');
  return n && n !== '.' && n !== '..' ? n : fallback;
}

/**
 * 写真・ファイルを付ける。写真は中身で見分ける（PNG・JPEG・GIF・WebP）。写真でないものは、決まった拡張子だけ。
 * 返すのは、入った数と入らなかった名前
 */
export async function addIdeaFiles(
  db: Db,
  ideaId: number,
  commentId: number | null,
  files: { name: string; data: Uint8Array }[],
  by: string,
): Promise<{ saved: number; rejected: string[] }> {
  const rejected: string[] = [];
  let saved = 0;
  for (const [k, f] of files.entries()) {
    const img = detectImage(f.data);
    let name = cleanFileName(f.name, img ? `photo${k + 1}.${img.ext}` : `file${k + 1}`);
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (k >= IDEA_FILES_PER_POST || f.data.byteLength === 0 || f.data.byteLength > IDEA_FILE_MAX_BYTES || (!img && !IDEA_FILE_EXTS.includes(ext))) {
      rejected.push(name);
      continue;
    }
    // 写真の拡張子は中身に合わせる（.jpg と書いて中身が PNG など）
    if (img && !new RegExp(`\\.(${img.ext}${img.ext === 'jpg' ? '|jpeg' : ''})$`, 'i').test(name)) name = `${name.replace(/\.[^.]*$/, '')}.${img.ext}`;
    await db.insert(ideaFiles).values({ ideaId, commentId, name, contentType: img ? img.type : 'application/octet-stream', size: f.data.byteLength, data: f.data, by });
    saved++;
  }
  if (saved) await db.update(ideas).set({ updatedAt: new Date() }).where(eq(ideas.id, ideaId));
  return { saved, rejected };
}

const fileMeta = { id: ideaFiles.id, ideaId: ideaFiles.ideaId, commentId: ideaFiles.commentId, name: ideaFiles.name, contentType: ideaFiles.contentType, size: ideaFiles.size, by: ideaFiles.by, at: ideaFiles.at };

/** 付いている写真・ファイル（中身は読まない） */
export async function listIdeaFiles(db: Db, ideaId: number, opts: { body?: boolean } = {}): Promise<IdeaFile[]> {
  return db
    .select(fileMeta)
    .from(ideaFiles)
    .where(and(eq(ideaFiles.ideaId, ideaId), ...(opts.body ? [isNull(ideaFiles.commentId)] : [])))
    .orderBy(asc(ideaFiles.at), asc(ideaFiles.id));
}

export async function getIdeaFile(db: Db, id: number): Promise<(IdeaFile & { data: Uint8Array }) | undefined> {
  const [row] = await db.select().from(ideaFiles).where(eq(ideaFiles.id, id));
  return row;
}

/** 消す（付けた人・宮司・本文につけたものは本文を直せる人）。消したらアイデアの番号 */
export async function deleteIdeaFile(db: Db, id: number, who: { userId: string; guji: boolean }): Promise<number | undefined> {
  const [f] = await db.select(fileMeta).from(ideaFiles).where(eq(ideaFiles.id, id));
  if (!f) return undefined;
  const [idea] = await db.select({ createdBy: ideas.createdBy }).from(ideas).where(eq(ideas.id, f.ideaId));
  const ok = who.guji || f.by === who.userId || (f.commentId === null && idea?.createdBy === who.userId);
  if (!ok) return undefined;
  await db.delete(ideaFiles).where(eq(ideaFiles.id, id));
  return f.ideaId;
}

/** 全部を 1 つの zip に（同じ名前は「名前 (2).jpg」に） */
export async function ideaFilesZip(db: Db, ideaId: number): Promise<Buffer | undefined> {
  const rows = await db.select().from(ideaFiles).where(eq(ideaFiles.ideaId, ideaId)).orderBy(asc(ideaFiles.at), asc(ideaFiles.id));
  if (!rows.length) return undefined;
  const used = new Set<string>();
  const unique = (name: string) => {
    let n = name;
    for (let k = 2; used.has(n.toLowerCase()); k++) n = name.replace(/(\.[^.]*)?$/, (ext) => ` (${k})${ext}`);
    used.add(n.toLowerCase());
    return n;
  };
  return zip(rows.map((r) => ({ name: unique(r.name), data: Buffer.from(r.data), at: r.at })));
}

/** かんたんな zip（写真はそのまま・ほかは縮める。ファイル名は UTF-8） */
export function zip(files: { name: string; data: Buffer; at: Date }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflate = !detectImage(f.data);
    const body = deflate ? deflateRawSync(f.data) : f.data;
    const method = deflate && body.length < f.data.length ? 8 : 0;
    const out = method ? body : f.data;
    const crc = crc32(f.data) >>> 0;
    const d = new Date(f.at.getTime() + 9 * 3_600_000);
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
    const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 の名前
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(out.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, out);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(out.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + out.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
