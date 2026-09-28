import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { meetings, meetingTodos, members, settings, type Meeting, type MeetingTodo } from '../db/schema.js';
import type { DiscordActions, MessageBody } from '../lib/discordRest.js';
import { audit } from './audit.js';

/**
 * 📓 議事録: 運営の会議の記録（日時・場所・参加した人・議題・話したこと・決まったこと・やること）。
 * やることは担当・期限・済んだかを持ち、まだのものはホームの「対応待ち」にも出る。
 * 会議のあとに、決まったこととやることのまとめを Discord のチャンネルに出せる（出したあと直したら書き換える）。
 */

export type MeetingInput = {
  title: string;
  heldAt: Date;
  placeChannelId: string | null;
  attendees: string[];
  agenda: string;
  notes: string;
  decisions: string;
};
export type TodoInput = { id?: number; body: string; assigneeId: string | null; due: string | null; done: boolean };

export type MeetingRow = Meeting & { todoCount: number; openCount: number };

export async function listMeetings(db: Db, opts: { q?: string; limit?: number } = {}): Promise<MeetingRow[]> {
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : undefined;
  const rows = await db
    .select()
    .from(meetings)
    .where(like ? or(ilike(meetings.title, like), ilike(meetings.agenda, like), ilike(meetings.notes, like), ilike(meetings.decisions, like)) : undefined)
    .orderBy(desc(meetings.heldAt), desc(meetings.id))
    .limit(opts.limit ?? 100);
  if (!rows.length) return [];
  const counts = await db
    .select({
      meetingId: meetingTodos.meetingId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${meetingTodos.doneAt} is null)::int`,
    })
    .from(meetingTodos)
    .where(inArray(meetingTodos.meetingId, rows.map((r) => r.id)))
    .groupBy(meetingTodos.meetingId);
  const by = new Map(counts.map((c) => [c.meetingId, c]));
  return rows.map((r) => ({ ...r, todoCount: by.get(r.id)?.total ?? 0, openCount: by.get(r.id)?.open ?? 0 }));
}

export async function getMeeting(db: Db, id: number): Promise<{ meeting: Meeting; todos: MeetingTodo[] } | undefined> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!meeting) return undefined;
  const todos = await db.select().from(meetingTodos).where(eq(meetingTodos.meetingId, id)).orderBy(asc(meetingTodos.position), asc(meetingTodos.id));
  return { meeting, todos };
}

/** やることを入れ直す（ID のあるものは直す・ないものは足す・消えたものは消す。空の行は使わない） */
async function saveTodos(db: Db, meetingId: number, list: TodoInput[], by: string, now: Date): Promise<void> {
  const before = await db.select().from(meetingTodos).where(eq(meetingTodos.meetingId, meetingId));
  const keep = new Set<number>();
  let pos = 0;
  for (const t of list) {
    const body = t.body.trim();
    if (!body) continue;
    const old = t.id ? before.find((b) => b.id === t.id) : undefined;
    const done = t.done ? { doneAt: old?.doneAt ?? now, doneBy: old?.doneBy ?? by } : { doneAt: null, doneBy: null };
    const values = { body, assigneeId: t.assigneeId, due: t.due, position: pos++, ...done };
    if (old) {
      keep.add(old.id);
      await db.update(meetingTodos).set(values).where(eq(meetingTodos.id, old.id));
    } else {
      await db.insert(meetingTodos).values({ meetingId, ...values });
    }
  }
  const gone = before.filter((b) => !keep.has(b.id)).map((b) => b.id);
  if (gone.length) await db.delete(meetingTodos).where(inArray(meetingTodos.id, gone));
}

export async function createMeeting(db: Db, input: MeetingInput, todos: TodoInput[], by: string, now = new Date()): Promise<Meeting> {
  const [m] = await db
    .insert(meetings)
    .values({ ...input, createdBy: by, updatedBy: by })
    .returning();
  await saveTodos(db, m!.id, todos, by, now);
  await audit(db, { actorId: by, action: 'meeting.create', detail: { id: m!.id, title: input.title }, via: 'web' });
  return m!;
}

export async function updateMeeting(db: Db, id: number, input: MeetingInput, todos: TodoInput[], by: string, now = new Date()): Promise<void> {
  await db
    .update(meetings)
    .set({ ...input, updatedBy: by, updatedAt: now })
    .where(eq(meetings.id, id));
  await saveTodos(db, id, todos, by, now);
  await audit(db, { actorId: by, action: 'meeting.update', detail: { id, title: input.title }, via: 'web' });
}

export async function deleteMeeting(db: Db, id: number, by: string): Promise<void> {
  const found = await getMeeting(db, id);
  if (!found) return;
  await db.delete(meetings).where(eq(meetings.id, id));
  await audit(db, { actorId: by, action: 'meeting.delete', detail: { id, title: found.meeting.title }, via: 'web' });
}

/** やることの 済 ⇔ まだ を切り替える。切り替えたあとの状態（見つからなければ undefined） */
export async function toggleTodo(db: Db, todoId: number, by: string, now = new Date()): Promise<boolean | undefined> {
  const [t] = await db.select().from(meetingTodos).where(eq(meetingTodos.id, todoId));
  if (!t) return undefined;
  const done = !t.doneAt;
  await db
    .update(meetingTodos)
    .set(done ? { doneAt: now, doneBy: by } : { doneAt: null, doneBy: null })
    .where(eq(meetingTodos.id, todoId));
  return done;
}

export type OpenTodo = MeetingTodo & { meetingTitle: string; heldAt: Date };

/** まだのやること（期限の近い順。期限なしはあと） */
export async function openTodos(db: Db, opts: { assigneeId?: string } = {}): Promise<OpenTodo[]> {
  const rows = await db
    .select({ t: meetingTodos, title: meetings.title, heldAt: meetings.heldAt })
    .from(meetingTodos)
    .innerJoin(meetings, eq(meetings.id, meetingTodos.meetingId))
    .where(and(isNull(meetingTodos.doneAt), opts.assigneeId ? eq(meetingTodos.assigneeId, opts.assigneeId) : undefined))
    .orderBy(sql`${meetingTodos.due} asc nulls last`, desc(meetings.heldAt), asc(meetingTodos.position));
  return rows.map((r) => ({ ...r.t, meetingTitle: r.title, heldAt: r.heldAt }));
}

export async function countOpenTodos(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(meetingTodos).where(isNull(meetingTodos.doneAt));
  return row?.n ?? 0;
}

// ───────── 参加した人・担当に選べる人 ─────────

/** 運営のロール（任命制の役職・神職・宮司） */
export function staffRoleIds(cfg: GuildConfig): Set<string> {
  return new Set([...cfg.ranks.filter((r) => !r.auto).map((r) => r.roleId), ...(cfg.admin?.shinshokuRoleIds ?? []), ...(cfg.admin?.gujiRoleIds ?? [])]);
}

export type Person = { id: string; name: string; staff: boolean };

/** 選べる人: 運営（先に）と、指定した人（通話にいる人・前に選んだ人） */
export async function pickablePeople(db: Db, cfg: GuildConfig, extraIds: string[] = []): Promise<Person[]> {
  const staff = staffRoleIds(cfg);
  const rows = await db
    .select({ id: members.id, name: members.displayName, roleIds: members.roleIds, leftAt: members.leftAt })
    .from(members)
    .where(and(eq(members.isBot, false), or(isNull(members.leftAt), extraIds.length ? inArray(members.id, extraIds) : sql`false`)));
  const extra = new Set(extraIds);
  return rows
    .map((r) => ({ id: r.id, name: r.name, staff: r.roleIds.some((id) => staff.has(id)) }))
    .filter((p) => p.staff || extra.has(p.id))
    .sort((a, b) => Number(b.staff) - Number(a.staff) || a.name.localeCompare(b.name, 'ja'));
}

// ───────── いま通話にいる人（BOT が 1 分ごとに残す） ─────────

const VOICE_NOW_KEY = 'voice_now';
export type VoiceNow = { id: string; name: string; memberIds: string[] }[];

export async function saveVoiceNow(db: Db, channels: VoiceNow, now = new Date()): Promise<void> {
  const value = { at: now.toISOString(), channels: channels.filter((c) => c.memberIds.length) };
  await db
    .insert(settings)
    .values({ key: VOICE_NOW_KEY, value, updatedBy: 'system' })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: 'system', updatedAt: now } });
}

/** いま通話にいる人（3 分より古ければ、BOT が止まっているので空） */
export async function loadVoiceNow(db: Db, now = new Date()): Promise<VoiceNow> {
  const [row] = await db.select().from(settings).where(eq(settings.key, VOICE_NOW_KEY));
  const v = row?.value as { at?: string; channels?: VoiceNow } | undefined;
  if (!v?.at || !Array.isArray(v.channels) || now.getTime() - new Date(v.at).getTime() > 3 * 60_000) return [];
  return v.channels;
}

// ───────── Discord に出すまとめ ─────────

/** 決まったこと（1 行に 1 つ。先頭の「- 」「・」は外す） */
export const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*・•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

const jstText = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  const w = ['日', '月', '火', '水', '木', '金', '土'][j.getUTCDay()];
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${w}）${String(j.getUTCHours()).padStart(2, '0')}:${String(j.getUTCMinutes()).padStart(2, '0')}`;
};
const dueText = (due: string) => `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`;

export function summaryMessage(m: Meeting, todos: MeetingTodo[], opts: { url?: string } = {}): MessageBody {
  const decided = lines(m.decisions);
  const todo = todos.map(
    (t) => `- ${t.doneAt ? '~~' : ''}${t.body}${t.doneAt ? '~~ ✅' : ''}${t.assigneeId ? ` … <@${t.assigneeId}>` : ''}${t.due ? `（〆 ${dueText(t.due)}）` : ''}`,
  );
  const head = [`🗓 ${jstText(m.heldAt)}`, m.placeChannelId ? `📍 <#${m.placeChannelId}>` : '', m.attendees.length ? `👥 ${m.attendees.map((id) => `<@${id}>`).join(' ')}` : '']
    .filter(Boolean)
    .join('\n');
  const body = [
    head,
    '',
    '## ✅ 決まったこと',
    ...(decided.length ? decided.map((d) => `- ${d}`) : ['-# なし']),
    '',
    '## 📌 やること',
    ...(todo.length ? todo : ['-# なし']),
    ...(opts.url ? ['', `-# くわしくは [社務所Web の議事録](${opts.url})`] : []),
  ].join('\n');
  return { embeds: [{ title: `📓 ${m.title}`.slice(0, 256), description: body.slice(0, 4000), color: 0x8a6d3b }] };
}

/** まとめを出す（前に同じチャンネルに出していれば書き換える） */
export async function postSummary(ctx: { db: Db; discord: DiscordActions }, id: number, channelId: string, by: string, opts: { url?: string; now?: Date } = {}): Promise<'posted' | 'edited' | undefined> {
  const found = await getMeeting(ctx.db, id);
  if (!found) return undefined;
  const { meeting: m, todos } = found;
  const body = summaryMessage(m, todos, { url: opts.url });
  let result: 'posted' | 'edited';
  if (m.postedChannelId === channelId && m.postedMessageId) {
    try {
      await ctx.discord.editMessage(channelId, m.postedMessageId, body);
      result = 'edited';
    } catch {
      // 消されていたら出し直す
      const sent = await ctx.discord.sendMessage(channelId, body);
      await ctx.db.update(meetings).set({ postedMessageId: sent.id, postedAt: opts.now ?? new Date() }).where(eq(meetings.id, id));
      result = 'posted';
    }
  } else {
    const sent = await ctx.discord.sendMessage(channelId, body);
    await ctx.db
      .update(meetings)
      .set({ postedChannelId: channelId, postedMessageId: sent.id, postedAt: opts.now ?? new Date() })
      .where(eq(meetings.id, id));
    result = 'posted';
  }
  await audit(ctx.db, { actorId: by, action: 'meeting.post', detail: { id, channelId, result }, via: 'web' });
  return result;
}
