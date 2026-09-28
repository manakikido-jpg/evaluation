import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST_CHANGE_ID, type ChangelogEntry } from '../src/changelog.js';
import type { Db } from '../src/db/client.js';
import type { DiscordActions, GuildChannel, MessageBody } from '../src/lib/discordRest.js';
import { announceUpdates, loadUpdateNews, newsChannelOf, newsEmbed, newsMessages, pendingNews, saveUpdateNews } from '../src/services/updateNews.js';
import { makeDb } from './helpers.js';

const NEWS = '910000000000000070';
const CHANNELS: GuildChannel[] = [
  { id: '910000000000000001', name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
  { id: NEWS, name: '📰｜更新速報', type: 0, parent_id: '910000000000000001', position: 1 },
];
const entry = (id: string, kind: ChangelogEntry['kind'], where: ChangelogEntry['where'], date = '2026-09-28'): ChangelogEntry => ({ id, date, kind, where, title: `題 ${id}`, items: ['一つ目', '二つ目'] });

let db: Db;
let close: () => Promise<void>;
let sent: { channelId: string; body: MessageBody }[];
const discord = { sendMessage: async (channelId: string, body: MessageBody) => (sent.push({ channelId, body }), { id: '1' }) } as unknown as DiscordActions;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  sent = [];
});
afterEach(async () => {
  await close();
});

describe('📰 更新速報', () => {
  it('カード: 種類ごとの色と見出し、箇条書き、日付と場所', () => {
    const card = newsEmbed(entry('a', 'new', ['Discord', '社務所Web']));
    expect(card).toMatchObject({ author: { name: '✨ 新しい機能' }, title: '題 a', description: '- 一つ目\n- 二つ目', color: 0xd7003a });
    expect(card.footer?.text).toBe('9月28日 ・ Discord・社務所Web（運営）');
    expect(newsEmbed(entry('b', 'fix', ['Discord'])).author?.name).toBe('🩹 直しました');
  });

  it('メッセージ: 古い順、1 通目に見出し、カードは 10 枚ずつ', () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`e${i}`, 'improve', ['Discord']));
    const msgs = newsMessages(many);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.content).toContain('📰 更新速報');
    expect(msgs[0]!.content).toContain('9月28日のアップデート（12 件）');
    expect(msgs[0]!.embeds!.length).toBe(10);
    expect(msgs[0]!.embeds![0]!.title).toBe('題 e11');
    expect(msgs[1]!.content).toBeUndefined();
  });

  it('まだ出していない更新: 印より新しいもの。メンバー向けだけにもできる', () => {
    const all = [entry('c', 'new', ['社務所Web']), entry('b', 'new', ['Discord']), entry('a', 'fix', ['Discord'])];
    expect(pendingNews({ enabled: true, scope: 'discord', lastId: 'a' }, all).map((e) => e.id)).toEqual(['b']);
    expect(pendingNews({ enabled: true, scope: 'all', lastId: 'a' }, all).map((e) => e.id)).toEqual(['c', 'b']);
    // 印がない・見つからないときは出さない（最初に全部を出さない）
    expect(pendingNews({ enabled: true, scope: 'all' }, all)).toEqual([]);
    expect(pendingNews({ enabled: true, scope: 'all', lastId: 'zz' }, all)).toEqual([]);
  });

  it('チャンネル: 選んだもの、なければ「更新速報」の名前で探す', () => {
    expect(newsChannelOf({ enabled: true, scope: 'discord' }, CHANNELS)?.id).toBe(NEWS);
    expect(newsChannelOf({ enabled: true, scope: 'discord', channelId: '910000000000000001' }, CHANNELS)?.id).toBe(NEWS);
    expect(newsChannelOf({ enabled: true, scope: 'discord' }, CHANNELS.slice(0, 1))).toBeUndefined();
  });

  it('BOT の起動時: 自動なら印より新しい分を出して印を進める。2 回目は出さない', async () => {
    const ctx = { db, discord, channels: CHANNELS };
    // 自動でなければ何もしない
    expect(await announceUpdates(ctx)).toBe(0);
    const prevId = CHANGELOG.find((e, i) => i > 0 && CHANGELOG.slice(0, i).some((x) => x.where.includes('Discord')))!.id;
    await saveUpdateNews(db, { enabled: true, scope: 'discord', lastId: prevId }, 'x');
    const n = await announceUpdates(ctx);
    expect(n).toBeGreaterThan(0);
    expect(sent[0]!.channelId).toBe(NEWS);
    expect((await loadUpdateNews(db)).lastId).toBe(LATEST_CHANGE_ID);
    sent = [];
    expect(await announceUpdates(ctx)).toBe(0);
    expect(sent).toEqual([]);
  });
});
