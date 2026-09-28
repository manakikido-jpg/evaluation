import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import type { DiscordActions, MessageBody } from '../src/lib/discordRest.js';
import {
  cancelInterview,
  createInterview,
  getInterview,
  interviewChannelOf,
  interviewMessage,
  interviewSchema,
  interviewTick,
  jstParts,
  parseJstLocal,
  postInterview,
  renderInterview,
  updateInterview,
} from '../src/services/interview.js';
import { makeDb } from './helpers.js';

describe('面談告知', () => {
  const at = parseJstLocal('2026-09-28T21:00')!;

  it('日本時間の日時を読み、9月28日（月） 21:00 のように出す', () => {
    expect(at.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(jstParts(at)).toEqual({ date: '9月28日（月）', time: '21:00' });
    expect(parseJstLocal('明日')).toBeUndefined();
  });

  it('定型文を埋める。場所・一言が空なら、その行を消す', () => {
    const t = interviewSchema.parse({}).templates[0]!.body;
    const full = renderInterview(t, { at, place: '🔊 拝殿', note: 'お気軽に！' });
    expect(full).toContain('**9月28日（月） 21:00** から');
    expect(full).toContain(`<t:${at.getTime() / 1000}:R>`);
    expect(full).toContain('- 場所: 🔊 拝殿');
    expect(full).toContain('お気軽に！');
    const bare = renderInterview(t, { at });
    expect(bare).not.toContain('場所');
    expect(bare).not.toContain('{一言}');
    expect(renderInterview('{日付} / {時刻}', { at })).toBe('9月28日（月） / 21:00');
  });

  it('通知: なし・@here・@everyone・ロール', () => {
    const s = interviewSchema.parse({});
    expect(interviewMessage(s, 'x')).toEqual({ content: 'x', allowed_mentions: { parse: [] } });
    expect(interviewMessage({ ...s, mention: 'here' }, 'x')).toEqual({ content: '@here\nx', allowed_mentions: { parse: ['everyone'] } });
    expect(interviewMessage({ ...s, mention: 'role', roleId: '100000000000000001' }, 'x')).toEqual({
      content: '<@&100000000000000001>\nx',
      allowed_mentions: { roles: ['100000000000000001'] },
    });
  });

  it('流し先: 決めていなければ名前に「面談」を含むチャンネル（告知を先に）', () => {
    const ch = (id: string, name: string, type = 0) => ({ id, name, type, parent_id: null, position: 0 });
    const list = [ch('1', '面談'), ch('2', '📢｜面談-告知'), ch('3', '面談', 2)];
    const s = interviewSchema.parse({});
    expect(interviewChannelOf(s, list)?.id).toBe('2');
    expect(interviewChannelOf(s, [ch('1', '雑談')])).toBeUndefined();
    expect(interviewChannelOf({ ...s, channelId: '100000000000000009' }, [ch('100000000000000009', '雑談')])?.name).toBe('雑談');
  });
});

describe('面談: 前の版の設定（定型文 1 つ）を読み直す', () => {
  it('template だけなら「いつもの面談」になる', () => {
    const s = interviewSchema.parse({ template: '# 面談 {日時}', mention: 'here' });
    expect(s.templates).toEqual([{ name: 'いつもの面談', body: '# 面談 {日時}' }]);
    expect(s.mention).toBe('here');
    expect(interviewSchema.parse({}).reminderTemplate).toContain('{あと}');
  });
});

describe('面談: 予約・リマインド・変更・中止', () => {
  const CH = '970000000000000001';
  const VC = '970000000000000002';
  const GUJI = '970000000000000009';
  const at = parseJstLocal('2026-10-03T21:00')!;
  const st = interviewSchema.parse({ mention: 'everyone' });
  let db: Db;
  let close: () => Promise<void>;
  let sent: { channel: string; body: MessageBody }[];
  let edited: { id: string; body: MessageBody }[];
  const discord = {
    sendMessage: async (channel: string, body: MessageBody) => (sent.push({ channel, body }), { id: `m${sent.length}` }),
    editMessage: async (_c: string, id: string, body: MessageBody) => void edited.push({ id, body }),
  } as unknown as DiscordActions;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    sent = [];
    edited = [];
  });
  afterEach(async () => {
    await close();
  });
  const base = (postAt: Date) => ({
    at,
    placeChannelId: VC,
    note: 'お気軽に',
    template: st.templates[0]!,
    channelId: CH,
    postAt,
    remind60: true,
    remind10: true,
  });

  it('予約: 流す日時になったら流す（通知つき）。時間が来るまでは流さない', async () => {
    const postAt = parseJstLocal('2026-10-03T10:00')!;
    const i = await createInterview(db, base(postAt), GUJI);
    expect(await interviewTick({ db, discord }, st, new Date(postAt.getTime() - 60_000))).toEqual({ posted: 0, reminded: 0 });
    expect(await interviewTick({ db, discord }, st, postAt)).toEqual({ posted: 1, reminded: 0 });
    expect(sent[0]).toMatchObject({ channel: CH, body: { allowed_mentions: { parse: ['everyone'] } } });
    expect(sent[0]!.body.content).toContain('@everyone');
    expect(sent[0]!.body.content).toContain(`🔊 <#${VC}>`);
    expect(await getInterview(db, i.id)).toMatchObject({ status: 'posted', messageId: 'm1' });
  });

  it('リマインド: 1 時間前と 10 分前に 1 回ずつ（通知は鳴らさない）。10 分前を過ぎていたら 1 時間前は出さない', async () => {
    const i = await createInterview(db, base(new Date(at.getTime() - DAY)), GUJI);
    await postInterview({ db, discord }, i.id, st, new Date(at.getTime() - DAY));
    const t = (min: number) => new Date(at.getTime() - min * 60_000);
    expect((await interviewTick({ db, discord }, st, t(61))).reminded).toBe(0);
    expect((await interviewTick({ db, discord }, st, t(60))).reminded).toBe(1);
    expect((await interviewTick({ db, discord }, st, t(59))).reminded).toBe(0);
    expect((await interviewTick({ db, discord }, st, t(10))).reminded).toBe(1);
    expect((await interviewTick({ db, discord }, st, t(5))).reminded).toBe(0);
    expect(sent.slice(1).every((x) => x.body.allowed_mentions?.parse?.length === 0)).toBe(true);
    expect(sent[1]!.body.content).toContain('⏰ **21:00** から面談です');

    const late = await createInterview(db, { ...base(new Date(at.getTime() - DAY)), at: new Date(at.getTime() + DAY) }, GUJI);
    await postInterview({ db, discord }, late.id, st, t(0));
    sent = [];
    // BOT が止まっていて、もう 5 分前
    await interviewTick({ db, discord }, st, new Date(late.at.getTime() - 5 * 60_000));
    expect(sent).toHaveLength(1);
    expect((await getInterview(db, late.id))!.remind60At).toBeNull();
  });

  it('変更: 流したあとならメッセージを書き換える（日時が変わったと出す）。リマインドはもう一度', async () => {
    const i = await createInterview(db, base(new Date(at.getTime() - DAY)), GUJI);
    await postInterview({ db, discord }, i.id, st, new Date(at.getTime() - DAY));
    await interviewTick({ db, discord }, st, new Date(at.getTime() - 60 * 60_000));
    const later = parseJstLocal('2026-10-03T22:00')!;
    expect(await updateInterview({ db, discord }, i.id, { at: later, placeText: '拝殿', note: '', remind60: true, remind10: false }, GUJI)).toBe('ok');
    expect(edited[0]!.id).toBe('m1');
    expect(edited[0]!.body.content).toContain('🔁 **日時が変わりました**');
    expect(edited[0]!.body.content).toContain('10月3日（土） 22:00');
    expect(edited[0]!.body.content).toContain('- 場所: 拝殿');
    expect(await getInterview(db, i.id)).toMatchObject({ remind60At: null, remind10: false });
  });

  it('中止: 流したあとなら「中止になりました」に書き換える。予約中なら流さない', async () => {
    const posted = await createInterview(db, base(new Date(at.getTime() - DAY)), GUJI);
    await postInterview({ db, discord }, posted.id, st, new Date(at.getTime() - DAY));
    expect(await cancelInterview({ db, discord }, posted.id, '運営の都合', GUJI)).toBe('ok');
    expect(edited[0]!.body.content).toContain('🙏 **10月3日（土） 21:00 の面談は中止になりました。**');
    expect(edited[0]!.body.content).toContain('> 運営の都合');
    expect(await cancelInterview({ db, discord }, posted.id, '', GUJI)).toBe('not_found');

    const scheduled = await createInterview(db, base(parseJstLocal('2026-10-03T10:00')!), GUJI);
    await cancelInterview({ db, discord }, scheduled.id, '', GUJI);
    sent = [];
    await interviewTick({ db, discord }, st, parseJstLocal('2026-10-03T11:00')!);
    expect(sent).toEqual([]);
  });

  it('面談の時間を過ぎた予約は流さない', async () => {
    await createInterview(db, base(parseJstLocal('2026-10-03T10:00')!), GUJI);
    expect((await interviewTick({ db, discord }, st, new Date(at.getTime() + 60_000))).posted).toBe(0);
  });
});

const DAY = 86_400_000;
