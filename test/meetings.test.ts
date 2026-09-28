import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions, MessageBody } from '../src/lib/discordRest.js';
import {
  countOpenTodos,
  createMeeting,
  getMeeting,
  lines,
  listMeetings,
  loadVoiceNow,
  openTodos,
  pickablePeople,
  postSummary,
  saveVoiceNow,
  summaryMessage,
  toggleTodo,
  updateMeeting,
} from '../src/services/meetings.js';
import { recordJoin } from '../src/services/members.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '800000000000000001';
const B = '800000000000000002';
const C = '800000000000000003';
const T0 = new Date('2026-09-28T12:00:00Z');
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const input = (title = '9 月の運営会議') => ({
  title,
  heldAt: T0,
  placeChannelId: '910000000000000004',
  attendees: [A, B],
  agenda: '- イベント',
  notes: '**ハロウィン** の話',
  decisions: '- 10/31 21 時から\n・景品は物御籤の券\n\n',
});

describe('📓 議事録', () => {
  it('やることを入れ直す: 直す・足す・消す。済にした日時は保つ。まだのやることは期限の近い順', async () => {
    const m = await createMeeting(
      db,
      input(),
      [
        { body: '告知文を書く', assigneeId: A, due: '2026-10-05', done: false },
        { body: '  ', assigneeId: null, due: null, done: false },
        { body: '景品を決める', assigneeId: B, due: '2026-10-01', done: false },
        { body: '部屋を作る', assigneeId: null, due: null, done: true },
      ],
      A,
      T0,
    );
    let got = (await getMeeting(db, m.id))!;
    expect(got.todos.map((t) => t.body)).toEqual(['告知文を書く', '景品を決める', '部屋を作る']);
    const doneAt = got.todos[2]!.doneAt!;
    expect(doneAt).toEqual(T0);
    expect((await openTodos(db)).map((t) => t.body)).toEqual(['景品を決める', '告知文を書く']);
    expect(await countOpenTodos(db)).toBe(2);

    // 1 つ目を直し、2 つ目を消し、1 つ足す。済のものは日時がそのまま
    const [t1, , t3] = got.todos;
    await updateMeeting(
      db,
      m.id,
      input('9 月の運営会議（直した）'),
      [
        { id: t1!.id, body: '告知文を書いて出す', assigneeId: A, due: '2026-10-05', done: false },
        { id: t3!.id, body: '部屋を作る', assigneeId: null, due: null, done: true },
        { body: 'BOT の告知を予約', assigneeId: C, due: null, done: false },
      ],
      B,
      new Date(T0.getTime() + 3_600_000),
    );
    got = (await getMeeting(db, m.id))!;
    expect(got.meeting.title).toBe('9 月の運営会議（直した）');
    expect(got.meeting.updatedBy).toBe(B);
    expect(got.todos.map((t) => t.body)).toEqual(['告知文を書いて出す', '部屋を作る', 'BOT の告知を予約']);
    expect(got.todos[1]!.doneAt).toEqual(doneAt);

    // 済 ⇔ まだ
    expect(await toggleTodo(db, got.todos[0]!.id, A, T0)).toBe(true);
    expect(await toggleTodo(db, got.todos[0]!.id, A, T0)).toBe(false);
    expect(await toggleTodo(db, 99999, A)).toBeUndefined();
    expect((await openTodos(db, { assigneeId: C })).map((t) => t.body)).toEqual(['BOT の告知を予約']);
  });

  it('一覧: 新しい順、やることの数、題・中身で探せる', async () => {
    await createMeeting(db, { ...input('8 月の会議'), heldAt: new Date('2026-08-28T12:00:00Z') }, [], A);
    const m = await createMeeting(db, input(), [{ body: 'x', assigneeId: null, due: null, done: false }], A);
    const list = await listMeetings(db);
    expect(list.map((r) => r.title)).toEqual(['9 月の運営会議', '8 月の会議']);
    expect(list[0]).toMatchObject({ id: m.id, todoCount: 1, openCount: 1 });
    expect((await listMeetings(db, { q: 'ハロウィン' })).length).toBe(2);
    expect((await listMeetings(db, { q: '8 月' })).map((r) => r.title)).toEqual(['8 月の会議']);
    expect(await listMeetings(db, { q: '100%' })).toEqual([]);
  });

  it('Discord のまとめ: 日時・場所・参加した人・決まったこと・やること（済は打ち消し）。2 回目は書き換える', async () => {
    const m = await createMeeting(db, input(), [
      { body: '告知文を書く', assigneeId: A, due: '2026-10-05', done: false },
      { body: '部屋を作る', assigneeId: null, due: null, done: true },
    ], A, T0);
    const { todos } = (await getMeeting(db, m.id))!;
    const text = summaryMessage(m, todos, { url: 'https://example.com/minutes/1' }).embeds![0]!.description!;
    expect(text).toContain('🗓 9/28（月）21:00');
    expect(text).toContain('📍 <#910000000000000004>');
    expect(text).toContain(`<@${A}> <@${B}>`);
    expect(text).toContain('- 10/31 21 時から\n- 景品は物御籤の券');
    expect(text).toContain(`- 告知文を書く … <@${A}>（〆 10/5）`);
    expect(text).toContain('- ~~部屋を作る~~ ✅');
    expect(text).toContain('[社務所Web の議事録](https://example.com/minutes/1)');

    const sent: string[] = [];
    const discord = {
      sendMessage: async (c: string, _b: MessageBody) => (sent.push(`send ${c}`), { id: '990000000000000001' }),
      editMessage: async (c: string, id: string) => void sent.push(`edit ${c} ${id}`),
    } as unknown as DiscordActions;
    expect(await postSummary({ db, discord }, m.id, '910000000000000003', A)).toBe('posted');
    expect(await postSummary({ db, discord }, m.id, '910000000000000003', A)).toBe('edited');
    expect(sent).toEqual(['send 910000000000000003', 'edit 910000000000000003 990000000000000001']);
    expect(lines('1. a\n* b\n  \n- c')).toEqual(['a', 'b', 'c']);
  });

  it('いま通話にいる人（3 分より古いものは使わない）と、選べる人（運営を先に）', async () => {
    await saveVoiceNow(db, [{ id: 'v1', name: '会議室', memberIds: [A, C] }, { id: 'v2', name: '空', memberIds: [] }], T0);
    expect(await loadVoiceNow(db, new Date(T0.getTime() + 60_000))).toEqual([{ id: 'v1', name: '会議室', memberIds: [A, C] }]);
    expect(await loadVoiceNow(db, new Date(T0.getTime() + 4 * 60_000))).toEqual([]);

    const join = (id: string, name: string, roleIds: string[]) =>
      recordJoin(db, { id, username: name, displayName: name, avatarUrl: null, roleIds, isBot: false, joinedAt: T0 });
    await join(A, 'あおい', [ROLE.shinshoku]);
    await join(B, 'いろは', [ROLE.guji]);
    await join(C, 'うみ', [ROLE.sanpaisha]);
    expect((await pickablePeople(db, cfg)).map((p) => p.name)).toEqual(['あおい', 'いろは']);
    // 通話にいた一般の人も選べる（あとに並ぶ）
    expect((await pickablePeople(db, cfg, [C])).map((p) => `${p.name}:${p.staff}`)).toEqual(['あおい:true', 'いろは:true', 'うみ:false']);
  });
});
