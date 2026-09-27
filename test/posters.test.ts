import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { posterPicker } from '../src/discord/app.js';
import { recordIntro } from '../src/services/intros.js';
import { recordJoin, recordLeave } from '../src/services/members.js';
import { channelPosters, posterPage, POSTERS_PER_PAGE } from '../src/services/posters.js';
import { makeDb } from './helpers.js';

const CH = '960000000000000001';
const OTHER = '960000000000000002';
const ME = '960000000000000010';
const A = '960000000000000011';
const B = '960000000000000012';
const C = '960000000000000013';
const GONE = '960000000000000014';
const snap = (id: string, name: string) => ({ id, username: id, displayName: name, avatarUrl: null, roleIds: [], isBot: false, joinedAt: null });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const [id, n] of [
    [ME, 'わたし'],
    [A, 'あお'],
    [B, 'べに'],
    [C, 'ちゃ'],
    [GONE, 'いない'],
  ] as const)
    await recordJoin(db, snap(id, n));
  await recordLeave(db, GONE);
});
afterEach(async () => {
  await close();
});

describe('🌸 朱印を押す相手（そのチャンネルに投稿している人）', () => {
  it('最近のメッセージと自己紹介の記録から、新しく投稿した順。自分・退出した人・ほかのチャンネルの自己紹介は除く', async () => {
    await recordIntro(db, { memberId: C, channelId: CH, messageId: '1', content: 'よろしく', postedAt: new Date(1000) });
    await recordIntro(db, { memberId: B, channelId: OTHER, messageId: '2', content: 'よろしく', postedAt: new Date(9000) });
    const recent = [
      { authorId: A, at: 5000 },
      { authorId: ME, at: 7000 },
      { authorId: GONE, at: 8000 },
      { authorId: A, at: 3000 },
    ];
    const list = await channelPosters(db, CH, recent, ME);
    expect(list.map((p) => [p.name, p.lastAt])).toEqual([
      ['あお', 5000],
      ['ちゃ', 1000],
    ]);
    expect(await channelPosters(db, OTHER, [], ME)).toEqual([{ id: B, name: 'べに', lastAt: 9000 }]);
    expect(await channelPosters(db, '960000000000000099', [], ME)).toEqual([]);
  });

  it('25 人ずつのページと、選ぶ欄', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ id: String(960000000000000100 + i), name: `人${i}`, lastAt: 100 - i }));
    expect(posterPage(list, 0).items).toHaveLength(POSTERS_PER_PAGE);
    expect(posterPage(list, 1)).toMatchObject({ page: 1, pages: 2 });
    expect(posterPage(list, 1).items).toHaveLength(5);
    expect(posterPage(list, 9).page).toBe(1);
    const view = posterPicker(list, 1);
    expect(view.content).toContain('30 人');
    expect(view.content).toContain('2/2 ページ');
    const json = JSON.stringify(view.components.map((c) => c.toJSON()));
    expect(json).toContain('"custom_id":"shuin:pickone"');
    expect(json).toContain('"custom_id":"shuin:pickpage:0"');
    expect(posterPicker([], 0)).toEqual({ content: '🌸 このチャンネルには、まだ朱印を押せる人の投稿がありません。', components: [] });
  });
});
