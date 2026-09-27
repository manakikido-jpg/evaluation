import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { DiscordHttpError, type DiscordActions, type GuildChannel, type MessageBody } from '../src/lib/discordRest.js';
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
  restickNotice,
  seedChannelGuides,
  stickyNotices,
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
  { id: CH.ema, name: '絵馬-男性', type: 0, parent_id: null, position: 3 },
  { id: '910000000000000010', name: '絵馬-女性', type: 0, parent_id: null, position: 8 },
  { id: CH.keiji, name: '慶事', type: 0, parent_id: null, position: 4 },
  { id: CH.yoimiyaVoice, name: '宵宮', type: 2, parent_id: null, position: 5 },
  { id: CH.yoimiya, name: '宵宮', type: 0, parent_id: null, position: 6 },
  { id: '910000000000000009', name: 'おみくじ', type: 0, parent_id: null, position: 7 },
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
    unban: async () => undefined,
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
    guildRoles: async () => [],
    editRole: async () => undefined,
    editChannel: async () => undefined,
    createChannel: async (_g, b) => ({ id: '0', name: b.name, type: b.type, parent_id: b.parent_id ?? null, position: 0 }),
    deleteChannel: async () => undefined,
    reorderChannels: async () => undefined,
    createRole: async (_g, b) => ({ id: '0', name: b.name ?? '', position: 1, managed: false, color: 0 }),
    deleteRole: async () => undefined,
    setNickname: async () => undefined,
    setChannelOverwrite: async () => undefined,
    pinMessage: async (c, m, pin) => {
      if (pinFails) throw new DiscordHttpError('Missing Permissions', 403);
      if (!messages.has(m)) throw new DiscordHttpError('Unknown Message', 404);
      log.push(`${pin ? 'pin' : 'unpin'} ${c} ${m}`);
    },
  };
  /** チャンネルのメッセージを投稿順に */
  const inChannel = (c: string) => [...messages.entries()].filter(([, v]) => v.channelId === c).map(([id, v]) => ({ id, ...v }));
  return { discord, messages, log, inChannel };
}

const GUJI = '700000000000000002';
/** ピン留めの権限がないとき */
let pinFails = false;
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  pinFails = false;
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('差し込み', () => {
  it('{名前} を今の設定の値に、{#チャンネル名} をリンクに置き換える', () => {
    const r = renderNotice('免罪符は {免罪符の値段} {通貨}。{#しきたり} を読む。氏子は {氏子のご縁}', cfg, CHANNELS);
    expect(r.text).toBe(`免罪符は 300 銭。<#${CH.shikitari}> を読む。氏子は 20`);
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
    expect(await publishAll(ctx, GUJI)).toEqual({ done: 1, tooLong: [], pinFailed: [] });
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

    expect(await repostChannel(ctx, CH.shikitari, GUJI)).toEqual({ done: 2, tooLong: [], pinFailed: [] });
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

describe('通貨を銭に', () => {
  it('移行で設定が銭になり、BOT の起動時に 1 回だけ、花びらで出した掲示を銭で出し直す', async () => {
    const { loadOverrides } = await import('../src/services/settings.js');
    const { syncCurrencyRename } = await import('../src/services/notices.js');
    expect((await loadOverrides(db)).economy).toMatchObject({ currencyName: '銭', currencyEmoji: '🪙' });
    const d = fakeDiscord();
    const hana = { ...cfg, economy: { ...cfg.economy, currencyName: '花びら', currencyEmoji: '🌸' } };
    const zeni = { ...cfg, economy: { ...cfg.economy, currencyName: '銭', currencyEmoji: '🪙' } };
    const n = await createNotice(db, { channelId: CH.shikitari, title: '通貨', body: '{通貨絵文字}{通貨}を集めよう', by: GUJI });
    await publishAll({ db, cfg: hana, discord: d.discord }, GUJI);
    expect(d.messages.get((await getNotice(db, n.id))!.messageId!)?.content).toBe('🌸花びらを集めよう');
    expect(await syncCurrencyRename({ db, cfg: zeni, discord: d.discord })).toBe(1);
    expect(d.messages.get((await getNotice(db, n.id))!.messageId!)?.content).toBe('🪙銭を集めよう');
    // 2 回目はしない
    expect(await syncCurrencyRename({ db, cfg: zeni, discord: d.discord })).toBe(0);
  });

  it('{おみくじの花びら}（前の名前）も {おみくじの銭} と同じに差し込む', () => {
    expect(renderNotice('{おみくじの花びら}', cfg, CHANNELS).text).toBe(renderNotice('{おみくじの銭}', cfg, CHANNELS).text);
    expect(renderNotice('{おみくじの花びら}', cfg, CHANNELS).unknown).toEqual([]);
  });
});

describe('チャンネルの案内とピン留め', () => {
  /** 見た目を変えた名前（「🪧｜絵馬」など）でも見つかる */
  const NAMES = ['しきたり', '御触書', '授与所', '絵馬-男性', '絵馬-女性', '運営紹介', 'アイコン紹介', '慶事', '番付', '境内', '手水舎', '写真館', 'おみくじ', '縁日', '屋台', '宿帳', '宵宮', '御神酒処', '市場', 'お出迎え'];
  const FULL: GuildChannel[] = NAMES.map((name, i) => ({ id: `92000000000000${String(1000 + i)}`, name: `🌸｜${name}`, type: 0, parent_id: null, position: i }));
  const idOf = (name: string) => FULL.find((c) => c.name.endsWith(name))!.id;

  it('飾りを付けた名前でも {#チャンネル名} がリンクになる', () => {
    expect(renderNotice('{#絵馬-男性}', cfg, FULL).text).toBe(`<#${idOf('絵馬-男性')}>`);
    // 飾りを除くと何も残らない名前は探さない
    expect(renderNotice('{#🌸}', cfg, FULL).unknown).toEqual(['#🌸']);
  });

  it('案内を入れると、各チャンネルにピン留めの「使い方」と、#しきたり に「チャンネル案内」が入る。2 回目は増えない', async () => {
    const d = fakeDiscord(FULL);
    const ctx = { db, cfg, discord: d.discord };
    const r = await seedChannelGuides(ctx, GUJI);
    expect(r.missing).toEqual([]);
    const list = await listNotices(db);
    expect(r.created).toBe(list.length);
    expect(list.find((n) => n.channelId === idOf('しきたり'))).toMatchObject({ title: 'チャンネル案内', pinned: false });
    for (const name of ['境内', '手水舎', '写真館', 'おみくじ', '縁日', '屋台', '宿帳', '宵宮', '御神酒処', '市場', 'お出迎え']) {
      expect(list.find((n) => n.channelId === idOf(name)), name).toMatchObject({ title: '使い方', pinned: true, sticky: false });
    }
    // 自己紹介はひな形がいつも見えるよう、いちばん下に表示し続ける
    for (const name of ['絵馬-男性', '絵馬-女性']) {
      expect(list.find((n) => n.channelId === idOf(name)), name).toMatchObject({ title: '使い方', pinned: false, sticky: true });
    }
    expect(list.find((n) => n.channelId === idOf('アイコン紹介'))).toMatchObject({ title: '使い方', pinned: true });
    for (const n of list) {
      const out = renderNotice(n.body, cfg, FULL);
      expect(out.unknown, n.title).toEqual([]);
      expect(out.text.length, n.title).toBeLessThanOrEqual(2000);
    }
    expect(await seedChannelGuides(ctx, GUJI)).toEqual({ created: 0, updated: 0, missing: [] });
  });

  it('前の版の標準の文面のままなら、押し直すと新しい文面になる（手を加えたものはそのまま）', async () => {
    const { PREVIOUS_GUIDE_BODIES, DEFAULT_GUIDES } = await import('../src/services/noticeDefaults.js');
    const d = fakeDiscord(FULL);
    const ctx = { db, cfg, discord: d.discord };
    const old = PREVIOUS_GUIDE_BODIES['絵馬-男性\n使い方']![0]!;
    const ema = await createNotice(db, { channelId: idOf('絵馬-男性'), title: '使い方', body: old, pinned: true, by: GUJI });
    const edited = await createNotice(db, { channelId: idOf('境内'), title: '使い方', body: '手で書いた', pinned: true, by: GUJI });
    const r = await seedChannelGuides(ctx, GUJI);
    expect(r.updated).toBe(1);
    expect((await getNotice(db, ema.id))!.body).toBe(DEFAULT_GUIDES.find((t) => t.channelName === '絵馬-男性')!.body);
    expect((await getNotice(db, ema.id))!.body).toContain('【招待者】');
    expect((await getNotice(db, edited.id))!.body).toBe('手で書いた');
  });

  it('標準の文面が入っていても、案内は入る（#しきたり の最後に足される）', async () => {
    const d = fakeDiscord(FULL);
    const ctx = { db, cfg, discord: d.discord };
    await seedDefaultNotices(ctx, GUJI);
    await seedChannelGuides(ctx, GUJI);
    const shikitari = (await listNotices(db)).filter((n) => n.channelId === idOf('しきたり')).map((n) => n.title);
    expect(shikitari.at(-1)).toBe('チャンネル案内');
    expect(shikitari.length).toBe(6);
  });

  it('ピン留めの掲示は、投稿するとピン留めされる。ピン留めだけ変えたら本文は書き換えない', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: '使い方', body: '自己紹介をどうぞ', pinned: true, by: GUJI });
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('posted');
    expect(d.log).toEqual([`send ${CH.ema} m1`, `pin ${CH.ema} m1`]);
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('unchanged');

    await updateNotice(db, n.id, { title: '使い方', body: '自己紹介をどうぞ', pinned: false, by: GUJI });
    const saved = (await getNotice(db, n.id))!;
    expect(noticeStatus(saved, '自己紹介をどうぞ')).toBe('changed');
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('edited');
    expect(d.log.slice(2)).toEqual([`unpin ${CH.ema} m1`]);
  });

  it('ピン留めできなくても投稿はして知らせる。あとで権限を付けて反映すればピン留めされる', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: '使い方', body: '自己紹介をどうぞ', pinned: true, by: GUJI });
    pinFails = true;
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('pin_failed');
    expect(d.inChannel(CH.ema).length).toBe(1);
    expect(noticeStatus((await getNotice(db, n.id))!, '自己紹介をどうぞ')).toBe('changed');
    expect((await publishAll(ctx, GUJI)).pinFailed).toEqual(['使い方']);

    pinFails = false;
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('edited');
    expect(d.log).toContain(`pin ${CH.ema} m1`);
    expect(d.inChannel(CH.ema).length).toBe(1);
    expect(noticeStatus((await getNotice(db, n.id))!, '自己紹介をどうぞ')).toBe('posted');
  });

  it('投稿し直すと、新しいメッセージをピン留めし直す', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const a = await createNotice(db, { channelId: CH.ema, title: '使い方', body: 'A', pinned: true, by: GUJI });
    await createNotice(db, { channelId: CH.ema, title: 'ふつう', body: 'B', by: GUJI });
    await publishAll(ctx, GUJI);
    await moveNotice(db, a.id, 'down');
    const r = await repostChannel(ctx, CH.ema, GUJI);
    expect(r.pinFailed).toEqual([]);
    const pinned = (await getNotice(db, a.id))!;
    expect(d.log.filter((l) => l.startsWith('pin'))).toEqual([`pin ${CH.ema} m1`, `pin ${CH.ema} ${pinned.messageId}`]);
    expect(pinned.postedPinned).toBe(true);
  });
});

describe('いちばん下に表示し続ける', () => {
  it('ピン留めはしない。置き直すと新しいメッセージを出して前のを消し、「投稿済み」のまま', async () => {
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: '使い方', body: 'ひな形', pinned: true, sticky: true, by: GUJI });
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('posted');
    expect(d.log).toEqual([`send ${CH.ema} m1`]);
    expect((await stickyNotices(db, CH.ema)).map((x) => x.id)).toEqual([n.id]);
    expect(await restickNotice(ctx, n.id)).toBe(true);
    expect(d.log.slice(1)).toEqual([`send ${CH.ema} m2`, 'delete m1']);
    const after = (await getNotice(db, n.id))!;
    expect(after.messageId).toBe('m2');
    expect(noticeStatus(after, 'ひな形')).toBe('posted');
    expect(d.inChannel(CH.ema).map((m) => m.content)).toEqual(['ひな形']);
  });

  it('BOT: いちばん下なら何もしない。下でなければ置き直す', async () => {
    const { StickyApp } = await import('../src/discord/sticky.js');
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: '使い方', body: 'ひな形', sticky: true, by: GUJI });
    await publishNotice(ctx, n.id, GUJI);
    const app = new StickyApp(db, () => cfg, d.discord);
    await app.restick(CH.ema, () => 'm1');
    expect(d.log).toEqual([`send ${CH.ema} m1`]);
    await app.restick(CH.ema, () => 'someone-else');
    expect(d.log).toEqual([`send ${CH.ema} m1`, `send ${CH.ema} m2`, 'delete m1']);
  });

  it('標準の #絵馬 の案内が前の形（ピン留め）なら、押し直すと「いちばん下に表示し続ける」になる', async () => {
    const { DEFAULT_GUIDES } = await import('../src/services/noticeDefaults.js');
    const NAMES = ['🪧｜絵馬-男性'];
    const channels: GuildChannel[] = NAMES.map((name, i) => ({ id: `93000000000000${1000 + i}`, name, type: 0, parent_id: null, position: i }));
    const d = fakeDiscord(channels);
    const { PREVIOUS_GUIDE_BODIES } = await import('../src/services/noticeDefaults.js');
    const body = PREVIOUS_GUIDE_BODIES['絵馬-男性\n使い方']![1]!;
    expect(DEFAULT_GUIDES.some((t) => t.channelName === '絵馬-男性')).toBe(true);
    const old = await createNotice(db, { channelId: channels[0]!.id, title: '使い方', body, pinned: true, by: GUJI });
    const r = await seedChannelGuides({ db, cfg, discord: d.discord }, GUJI);
    expect(r.updated).toBe(1);
    expect(await getNotice(db, old.id)).toMatchObject({ sticky: true, pinned: false });
  });

  it('#絵馬 を 絵馬殿 に移したあと: 手を加えていない #鳥居 の「ようこそ」なども新しいリンクの文面になる', async () => {
    const { PREVIOUS_GUIDE_BODIES } = await import('../src/services/noticeDefaults.js');
    const d = fakeDiscord();
    const ctx = { db, cfg, discord: d.discord };
    const welcome = await createNotice(db, { channelId: CH.torii, title: 'ようこそ', body: PREVIOUS_GUIDE_BODIES['鳥居\nようこそ']![0]!, by: GUJI });
    const edited = await createNotice(db, { channelId: CH.shikitari, title: '用語集', body: '自分で書いた', by: GUJI });
    await seedChannelGuides(ctx, GUJI);
    const after = (await getNotice(db, welcome.id))!;
    expect(after.body).toContain('{#絵馬-男性}');
    expect(renderNotice(after.body, cfg, CHANNELS).unknown).toEqual([]);
    expect((await getNotice(db, edited.id))!.body).toBe('自分で書いた');
  });
});

describe('メンション', () => {
  const ROLE_A = '920000000000000001';
  const ROLE_B = '920000000000000002';

  it('保存する形と、上に付ける文字・通知を届ける相手', async () => {
    const { mentionValue, mentionHead, mentionAllowed, mentionLabel, parseMention } = await import('../src/services/notices.js');
    const valid = new Set([ROLE_A, ROLE_B]);
    expect(mentionValue('none', [ROLE_A], valid)).toBe('');
    expect(mentionValue('here', [], valid)).toBe('here');
    expect(mentionValue('everyone', [], valid)).toBe('everyone');
    expect(mentionValue('roles', [ROLE_A, ROLE_A, '920000000000000009', ROLE_B], valid)).toBe(`${ROLE_A},${ROLE_B}`);
    expect(mentionValue('roles', [], valid)).toBe('');
    expect(mentionValue('@everyone', [], valid)).toBe('');
    expect(parseMention('abc,1')).toEqual({ kind: 'none' });
    expect(mentionHead(`${ROLE_A},${ROLE_B}`)).toBe(`<@&${ROLE_A}> <@&${ROLE_B}>`);
    expect(mentionHead('everyone')).toBe('@everyone');
    expect(mentionAllowed('here')).toEqual({ parse: ['everyone'] });
    expect(mentionAllowed(ROLE_A)).toEqual({ parse: [], roles: [ROLE_A] });
    expect(mentionAllowed('')).toEqual({ parse: [] });
    expect(mentionLabel(`${ROLE_A},${ROLE_B}`, (id) => (id === ROLE_A ? '新人' : undefined))).toBe(`@新人 @${ROLE_B}`);
  });

  it('はじめての投稿だけ通知を鳴らす。カードはメンションをカードの上に、普通のメッセージは 1 行目に', async () => {
    const f = fakeDiscord();
    const sent: MessageBody[] = [];
    const edited: MessageBody[] = [];
    const send = f.discord.sendMessage;
    const edit = f.discord.editMessage;
    f.discord.sendMessage = async (c, b) => (sent.push(b), send(c, b));
    f.discord.editMessage = async (c, m, b) => (edited.push(b), edit(c, m, b));
    const ctx = { db, cfg, discord: f.discord };
    const card = await createNotice(db, { channelId: CH.torii, title: 'お知らせ', body: '**祭り**です', mention: 'everyone', by: GUJI });
    expect(await publishNotice(ctx, card.id, GUJI)).toBe('posted');
    expect(sent.at(-1)).toMatchObject({ content: '@everyone', embeds: [{ description: '**祭り**です' }], allowed_mentions: { parse: ['everyone'] } });
    expect(noticeStatus((await getNotice(db, card.id))!, '**祭り**です')).toBe('posted');

    // メンションを変えると「未反映」→ 書き換え（通知は鳴らさない）
    await updateNotice(db, card.id, { title: 'お知らせ', body: '**祭り**です', mention: ROLE_A, by: GUJI });
    expect(noticeStatus((await getNotice(db, card.id))!, '**祭り**です')).toBe('changed');
    expect(await publishNotice(ctx, card.id, GUJI)).toBe('edited');
    expect(edited.at(-1)).toMatchObject({ content: `<@&${ROLE_A}>` });
    expect(edited.at(-1)!.allowed_mentions).toBeUndefined();

    const text = await createNotice(db, { channelId: CH.torii, title: '新人へ', body: 'ようこそ', style: 'text', mention: ROLE_A, by: GUJI });
    await publishNotice(ctx, text.id, GUJI);
    expect(sent.at(-1)).toMatchObject({ content: `<@&${ROLE_A}>\nようこそ`, allowed_mentions: { parse: [], roles: [ROLE_A] } });

    // 並べ直し（投稿し直す）では鳴らさない
    sent.length = 0;
    await repostChannel(ctx, CH.torii, GUJI);
    expect(sent.map((b) => b.content)).toEqual(['<@&920000000000000001>', `<@&${ROLE_A}>\nようこそ`]);
    expect(sent.every((b) => b.allowed_mentions === undefined)).toBe(true);
  });

  it('普通のメッセージはメンションの分も文字数に数える', async () => {
    const f = fakeDiscord();
    const n = await createNotice(db, { channelId: CH.torii, title: '長い', body: 'あ'.repeat(1995), style: 'text', mention: 'everyone', by: GUJI });
    expect(await publishNotice({ db, cfg, discord: f.discord }, n.id, GUJI)).toBe('too_long');
  });
});

describe('プレビューの飾り', () => {
  it('Discord の書き方を HTML にする（HTML はそのまま文字で出す）', async () => {
    const { discordMarkdownToHtml: md } = await import('../src/web/markdown.js');
    expect(md('**太字** *斜体* __下線__ ~~消し~~ ||秘密||')).toBe(
      '<div><strong>太字</strong> <em>斜体</em> <u>下線</u> <s>消し</s> <span class="md-spoiler">秘密</span></div>',
    );
    expect(md('# 大\n## 中\n-# 小さい\n- 箇条\n  - 下げる\n1. 一\n> 引用')).toBe(
      '<div class="md-h1">大</div><div class="md-h2">中</div><div class="md-sub">小さい</div><div class="md-li">箇条</div><div class="md-li md-in">下げる</div><div class="md-ol">1. 一</div><div class="md-quote"><div>引用</div></div>',
    );
    expect(md('<script>alert(1)</script> `**そのまま**`')).toBe('<div>&lt;script&gt;alert(1)&lt;/script&gt; <code>**そのまま**</code></div>');
    expect(md('```\n<b>コード</b>\n```')).toBe('<div><pre class="md-code">&lt;b&gt;コード&lt;/b&gt;</pre></div>');
    expect(md('[公式](https://example.com) @everyone')).toBe('<div><span class="md-link">公式</span> <span class="md-mention">@everyone</span></div>');
    expect(md('snake_case_name')).toBe('<div>snake_case_name</div>');
    expect(md('a\n\nb')).toBe('<div>a</div><div class="md-gap"></div><div>b</div>');
  });
});

describe('写真', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);

  it('写真の種類は中身で見分ける。大きすぎるもの・写真でないものは入れない', async () => {
    const { detectImage, setNoticeImage, NOTICE_IMAGE_MAX } = await import('../src/services/notices.js');
    expect(detectImage(PNG)).toEqual({ type: 'image/png', ext: 'png' });
    expect(detectImage(JPG)).toEqual({ type: 'image/jpeg', ext: 'jpg' });
    expect(detectImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined();
    const n = await createNotice(db, { channelId: CH.torii, title: '写真', body: 'x', by: GUJI });
    expect(await setNoticeImage(db, n.id, new TextEncoder().encode('こんにちは、写真ではありません'), GUJI)).toBe('bad_type');
    expect(await setNoticeImage(db, n.id, new Uint8Array(NOTICE_IMAGE_MAX + 1), GUJI)).toBe('too_big');
    expect((await getNotice(db, n.id))!.imageHash).toBeNull();
  });

  it('カード: 下なら本文のカードの中、上なら写真のカードを上に。替える・外すと「未反映」→ 書き換え', async () => {
    const { setNoticeImage, removeNoticeImage } = await import('../src/services/notices.js');
    const f = fakeDiscord();
    const sent: MessageBody[] = [];
    const edited: MessageBody[] = [];
    const send = f.discord.sendMessage;
    const edit = f.discord.editMessage;
    f.discord.sendMessage = async (c, b) => (sent.push(b), send(c, b));
    f.discord.editMessage = async (c, m, b) => (edited.push(b), edit(c, m, b));
    const ctx = { db, cfg, discord: f.discord };
    const n = await createNotice(db, { channelId: CH.torii, title: '祭り', body: '夏祭り', by: GUJI });
    expect(await setNoticeImage(db, n.id, PNG, GUJI)).toBe('ok');
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('posted');
    const name = `notice-${n.id}.png`;
    expect(sent[0]).toMatchObject({ embeds: [{ description: '夏祭り', image: { url: `attachment://${name}` } }] });
    expect(sent[0]!.files).toEqual([{ name, contentType: 'image/png', data: PNG }]);
    expect(noticeStatus((await getNotice(db, n.id))!, '夏祭り')).toBe('posted');

    // 上にする
    await updateNotice(db, n.id, { title: '祭り', body: '夏祭り', imagePosition: 'top', by: GUJI });
    expect(noticeStatus((await getNotice(db, n.id))!, '夏祭り')).toBe('changed');
    expect(await publishNotice(ctx, n.id, GUJI)).toBe('edited');
    expect(edited.at(-1)!.embeds).toEqual([
      { color: 0xd7003a, image: { url: `attachment://${name}` } },
      { description: '夏祭り', color: 0xd7003a },
    ]);
    expect(edited.at(-1)!.files).toHaveLength(1);

    // 写真を替える
    await setNoticeImage(db, n.id, JPG, GUJI);
    expect(noticeStatus((await getNotice(db, n.id))!, '夏祭り')).toBe('changed');
    await publishNotice(ctx, n.id, GUJI);
    expect(edited.at(-1)!.files![0]).toMatchObject({ name: `notice-${n.id}.jpg`, contentType: 'image/jpeg' });

    // 外す → 添付も外す
    await removeNoticeImage(db, n.id, GUJI);
    expect(noticeStatus((await getNotice(db, n.id))!, '夏祭り')).toBe('changed');
    await publishNotice(ctx, n.id, GUJI);
    expect(edited.at(-1)).toMatchObject({ embeds: [{ description: '夏祭り' }], attachments: [] });
    expect(edited.at(-1)!.files).toBeUndefined();
    expect(noticeStatus((await getNotice(db, n.id))!, '夏祭り')).toBe('posted');
  });

  it('普通のメッセージは写真を添付（本文の下）。いちばん下に出し直すときも写真ごと', async () => {
    const { setNoticeImage } = await import('../src/services/notices.js');
    const f = fakeDiscord();
    const sent: MessageBody[] = [];
    const send = f.discord.sendMessage;
    f.discord.sendMessage = async (c, b) => (sent.push(b), send(c, b));
    const ctx = { db, cfg, discord: f.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: 'ひな形', body: '名前:', style: 'text', sticky: true, imagePosition: 'top', by: GUJI });
    await setNoticeImage(db, n.id, PNG, GUJI);
    await publishNotice(ctx, n.id, GUJI);
    expect(sent[0]).toMatchObject({ content: '名前:', embeds: [], files: [{ name: `notice-${n.id}.png` }] });
    expect(await restickNotice(ctx, n.id)).toBe(true);
    expect(sent[1]).toMatchObject({ content: '名前:', files: [{ name: `notice-${n.id}.png` }] });
    // 投稿したあとに写真を替えたら、出し直しは写真なし（未反映の写真は出さない）
    await setNoticeImage(db, n.id, JPG, GUJI);
    await restickNotice(ctx, n.id);
    expect(sent[2]!.files).toBeUndefined();
  });

  it('消すと写真も消える', async () => {
    const { setNoticeImage, getNoticeImage, deleteNotice } = await import('../src/services/notices.js');
    const f = fakeDiscord();
    const n = await createNotice(db, { channelId: CH.torii, title: '写真', body: 'x', by: GUJI });
    await setNoticeImage(db, n.id, PNG, GUJI);
    expect((await getNoticeImage(db, n.id))?.data).toEqual(PNG);
    await deleteNotice({ db, cfg, discord: f.discord }, n.id, GUJI);
    expect(await getNoticeImage(db, n.id)).toBeUndefined();
  });
});

describe('🌸 朱印を押すボタン', () => {
  it('付けるとボタンを付けて投稿。外すと「未反映」→ 書き換えでボタンも外す。出し直しでもボタンごと', async () => {
    const { SHUIN_PICK_ID } = await import('../src/services/notices.js');
    const f = fakeDiscord();
    const sent: MessageBody[] = [];
    const edited: MessageBody[] = [];
    const send = f.discord.sendMessage;
    const edit = f.discord.editMessage;
    f.discord.sendMessage = async (c, b) => (sent.push(b), send(c, b));
    f.discord.editMessage = async (c, m, b) => (edited.push(b), edit(c, m, b));
    const ctx = { db, cfg, discord: f.discord };
    const n = await createNotice(db, { channelId: CH.ema, title: '使い方', body: 'ひな形', sticky: true, shuinButton: true, by: GUJI });
    await publishNotice(ctx, n.id, GUJI);
    expect(JSON.stringify(sent[0]!.components)).toContain(`"custom_id":"${SHUIN_PICK_ID}"`);
    expect(noticeStatus((await getNotice(db, n.id))!, 'ひな形')).toBe('posted');
    await restickNotice(ctx, n.id);
    expect(JSON.stringify(sent[1]!.components)).toContain(SHUIN_PICK_ID);

    await updateNotice(db, n.id, { title: '使い方', body: 'ひな形', shuinButton: false, by: GUJI });
    expect(noticeStatus((await getNotice(db, n.id))!, 'ひな形')).toBe('changed');
    await publishNotice(ctx, n.id, GUJI);
    expect(edited.at(-1)!.components).toEqual([]);
    expect(noticeStatus((await getNotice(db, n.id))!, 'ひな形')).toBe('posted');
  });

  it('標準の #絵馬 のひな形にはボタンが付く（チャンネルの案内を入れる）', async () => {
    const f = fakeDiscord();
    await seedChannelGuides({ db, cfg, discord: f.discord }, GUJI);
    const ema = (await listNotices(db)).filter((x) => x.sticky);
    expect(ema.length).toBeGreaterThan(0);
    expect(ema.every((x) => x.shuinButton)).toBe(true);
    expect((await listNotices(db)).filter((x) => !x.sticky).every((x) => !x.shuinButton)).toBe(true);
  });
});
