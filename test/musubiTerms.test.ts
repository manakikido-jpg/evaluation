import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions, GuildChannel, MessageBody } from '../src/lib/discordRest.js';
import { isMusubiMode, setMusubiMode, w } from '../src/domain/terms.js';
import { giveReply, goshuinchoReply, vcList } from '../src/discord/views.js';
import { commandDefinitions } from '../src/discord/commands.js';
import { COIN_REASON_LABEL } from '../src/services/economy.js';
import { createNotice, getNotice, publishNotice, renderNotice } from '../src/services/notices.js';
import { DEFAULT_NOTICES, DEFAULT_GUIDES } from '../src/services/noticeDefaults.js';
import { musubiNoticeTemplates, syncMusubiGlossary, syncMusubiNotices, musubiApplied, setMusubiApplied } from '../src/services/musubiSwitch.js';
import { listTerms, seedDefaultTerms, updateTerm } from '../src/services/glossary.js';
import { giveShuin, resetAllShuin, undoAllShuinReset } from '../src/services/shuin.js';
import { ConfigStore } from '../src/services/settings.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const CH = { torii: '910000000000000002', shikitari: '910000000000000003', emaM: '910000000000000005', emaF: '910000000000000010' };
const CHANNELS: GuildChannel[] = [
  { id: CH.torii, name: '鳥居', type: 0, parent_id: null, position: 0 },
  { id: CH.shikitari, name: 'しきたり', type: 0, parent_id: null, position: 1 },
  { id: CH.emaM, name: '絵馬-男性', type: 0, parent_id: null, position: 2 },
  { id: CH.emaF, name: '絵馬-女性', type: 0, parent_id: null, position: 3 },
];

/** 偽の Discord：送った本文（ボタンも）を覚える */
function fakeDiscord() {
  let seq = 0;
  const sent: MessageBody[] = [];
  const discord = {
    sendMessage: async (_c: string, b: MessageBody) => { sent.push(b); return { id: `m${++seq}` }; },
    editMessage: async (_c: string, _m: string, b: MessageBody) => { sent.push(b); },
    deleteMessage: async () => undefined,
    pinMessage: async () => undefined,
    guildChannels: async () => CHANNELS,
  } as unknown as DiscordActions;
  return { discord, sent };
}

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  setMusubiMode(false);
  await close();
});

const G = '700000000000000002';
const A = '200000000000000001';

describe('🧵 呼び名の切り替え（御朱印 → 結び）', () => {
  it('既定は今までの言葉。切り替えると結びの言葉になる', () => {
    expect(isMusubiMode()).toBe(false);
    expect(w('朱印', '結び')).toBe('朱印');
    setMusubiMode(true);
    expect(w('朱印', '結び')).toBe('結び');
  });

  it('Discord の表示：押した返事・プロフィールの欄・通話の一覧・通帳の言葉', () => {
    const given = { kind: 'given' as const, giverRank: cfg.ranks[1]!, weight: 1, goen: 1, restamped: false, addedGoen: 1 };
    const card = () => goshuinchoReply(cfg.ranks, { id: A, displayName: 'さくら', roleIds: [ROLE.sanpaisha] }, { goen: 1, receivedCount: 1, byRank: {}, recentGiverIds: [], givenCount: 0 });
    // 今まで
    expect(giveReply(A, given).content).toContain('朱印を押しました');
    expect(JSON.stringify(card())).toContain('頂いた朱印');
    expect(COIN_REASON_LABEL.shuin_give).toBe('朱印を押した');
    // 結び
    setMusubiMode(true);
    expect(giveReply(A, given).content).toContain('結びました');
    expect(giveReply(A, given).content).not.toContain('朱印');
    const json = JSON.stringify(card());
    expect(json).toContain('結んでくれた人');
    expect(json).toContain('さまのご縁帳');
    expect(json).toContain('"label":"結ぶ"');
    expect(json).not.toContain('朱印');
    expect(vcList([{ id: A, name: 'さくら', stamped: true }], 1).content).toContain('もう結んだ人は ✅');
    expect(COIN_REASON_LABEL.shuin_give).toBe('結んだ');
    expect(COIN_REASON_LABEL.shuin_revoke).toBe('結びの取り消し');
  });

  it('コマンドの日本語の名前：/御朱印帳 → /ご縁帳、/パネル 朱印 → 結ぶ（振り分けの英語名は変えない）', () => {
    const goshuin = () => commandDefinitions(cfg).find((c) => c.name === 'goshuin') as { name: string; name_localizations?: Record<string, string> };
    expect(goshuin().name_localizations?.ja).toBe('御朱印帳');
    setMusubiMode(true);
    expect(goshuin().name).toBe('goshuin');
    expect(goshuin().name_localizations?.ja).toBe('ご縁帳');
    expect(JSON.stringify(commandDefinitions(cfg))).not.toContain('朱印');
  });

  it('標準の掲示の結びの文面には「朱印」が残らない（差し込みのあとで）', () => {
    const list = musubiNoticeTemplates();
    expect(list.length).toBe(8);
    setMusubiMode(true);
    for (const t of list) {
      const text = renderNotice(t.to, cfg, CHANNELS).text;
      expect(text, `${t.channelName} ${t.title}`).not.toMatch(/朱印/);
      expect(t.to).not.toBe(t.from);
    }
  });

  it('掲示：標準のままのものだけ結びに入れかえて出し直す。手を入れたものは変えずに知らせる。元に戻せる', async () => {
    const { discord, sent } = fakeDiscord();
    const ctx = { db, cfg, discord };
    const tmpl = DEFAULT_NOTICES.find((t) => t.channelName === 'しきたり' && t.title === '朱印とご縁')!;
    const ban = DEFAULT_NOTICES.find((t) => t.channelName === 'しきたり' && t.title === '厄と BAN')!;
    const guide = DEFAULT_GUIDES.find((t) => t.channelName === '絵馬-男性' && t.title === '使い方')!;
    const std = await createNotice(db, { channelId: CH.shikitari, title: tmpl.title, body: tmpl.body, by: G });
    const custom = await createNotice(db, { channelId: CH.shikitari, title: ban.title, body: `${ban.body}\n（運営が書き足した行）`, by: G });
    const panel = await createNotice(db, { channelId: CH.emaM, title: guide.title, body: guide.body, shuinButton: true, by: G });
    await publishNotice(ctx, std.id, G);
    await publishNotice(ctx, panel.id, G);
    sent.length = 0;

    setMusubiMode(true);
    const r = await syncMusubiNotices(ctx, true, G);
    expect((await getNotice(db, std.id))!.body).toContain('# 🧵 結び・ご縁・絵馬');
    expect((await getNotice(db, panel.id))!.body).toContain('「結ぶ」');
    expect((await getNotice(db, custom.id))!.body).toContain('朱印'); // 手を入れたものは変えない
    expect(r.custom).toEqual(['#しきたり「厄と BAN」']);
    expect(r.changed).toBe(2);
    // 出し直した掲示のボタンは「🧵 結ぶ」
    const buttons = JSON.stringify(sent.map((b) => b.components ?? []));
    expect(buttons).toContain('"label":"結ぶ"');
    expect(buttons).not.toContain('朱印を押す');

    // 元に戻す（リセットの取り消し）
    setMusubiMode(false);
    await syncMusubiNotices(ctx, false, G);
    expect((await getNotice(db, std.id))!.body).toBe(tmpl.body);
    expect((await getNotice(db, panel.id))!.body).toBe(guide.body);
  });

  it('用語集：標準のままの用語だけ入れかえ（御朱印帳→ご縁帳・朱印→結び・格→絵馬）、手を入れた用語は変えない。元に戻せる', async () => {
    const { discord } = fakeDiscord();
    const ctx = { db, cfg, discord };
    await seedDefaultTerms(db, G);
    const goen = (await listTerms(db)).find((t) => t.term === 'ご縁')!;
    await updateTerm(db, goen.id, { category: 'system', term: 'ご縁', reading: 'ごえん', emoji: '🎀', description: '運営が書いた説明', aliases: '' }, G);

    const n = await syncMusubiGlossary(ctx, true, G);
    const names = (await listTerms(db)).map((t) => t.term);
    expect(names).toContain('ご縁帳');
    expect(names).toContain('結び');
    expect(names).toContain('絵馬');
    expect(names).not.toContain('御朱印帳');
    expect(names).not.toContain('朱印');
    expect((await listTerms(db)).find((t) => t.term === 'ご縁')!.description).toBe('運営が書いた説明');
    expect(n).toBe(5); // 厄年・御朱印帳・朱印・格・しきたり（ご縁は手を入れたので入れかえない）

    await syncMusubiGlossary(ctx, false, G);
    const back = (await listTerms(db)).map((t) => t.term);
    expect(back).toContain('御朱印帳');
    expect(back).toContain('朱印');
    expect(back).not.toContain('結び');
  });

  it('④のあとに用語を入れると、結びの言葉の標準が入る', async () => {
    setMusubiMode(true);
    await seedDefaultTerms(db, G);
    const names = (await listTerms(db)).map((t) => t.term);
    expect(names).toContain('結び');
    expect(names).not.toContain('朱印');
  });

  it('言葉は ④ご縁のリセットの印に合わせて切り替わる（社務所Web・BOT の設定の読み直しで）。最後に当てた言葉も覚える', async () => {
    const store = new ConfigStore(db, cfg);
    await store.refresh();
    expect(isMusubiMode()).toBe(false);
    await giveShuin(db, { giverId: A, receiverId: '200000000000000002', weight: 1, giverRank: 'sanpaisha' }); // 元に戻せるよう、リセット前の結びを1つ
    await resetAllShuin(db, G);
    await store.refresh();
    expect(isMusubiMode()).toBe(true);
    await undoAllShuinReset(db, G);
    await store.refresh();
    expect(isMusubiMode()).toBe(false);
    expect(await musubiApplied(db)).toBe(false);
    await setMusubiApplied(db, true);
    expect(await musubiApplied(db)).toBe(true);
  });
});
