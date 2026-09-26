import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { shuin } from '../src/db/schema.js';
import { DiscordHttpError, type DiscordActions, type MessageBody } from '../src/lib/discordRest.js';
import { banzukeData, jstMonth, renderBanzuke, updateBanzuke } from '../src/services/banzuke.js';
import { recordJoin, recordLeave } from '../src/services/members.js';
import { giveShuin, revokeShuin } from '../src/services/shuin.js';
import { cfg, makeDb } from './helpers.js';

const BANZUKE = '930000000000000001';
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const [id, name] of [
    ['A', 'あおい'],
    ['B', 'べに*'],
    ['C', 'ちはや'],
    ['D', 'でんでん'],
  ] as const) {
    await recordJoin(db, { id, username: id, displayName: name, avatarUrl: null, roleIds: [], isBot: false, joinedAt: new Date() });
  }
});
afterEach(async () => {
  await close();
});

/** 朱印を押して、押した日時を決める */
async function stamp(giverId: string, receiverId: string, weight: number, at: string) {
  await giveShuin(db, { giverId, receiverId, weight, giverRank: 'ujiko' });
  await db
    .update(shuin)
    .set({ createdAt: new Date(at) })
    .where(and(eq(shuin.giverId, giverId), eq(shuin.receiverId, receiverId)));
}

function fakeDiscord(channels = [{ id: BANZUKE, name: '番付', type: 0, parent_id: null, position: 0 }]) {
  let seq = 0;
  const messages = new Map<string, MessageBody>();
  const log: string[] = [];
  const discord: DiscordActions = {
    addRole: async () => undefined,
    removeRole: async () => undefined,
    sendDm: async () => true,
    ban: async () => undefined,
    unban: async () => undefined,
    kick: async () => undefined,
    editMessage: async (_c, m, b) => {
      if (!messages.has(m)) throw new DiscordHttpError('Unknown Message', 404);
      messages.set(m, b);
      log.push(`edit ${m}`);
    },
    sendMessage: async (_c, b) => {
      const id = `m${++seq}`;
      messages.set(id, b);
      log.push(`send ${id}`);
      return { id };
    },
    deleteMessage: async () => undefined,
    guildChannels: async () => channels,
  };
  const text = (id: string) => messages.get(id)?.embeds?.[0]?.description ?? '';
  const title = (id: string) => messages.get(id)?.embeds?.[0]?.title ?? '';
  return { discord, messages, log, text, title };
}

describe('番付', () => {
  it('日本時間の月で区切る', () => {
    const m = jstMonth(new Date('2026-09-30T15:30:00Z')); // 日本時間 10/1 0:30
    expect(m.key).toBe('2026-10');
    expect(m.label).toBe('2026年10月');
    expect(m.start.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(jstMonth(new Date('2026-01-10T00:00:00Z'), -1).key).toBe('2025-12');
  });

  it('今月・累計のご縁と、今月たくさん押した人。取り消した朱印・退出した人は入れない', async () => {
    await stamp('A', 'B', 3, '2026-08-20T00:00:00Z'); // 先月
    await stamp('C', 'B', 2, '2026-09-10T00:00:00Z');
    await stamp('A', 'C', 4, '2026-09-11T00:00:00Z');
    await stamp('B', 'C', 1, '2026-09-12T00:00:00Z');
    await stamp('D', 'A', 5, '2026-09-13T00:00:00Z');
    await revokeShuin(db, { giverId: 'D', receiverId: 'A' });
    await stamp('C', 'D', 9, '2026-09-14T00:00:00Z');
    await recordLeave(db, 'D');

    const d = await banzukeData(db, jstMonth(new Date('2026-09-20T00:00:00Z')));
    expect(d.monthly.map((e) => [e.name, e.value])).toEqual([
      ['ちはや', 5],
      ['べに*', 2],
    ]);
    expect(d.total.map((e) => [e.name, e.value])).toEqual([
      ['べに*', 5],
      ['ちはや', 5],
    ]);
    expect(d.givers.map((e) => [e.name, e.value])).toEqual([
      ['ちはや', 2],
      ['あおい', 1],
      ['べに*', 1],
    ]);
  });

  it('カード: 同じ数なら同じ順位。名前の記号で太字などにならない', () => {
    const month = jstMonth(new Date('2026-09-20T00:00:00Z'));
    const body = renderBanzuke({
      month,
      monthly: [
        { memberId: 'B', name: 'べに*', value: 5 },
        { memberId: 'C', name: 'ちはや', value: 5 },
        { memberId: 'A', name: 'あおい', value: 3 },
        { memberId: 'D', name: 'で', value: 1 },
      ],
      total: [],
      givers: [],
    });
    const text = body.embeds![0]!.description!;
    expect(body.embeds![0]!.title).toBe('📜 番付 ― 2026年9月');
    expect(text).toContain('🥇 べに\\* … ご縁 5\n🥇 ちはや … ご縁 5\n🥉 あおい … ご縁 3\n**4.** で … ご縁 1');
    expect(text).toContain('### 🏆 累計のご縁\n-# まだありません');
  });

  it('貼る → 変わらなければ何もしない → 変わったら書き換える → 消されていたら貼り直す', async () => {
    const f = fakeDiscord();
    const ctx = { db, cfg, discord: f.discord };
    const now = new Date('2026-09-20T00:00:00Z');
    expect(await updateBanzuke(ctx, now)).toBe('posted');
    expect(f.text('m1')).toContain('-# まだありません');

    expect(await updateBanzuke(ctx, now)).toBe('unchanged');
    await stamp('A', 'B', 3, '2026-09-19T00:00:00Z');
    expect(await updateBanzuke(ctx, now)).toBe('edited');
    expect(f.text('m1')).toContain('🥇 べに\\* … ご縁 3');

    f.messages.clear();
    await stamp('A', 'C', 1, '2026-09-19T00:00:00Z');
    expect(await updateBanzuke(ctx, now)).toBe('posted');
    expect(f.log).toEqual(['send m1', 'edit m1', 'send m2']);
  });

  it('月が変わったら、先月の分を「確定」にして残し、今月の番付を新しく貼る', async () => {
    const f = fakeDiscord();
    const ctx = { db, cfg, discord: f.discord };
    await stamp('A', 'B', 3, '2026-09-19T00:00:00Z');
    await updateBanzuke(ctx, new Date('2026-09-20T00:00:00Z'));
    await stamp('A', 'C', 2, '2026-10-01T03:00:00Z');

    expect(await updateBanzuke(ctx, new Date('2026-10-01T06:00:00Z'))).toBe('posted');
    expect(f.title('m1')).toBe('📜 番付 ― 2026年9月（確定）');
    expect(f.text('m1')).toContain('🥇 べに\\* … ご縁 3');
    expect(f.text('m1')).not.toContain('累計');
    expect(f.title('m2')).toBe('📜 番付 ― 2026年10月');
    expect(f.text('m2')).toContain('### 🌸 今月のご縁\n🥇 ちはや … ご縁 2');
  });

  it('#番付 がなければ何もしない', async () => {
    const f = fakeDiscord([]);
    expect(await updateBanzuke({ db, cfg, discord: f.discord }, new Date())).toBe('no_channel');
    expect(f.log).toEqual([]);
  });
});
