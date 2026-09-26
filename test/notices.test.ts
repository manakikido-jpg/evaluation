import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { DiscordHttpError, type DiscordActions, type GuildChannel } from '../src/lib/discordRest.js';
import {
  createNotice,
  getNotice,
  listNotices,
  moveNotice,
  noticeStatus,
  publishAll,
  publishNotice,
  renderNotice,
  repostChannel,
  seedDefaultNotices,
  syncPostedNotices,
  updateNotice,
} from '../src/services/notices.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg, makeDb } from './helpers.js';

const CH = {
  cat: '910000000000000001',
  torii: '910000000000000002',
  shikitari: '910000000000000003',
  shamusho: '910000000000000004',
  ema: '910000000000000005',
  keiji: '910000000000000006',
  yoimiyaVoice: '910000000000000007',
  yoimiya: '910000000000000008',
};
const CHANNELS: GuildChannel[] = [
  { id: CH.cat, name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
  { id: CH.torii, name: '鳥居', type: 0, parent_id: CH.cat, position: 0 },
  { id: CH.shikitari, name: 'しきたり', type: 0, parent_id: CH.cat, position: 1 },
  { id: CH.shamusho, name: '社務所', type: 0, parent_id: CH.cat, position: 2 },
  { id: CH.ema, name: '絵馬', type: 0, parent_id: null, position: 3 },
  { id: CH.keiji, name: '慶事', type: 0, parent_id: null, position: 4 },
  { id: CH.yoimiyaVoice, name: '宵宮', type: 2, parent_id: null, position: 5 },
  { id: CH.yoimiya, name: '宵宮', type: 0, parent_id: null, position: 6 },
];

/** 偽の Discord: チャンネルごとのメッセージを持つ */
function fakeDiscord(channels = CHANNELS) {
  let seq = 0;
  const messages = new Map<string, { channelId: string; content: string }>();
  const log: string[] = [];
  const discord: DiscordActions = {
    addRole: async () => undefined,
    removeRole: async () => undefined,
    sendDm: async () => true,
    ban: async () => undefined,
    kick: async () => undefined,
    editMessage: async (c, m, b) => {
      if (!messages.has(m)) throw new DiscordHttpError('Unknown Message', 404);
      messages.set(m, { channelId: c, content: b.content || b.embeds?.[0]?.description || '' });
      log.push(`edit ${m}`);
    },
    sendMessage: async (c, b) => {
      const id = `m${++seq}`;
      messages.set(id, { channelId: c, content: b.content || b.embeds?.[0]?.description || '' });
      log.push(`send ${c} ${id}`);
      return { id };
    },
    deleteMessage: async (_c, m) => {
      if (!messages.delete(m)) throw new DiscordHttpError('Unknown Message', 404);
      log.push(`delete ${m}`);
    },
    guildChannels: async () => channels,
  };
  /** チャンネルのメッセージを投稿順に */
  const inChannel = (c: string) => [...messages.entries()].filter(([, v]) => v.channelId === c).map(([id, v]) => ({ id, ...v }));
  return { discord, messages, log, inChannel };
}

const GUJI = '700000000000000002';
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('差し込み', () => {
  it('{名前} を今の設定の値に、{#チャンネル名} をリンクに置き換える', () => {
    const r = renderNotice('免罪符は {免罪符の値段} {通貨}。{#しきたり} を読む。氏子は {氏子のご縁}', cfg, CHANNELS);
    expect(r.text).toBe(`免罪符は 300 花びら。<#${CH.shikitari}> を読む。氏子は 20`);
    expect(r.unknown).toEqual([]);
  });

  it('プレビューではリンクの代わりに #名前 を出す。同じ名前ならテキストチャンネルを選ぶ', () => {
    expect(renderNotice('{#しきたり} {#宵宮}', cfg, CHANNELS, { forPreview: true }).text).toBe('#しきたり #宵宮');
    expect(renderNotice('{#宵宮}', cfg, CHANNELS).text).toBe(`<#${CH.yoimiya}>`);
  });

  it('知らない名前・ないチャンネルはそのまま残して知らせる', () => {
    const r = renderNotice('{ふしぎ} {#ないチャンネル} {', cfg, CHANNELS);
    expect(r.text).toBe('{ふしぎ} #ないチャンネル {');
    expect(r.unknown).toEqual(['ふしぎ', '#ないチャンネル']);
  });

  it('{役職一覧} は役職・昇格ライン・格の箇条書き', () => {
    const text = renderNotice('{役職一覧}', cfg, CHANNELS).text;
    expect(text.split('\n')).toEqual([
      '- 🔰 **参拝者** … 入ったとき ・ 格 1',
      '- 🍃 **氏子** … ご縁 20 ・ 格 2',
      '- 🎋 **世話役** … ご縁 100 ・ 格 3',
      '- 🏮 **総代** … ご縁 300 ・ 格 4',
      '- 🎐 **神職** … 運営 ・ 格 5',
      '- ⛩ **宮司** … 鯖主 ・ 格 10',
    ]);
  });
});

describe('掲示', () => {
  it('標準の文面を入れると #鳥居 に 1 つ・#しきたり に 5 つ。どれも 2000 文字以内で、置き換えられない名前がない', async () => {
    const d = fakeDiscord();
    const r = await seedDefaultNotices({ db, cfg, discord: d.discord }, GUJI);
    expect(r).toEqual({ created: 6, missing: [] });
    const list = await listNotices(db);
    expect(list.filter((n) => n.channelId === CH.torii).map((n) => n.title)).toEqual(['ようこそ']);
    expect(list.filter((n) => n.channelId === CH.shikitari).map((n) => n.title)).toEqual(['ルール', '厄と BAN', '朱印とご縁', '花びら・相談', '用語集']);
    for (const n of list) {
      const out = renderNotice(n.body, cfg, CHANNELS);
      expect(out.unknown, n.title).toEqual([]);
      expect(out.text.length, n.title).toBeLessThanOrEqual(2000);
    }
    // 2 回目は入れない
    expect(await seedDefaultNotices({ db, cfg, discord: d.discord }, GUJI)).toEqual({ created: 0, missing: [] });
  });

  it('チャンネルが見つからなければ、その分は入れずに知らせる', async () => {
    const d = fakeDiscord(CHANNELS.filter((c) => c.name !== 'しきたり'));
    const r = await seedDefaultNotices({ db, cfg, discord: d.discord }, GUJI);
    expect(r).toEqual({ created: 1, missing: ['しきたり'] });
  });

  it('投稿 → 同じなら何もしない → 本文を変えたら書き換え → Discord で消されていたら投稿し直す', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.torii, title: 'ようこそ', body: '{#しきたり} を読んでね', by: GUJI });
    expect(noticeStatus(n, 'x')).toBe('draft');

    expect(await publishNotice(ctx, n.id, GUJI)).toBe('posted');
    expect(d.inChannel(CH.torii)).toEqual([{ id: 'm1', channelId: CH.torii, content: `<#${CH.shikitari}> を読んでね` }]);
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('unchanged');

    await updateNotice(db, n.id, { title: 'ようこそ', body: 'ようこそ！', by: GUJI });
    const saved = (await getNotice(db, n.id))!;
    expect(noticeStatus(saved, 'ようこそ！')).toBe('changed');
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('edited');
    expect(d.messages.get('m1')?.content).toBe('ようこそ！');

    d.messages.clear();
    await updateNotice(db, n.id, { title: 'ようこそ', body: 'ようこそ！！', by: GUJI });
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('reposted');
    expect((await getNotice(db, n.id))?.messageId).toBe('m2');
  });

  it('上限を超えるものは投稿しない（カードは 4096 文字・普通のメッセージは 2000 文字）', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const card = await createNotice(db, { channelId: CH.torii, title: 'カード', body: 'あ'.repeat(4097), by: GUJI });
    expect(await publishNotice(ctx, card.id, GUJI)).toBe('too_long');
    const text = await createNotice(db, { channelId: CH.torii, title: '普通', body: 'あ'.repeat(2001), style: 'text', by: GUJI });
    expect(await publishNotice(ctx, text.id, GUJI)).toBe('too_long');
    expect(d.log).toEqual([]);
    const ok = await createNotice(db, { channelId: CH.torii, title: 'カード', body: 'あ'.repeat(3000), by: GUJI });
    expect(await publishNotice(ctx, ok.id, GUJI)).toBe('posted');
  });

  it('カードで投稿し、普通のメッセージに切り替えると同じメッセージを書き換える', async () => {
    const bodies: unknown[] = [];
    const d = fakeDiscord();
    const send = d.discord.sendMessage;
    const edit = d.discord.editMessage;
    d.discord.sendMessage = async (c, b) => (bodies.push(b), send(c, b));
    d.discord.editMessage = async (c, m, b) => (bodies.push(b), edit(c, m, b));
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.torii, title: 'ようこそ', body: 'ようこそ', by: GUJI });
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('posted');
    expect(bodies[0]).toEqual({ content: '', embeds: [{ description: 'ようこそ', color: 0xd7003a }] });

    await updateNotice(db, n.id, { title: 'ようこそ', body: 'ようこそ', style: 'text', by: GUJI });
    expect(noticeStatus((await getNotice(db, n.id))!, 'ようこそ')).toBe('changed');
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('edited');
    expect(bodies[1]).toEqual({ content: 'ようこそ', embeds: [] });
    expect(d.log).toEqual([`send ${CH.torii} m1`, 'edit m1']);
  });

  it('すべて反映: 未投稿と変更ありだけを反映する', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const a = await createNotice(db, { channelId: CH.shikitari, title: 'A', body: 'A', by: GUJI });
    await createNotice(db, { channelId: CH.shikitari, title: 'B', body: 'B', by: GUJI });
    await publishNotice(ctx, a.id, GUJI);
    d.log.length = 0;
    expect(await publishAll(ctx, GUJI)).toEqual({ done: 1, tooLong: [] });
    expect(d.log).toEqual([`send ${CH.shikitari} m2`]);
  });

  it('並べ替えて「投稿し直す」と、Discord のメッセージも新しい順番になる', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const a = await createNotice(db, { channelId: CH.shikitari, title: 'A', body: 'A', by: GUJI });
    const b = await createNotice(db, { channelId: CH.shikitari, title: 'B', body: 'B', by: GUJI });
    await publishAll(ctx, GUJI);
    await moveNotice(db, b.id, 'up');
    expect((await listNotices(db)).map((n) => n.title)).toEqual(['B', 'A']);

    expect(await repostChannel(ctx, CH.shikitari, GUJI)).toEqual({ done: 2, tooLong: [] });
    expect(d.inChannel(CH.shikitari).map((m) => m.content)).toEqual(['B', 'A']);
    expect((await getNotice(db, a.id))?.messageId).toBe('m4');
  });

  it('設定を変えると、投稿済みの掲示の数字も書き換わる（本文を編集中のものはそのまま）', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const price = await createNotice(db, { channelId: CH.shikitari, title: '値段', body: '免罪符は {免罪符の値段} 枚', by: GUJI });
    const editing = await createNotice(db, { channelId: CH.shikitari, title: '編集中', body: '{免罪符の値段} 枚', by: GUJI });
    const plain = await createNotice(db, { channelId: CH.shikitari, title: '数字なし', body: 'こんにちは', by: GUJI });
    await publishAll(ctx, GUJI);
    await updateNotice(db, editing.id, { title: '編集中', body: '下書き {免罪符の値段}', by: GUJI });
    d.log.length = 0;

    const after = applyOverrides(cfg, overridesSchema.parse({ economy: { menzaifuPrice: 800 } }));
    expect(await syncPostedNotices({ db, cfg: after, discord: d.discord }, cfg)).toBe(1);
    expect(d.messages.get((await getNotice(db, price.id))!.messageId!)?.content).toBe('免罪符は 800 枚');
    expect(d.messages.get((await getNotice(db, editing.id))!.messageId!)?.content).toBe('300 枚');
    expect(d.log).toEqual([`edit ${(await getNotice(db, price.id))!.messageId}`]);
    expect((await getNotice(db, plain.id))?.postedText).toBe('こんにちは');
  });
});
