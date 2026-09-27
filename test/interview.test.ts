import { describe, expect, it } from 'vitest';
import { interviewChannelOf, interviewMessage, interviewSchema, jstParts, parseJstLocal, renderInterview } from '../src/services/interview.js';

describe('面談告知', () => {
  const at = parseJstLocal('2026-09-28T21:00')!;

  it('日本時間の日時を読み、9月28日（月） 21:00 のように出す', () => {
    expect(at.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(jstParts(at)).toEqual({ date: '9月28日（月）', time: '21:00' });
    expect(parseJstLocal('明日')).toBeUndefined();
  });

  it('定型文を埋める。場所・一言が空なら、その行を消す', () => {
    const t = interviewSchema.parse({}).template;
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
