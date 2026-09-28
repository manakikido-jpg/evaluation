import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { glossaryAnswerView, glossaryIndexView } from '../src/discord/glossary.js';
import type { DiscordActions, GuildChannel } from '../src/lib/discordRest.js';
import {
  byCategory,
  createTerm,
  deleteTerm,
  glossaryAll,
  glossaryChannelsOf,
  listTerms,
  loadGlossaryPlaces,
  moveTerm,
  normalizeWord,
  saveGlossaryPlaces,
  searchTerms,
  seedDefaultTerms,
  setTermEnabled,
  syncGlossaryNotices,
  termLine,
  updateTerm,
} from '../src/services/glossary.js';
import { DEFAULT_TERMS } from '../src/services/glossaryDefaults.js';
import { createNotice, listNotices, renderNotice } from '../src/services/notices.js';
import { cfg, makeDb } from './helpers.js';

const GUJI = '870000000000000001';
const CH = { cat: '910000000000000001', shikitari: '910000000000000003', glossary: '910000000000000020', market: '910000000000000030' };
const CHANNELS: GuildChannel[] = [
  { id: CH.cat, name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
  { id: CH.shikitari, name: 'しきたり', type: 0, parent_id: CH.cat, position: 1 },
  { id: CH.market, name: '市場', type: 0, parent_id: null, position: 2 },
];

function fakeDiscord(channels: GuildChannel[]): DiscordActions {
  const none = async () => undefined;
  return {
    addRole: none,
    removeRole: none,
    sendDm: async () => true,
    ban: none,
    unban: none,
    kick: none,
    editMessage: none,
    sendMessage: async () => ({ id: 'm1' }),
    deleteMessage: none,
    pinMessage: none,
    guildChannels: async () => channels,
    editChannel: none,
    setChannelOverwrite: none,
    createChannel: async (_g, b) => ({ id: '0', name: b.name, type: b.type, parent_id: null, position: 0 }),
    reorderChannels: none,
    deleteChannel: none,
    guildRoles: async () => [],
    setNickname: none,
    createRole: async () => ({ id: '0', name: '', position: 0, managed: false, color: 0 }),
    deleteRole: none,
    editRole: none,
  };
}

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('用語集', () => {
  it('標準の言葉を入れる（2 回目は入れない）。今の用語集の言葉と新しい言葉', async () => {
    expect(await seedDefaultTerms(db, GUJI)).toBe(DEFAULT_TERMS.length);
    expect(await seedDefaultTerms(db, GUJI)).toBe(0);
    const terms = (await listTerms(db)).map((t) => t.term);
    for (const w of ['宮司', '朱印', '物御籤', '金の10連券', '天井', '案内待ち', '奥の院', '{通貨}']) expect(terms).toContain(w);
    // カテゴリの順（役職 → 仕組み → 通貨 → 物御籤 → 場所 → 通話）
    expect(byCategory(await listTerms(db)).map((g) => g.category)).toEqual(['roles', 'system', 'economy', 'gacha', 'places', 'voice']);
  });

  it('足す・直す・並べ替え・出さない・消す', async () => {
    const a = await createTerm(db, { category: 'system', term: '朱印', reading: 'しゅいん', emoji: '🌸', description: '評価スタンプ', aliases: '' }, GUJI);
    const b = await createTerm(db, { category: 'system', term: 'ご縁', reading: 'ごえん', emoji: '', description: '評価ポイント', aliases: '' }, GUJI);
    expect(termLine(a)).toBe('- 🌸 **朱印**（しゅいん） … 評価スタンプ');
    expect(termLine(b)).toBe('- **ご縁**（ごえん） … 評価ポイント');
    await moveTerm(db, b.id, 'up');
    expect((await listTerms(db)).map((t) => t.term)).toEqual(['ご縁', '朱印']);
    await updateTerm(db, a.id, { category: 'roles', term: '朱印', reading: '', emoji: '', description: 'スタンプ', aliases: 'はんこ' }, GUJI);
    expect((await listTerms(db)).map((t) => [t.category, t.term])).toEqual([
      ['roles', '朱印'],
      ['system', 'ご縁'],
    ]);
    await setTermEnabled(db, b.id, false);
    expect((await listTerms(db, { enabledOnly: true })).map((t) => t.term)).toEqual(['朱印']);
    await deleteTerm(db, a.id, GUJI);
    expect((await listTerms(db)).map((t) => t.term)).toEqual(['ご縁']);
  });

  it('探す: ぴったり → 始まり → 含む → 説明。読み・別名・カタカナ・{通貨} の今の名前でも', async () => {
    await seedDefaultTerms(db, GUJI);
    const terms = await listTerms(db);
    const first = (q: string) => searchTerms(terms, q, '銭')[0]?.term;
    expect(first('天井')).toBe('天井');
    expect(first('てんじょう')).toBe('天井');
    expect(first('ガチャ')).toBe('物御籤');
    expect(first('がちゃ')).toBe('物御籤');
    expect(first('銭')).toBe('{通貨}');
    expect(first('金の')).toBe('金の10連券');
    expect(first('ＡＦＫ')).toBe('奥の院');
    expect(searchTerms(terms, 'そんなことばはない', '銭')).toEqual([]);
    expect(normalizeWord(' カタカナ・ＡＢＣ ')).toBe('かたかなabc');
  });

  it('/用語 の見た目（一覧・答え）。差し込みは今の値', async () => {
    await seedDefaultTerms(db, GUJI);
    const terms = await listTerms(db, { enabledOnly: true });
    const render = (s: string) => renderNotice(s, cfg, CHANNELS).text;
    const index = JSON.stringify(glossaryIndexView(terms, render));
    expect(index).toContain('⛩ 役職・ロール');
    expect(index).toContain('🪙 銭と授与品');
    const ans = glossaryAnswerView('市場', searchTerms(terms, '市場', '銭'), render);
    expect(JSON.stringify(ans)).toContain(`<#${CH.market}>`);
    expect(glossaryAnswerView('なぞ', [], render).content).toContain('ありませんでした');
  });

  it('掲示に反映: #しきたり の用語集を置きかえ、#用語集 にカテゴリごとのカード。言葉のないカテゴリは消す', async () => {
    await seedDefaultTerms(db, GUJI);
    // 前からある #しきたり の用語集
    await createNotice(db, { channelId: CH.shikitari, title: '用語集', body: '古い用語集', by: GUJI });
    const ctx = { db, cfg, discord: fakeDiscord(CHANNELS) };
    expect(await syncGlossaryNotices(ctx, GUJI)).toEqual({ created: 0, updated: 1, removed: 0, noShikitari: false, noChannel: true });
    const shikitari = (await listNotices(db)).find((n) => n.channelId === CH.shikitari)!;
    expect(shikitari.body).toContain('# 📖 用語集');
    expect(renderNotice(shikitari.body, cfg, CHANNELS).text.length).toBeLessThanOrEqual(4000);

    // #用語集 ができたら、カテゴリごと
    const withChannel = [...CHANNELS, { id: CH.glossary, name: '用語集', type: 0, parent_id: CH.cat, position: 2 }];
    const ctx2 = { db, cfg, discord: fakeDiscord(withChannel) };
    const r = await syncGlossaryNotices(ctx2, GUJI);
    expect(r).toMatchObject({ created: 6, noChannel: false });
    const cards = (await listNotices(db)).filter((n) => n.channelId === CH.glossary);
    expect(cards.map((n) => n.title)).toEqual([
      '用語集: 役職・ロール',
      '用語集: 仕組み',
      '用語集: {通貨}と授与品',
      '用語集: 物御籤・券・札',
      '用語集: 場所',
      '用語集: 通話',
    ]);
    // 同じなら何もしない
    expect(await syncGlossaryNotices(ctx2, GUJI)).toMatchObject({ created: 0, updated: 0, removed: 0 });
    // 通話の言葉を全部出さないと、そのカードは消える
    for (const t of (await listTerms(db)).filter((x) => x.category === 'voice')) await setTermEnabled(db, t.id, false);
    expect(await syncGlossaryNotices(ctx2, GUJI)).toMatchObject({ removed: 1 });
  });

  it('出すチャンネルを選べる: 名前が違っても、選んだチャンネルに出す。選ばなければ「ルール」なども名前で探す', async () => {
    await seedDefaultTerms(db, GUJI);
    const rules = '910000000000000040';
    const words = '910000000000000041';
    const channels: GuildChannel[] = [
      { id: CH.cat, name: '⛩ 鳥居', type: 4, parent_id: null, position: 0 },
      { id: rules, name: '📜｜サーバーの決まり', type: 0, parent_id: CH.cat, position: 1 },
      { id: words, name: '📖｜ことば', type: 0, parent_id: CH.cat, position: 2 },
    ];
    const ctx = { db, cfg, discord: fakeDiscord(channels) };
    expect(await syncGlossaryNotices(ctx, GUJI)).toMatchObject({ noShikitari: true, noChannel: true, created: 0 });

    await saveGlossaryPlaces(db, { rulesChannelId: rules, glossaryChannelId: words }, GUJI);
    expect(await loadGlossaryPlaces(db)).toEqual({ rulesChannelId: rules, glossaryChannelId: words });
    expect(await syncGlossaryNotices(ctx, GUJI)).toMatchObject({ noShikitari: false, noChannel: false, created: 7 });
    const notices = await listNotices(db);
    const main = notices.find((n) => n.channelId === rules && n.title === '用語集')!;
    // #用語集 へのリンクは今の名前で差し込まれる
    expect(renderNotice(main.body, cfg, channels).text).toContain(`<#${words}>`);
    expect(notices.filter((n) => n.channelId === words).length).toBe(6);

    // 選んだチャンネルが消えたら名前で探す（「ルール」も当たる）
    const renamed: GuildChannel[] = [{ id: '910000000000000050', name: '📜ルール', type: 0, parent_id: null, position: 0 }];
    expect(glossaryChannelsOf({ rulesChannelId: rules }, renamed).rules?.id).toBe('910000000000000050');
    expect(glossaryChannelsOf({}, CHANNELS)).toMatchObject({ rules: { id: CH.shikitari }, glossary: undefined });
    // おかしな ID は保存しない
    await saveGlossaryPlaces(db, { rulesChannelId: 'abc' }, GUJI);
    expect(await loadGlossaryPlaces(db)).toEqual({ rulesChannelId: undefined, glossaryChannelId: undefined });
  });

  it('#しきたり に入りきらないときは、役職・仕組みだけと /用語 への案内', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      category: 'places',
      term: `場所${i}`,
      reading: '',
      emoji: '',
      description: 'とても長い説明'.repeat(3),
      aliases: '',
      position: i,
      enabled: true,
      updatedAt: new Date(),
    }));
    const short = glossaryAll(many, { short: true });
    expect(short).not.toContain('場所1');
    expect(short).toContain('`/用語` で調べられます');
  });
});
