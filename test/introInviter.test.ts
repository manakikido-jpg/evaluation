import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { intros, members } from '../src/db/schema.js';
import { introInviterText, matchIntroInviters } from '../src/domain/introInviter.js';
import { DiscordHttpError } from '../src/lib/discordRest.js';
import { listAudit } from '../src/services/audit.js';
import { introInviterSuggestions, refreshIntroInviter } from '../src/services/introInviterSuggestions.js';
import { introOf, recordIntro, removeIntroMessages } from '../src/services/intros.js';
import { inviterOf } from '../src/services/invites.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const A = '780000000000000001', B = '780000000000000002', C = '780000000000000003';
const CHANNEL = '780000000000000011', MESSAGE = '780000000000000021';
const config = { ...cfg, channels: { ...cfg.channels, ema: CHANNEL } };
const at = new Date('2026-11-01T00:00:00Z');
const people = [{ id: A, name: '自分', username: 'me' }, { id: B, name: 'さくら', username: 'sakura' }, { id: C, name: 'さくら', username: 'sakura2' }];

describe('絵馬の招待者欄', () => {
  it.each([
    ['【名前】新人\n【招待者】さくら', 'さくら'],
    ['【一言】' + '長い自己紹介'.repeat(100) + '\n【招待者】\n\nさくらさん\n【その他】秘密', 'さくらさん'],
    ['**【招待者】** <@!' + B + '>\r\n【名前】別の人', '<@!' + B + '>'],
    ['招待者：ＳＡＫＵＲＡ', 'ＳＡＫＵＲＡ'],
    ['【招待者】さくら【一言】秘密', 'さくら'],
    ['> 【招待者】\n> さくら', 'さくら'],
    ['【招待者】\n【一言】さくら', ''],
    ['【招待者】\n```\n-# 招待者は誘った人', ''],
    ['【名前】さくら\n【一言】<@' + B + '>さんが好き', ''],
  ])('招待者欄だけを読む: %s', (content, expected) => expect(introInviterText(content)).toBe(expected));

  it('メンションを優先し、同名は複数候補。本人や曖昧な部分一致を採用しない', () => {
    expect(matchIntroInviters(`<@${B}> さくら`, A, people).map(m => m.id)).toEqual([B]);
    expect(matchIntroInviters('さくらさん', A, people).map(m => m.id)).toEqual([B, C]);
    expect(matchIntroInviters('＠ＳＡＫＵＲＡ', A, people).map(m => m.id)).toEqual([B]);
    expect(matchIntroInviters('さく', A, people)).toEqual([]);
    expect(matchIntroInviters(`<@${A}>`, A, people)).toEqual([]);
    expect(matchIntroInviters('なし', A, people)).toEqual([]);
    expect(matchIntroInviters(`さくら <@780000000000000099>`, A, people)).toEqual([]);
    expect(introInviterText('【招待者】' + 'あ'.repeat(300))).toHaveLength(200);
  });
});

describe('記録からの候補と読み直し', () => {
  let db: Db, close: () => Promise<void>;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    await db.insert(members).values(people.map(m => ({ id: m.id, username: m.username, displayName: m.name })));
  });
  afterEach(async () => { vi.restoreAllMocks(); await close(); });
  const save = (content: string, messageId = MESSAGE, postedAt = at) => recordIntro(db, { memberId: A, channelId: CHANNEL, messageId, content, postedAt });
  const suggestions = async () => (await introInviterSuggestions(db, config, [A])).get(A)!;
  const remote = (content = `【招待者】<@${B}>`) => ({ id: MESSAGE, channel_id: CHANNEL, timestamp: at.toISOString(), content, author: { id: A } });

  it('300文字より後の欄も保存する。表示だけでは招待登録・報酬を変えない', async () => {
    await save('【一言】' + 'あ'.repeat(400) + '\n【招待者】さくらさん');
    expect((await introOf(db, A))!.excerpt).not.toContain('招待者');
    expect(await suggestions()).toMatchObject({ text: 'さくらさん', fromExcerpt: false, candidates: [{ id: B }, { id: C }], url: `https://discord.com/channels/${cfg.guildId}/${CHANNEL}/${MESSAGE}` });
    expect(await inviterOf(db, A)).toBeUndefined();
    expect((await walletOf(db, B)).balance).toBe(0);
  });

  it('本人・BOT・退出者と、絵馬以外の投稿は候補から外す', async () => {
    await db.update(members).set({ isBot: true }).where(eq(members.id, B));
    await db.update(members).set({ leftAt: at }).where(eq(members.id, C));
    await save(`【招待者】<@${A}> <@${B}> <@${C}>`);
    expect((await suggestions()).candidates).toEqual([]);
    expect(await introInviterSuggestions(db, cfg, [A])).toEqual(new Map());
  });

  it('編集で候補を更新し、古い投稿では上書きしない。削除では該当投稿だけ消す', async () => {
    await save(`【招待者】<@${B}>`);
    await save(`【招待者】<@${C}>`);
    expect((await suggestions()).candidates.map(m => m.id)).toEqual([C]);
    await save(`【招待者】<@${B}>`, '古い投稿', new Date(at.getTime() - 1000));
    await removeIntroMessages(db, ['古い投稿']);
    expect((await suggestions()).candidates.map(m => m.id)).toEqual([C]);
    await save('【招待者】\n【一言】削除しました');
    expect((await suggestions()).candidates).toEqual([]);
    await removeIntroMessages(db, [MESSAGE]);
    expect(await introOf(db, A)).toBeUndefined();
  });

  it('旧記録からの候補を明記し、全文を読み直して末尾の欄を更新する', async () => {
    await db.insert(intros).values({ memberId: A, channelId: CHANNEL, messageId: MESSAGE, excerpt: '【招待者】さくら', postedAt: at });
    expect((await suggestions()).fromExcerpt).toBe(true);
    const fetch = vi.fn().mockResolvedValue(remote('【一言】' + 'あ'.repeat(400) + `\n【招待者】<@${B}>`));
    expect(await refreshIntroInviter(db, config, { introMessage: fetch }, A, C)).toBe('refreshed');
    expect(fetch).toHaveBeenCalledWith(CHANNEL, MESSAGE);
    expect(await suggestions()).toMatchObject({ fromExcerpt: false, candidates: [{ id: B }] });
    const logs = await listAudit(db, { action: 'invite.intro_refresh' });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.detail).toEqual({ channelId: CHANNEL, messageId: MESSAGE });
    expect(await inviterOf(db, A)).toBeUndefined();
    expect((await walletOf(db, B)).balance).toBe(0);
  });

  it('他人の本文・権限不足・本文不明では更新しない。404では古い候補を外す', async () => {
    await save(`【招待者】<@${B}>`);
    const fetch = vi.fn().mockResolvedValue({ ...remote(), author: { id: C } });
    const api = { introMessage: fetch };
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('unavailable');
    fetch.mockRejectedValueOnce(new DiscordHttpError('閲覧不可', 403));
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('unavailable');
    fetch.mockResolvedValueOnce(remote(''));
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('unavailable');
    expect((await suggestions()).candidates.map(m => m.id)).toEqual([B]);
    fetch.mockRejectedValueOnce(new DiscordHttpError('削除済み', 404));
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('missing');
    expect(await introOf(db, A)).toBeUndefined();
    fetch.mockClear();
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('missing');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('読み直し中に新しい絵馬が記録されても、新しいほうを残す', async () => {
    await save(`【招待者】<@${B}>`);
    const api = { introMessage: async () => {
      await save(`【招待者】<@${C}>`, '新しい投稿', new Date(at.getTime() + 1000));
      return remote();
    } };
    expect(await refreshIntroInviter(db, config, api, A, C)).toBe('refreshed');
    expect((await suggestions()).candidates.map(m => m.id)).toEqual([C]);
  });
});
