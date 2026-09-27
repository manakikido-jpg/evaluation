import { describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import { VoiceChatClearApp } from '../src/discord/voiceChatClear.js';
import { cfg as baseCfg } from './helpers.js';

const NOW = new Date('2026-09-27T12:00:00Z').getTime();
const DAY = 86_400_000;
const VC = '950000000000000001';

/** 偽の通話チャンネル（チャットの書き込みと、いる人） */
function fakeVoice(msgs: { id: string; age: number; pinned?: boolean }[], people: { bot: boolean }[] = []) {
  const messages = msgs.map((m) => ({ ...m, createdTimestamp: NOW - m.age, deleted: false }));
  const members = new Map(people.map((p, i) => [String(i), { user: { bot: p.bot } }]));
  const bulk: string[][] = [];
  const single: string[] = [];
  const alive = () => messages.filter((m) => !m.deleted);
  const channel = {
    id: VC,
    members: { filter: (f: (m: { user: { bot: boolean } }) => boolean) => ({ size: [...members.values()].filter(f).length }) },
    messages: {
      fetch: async () => new Map(alive().slice(0, 100).map((m) => [m.id, { ...m, delete: async () => ((m.deleted = true), single.push(m.id)) }])),
    },
    bulkDelete: async (ids: string[]) => {
      bulk.push(ids);
      for (const m of messages) if (ids.includes(m.id)) m.deleted = true;
    },
  };
  return { channel, members, bulk, single, alive };
}

const cfg: GuildConfig = { ...baseCfg, voiceChat: { clearWhenEmpty: true, delayMinutes: 0 } };

describe('人がいなくなった通話のチャットを消す', () => {
  it('ピン留めは残して、14 日以内はまとめて、古いものは 1 件ずつ消す', async () => {
    const v = fakeVoice([
      { id: 'a', age: 60_000 },
      { id: 'b', age: 2 * DAY },
      { id: 'p', age: DAY, pinned: true },
      { id: 'old', age: 20 * DAY },
    ]);
    const app = new VoiceChatClearApp(() => cfg, () => NOW);
    expect(await app.purge(v.channel as never)).toBe(3);
    expect(v.bulk).toEqual([['a', 'b']]);
    expect(v.single).toEqual(['old']);
    expect(v.alive().map((m) => m.id)).toEqual(['p']);
  });

  it('だれか（BOT 以外）がいたら消さない', async () => {
    const v = fakeVoice([{ id: 'a', age: 1000 }], [{ bot: false }]);
    const app = new VoiceChatClearApp(() => cfg, () => NOW);
    expect(await app.purge(v.channel as never)).toBe(0);
    const onlyBot = fakeVoice([{ id: 'a', age: 1000 }, { id: 'b', age: 1000 }], [{ bot: true }]);
    expect(await app.purge(onlyBot.channel as never)).toBe(2);
  });

  it('最後の人が抜けたら、決めた分待って消す。その間にだれか入ったら消さない。設定でオフにできる', async () => {
    const v = fakeVoice([{ id: 'a', age: 1000 }, { id: 'b', age: 1000 }]);
    const state = (channelId: string | null, channel: unknown = null) => ({ channelId, channel, guild: { id: cfg.guildId } }) as never;
    const app = new VoiceChatClearApp(() => cfg, () => NOW);
    app.onVoiceStateUpdate(state(VC, v.channel), state(null));
    app.onVoiceStateUpdate(state(null), state(VC, v.channel)); // すぐ入った
    await new Promise((r) => setTimeout(r, 20));
    expect(v.alive()).toHaveLength(2);
    app.onVoiceStateUpdate(state(VC, v.channel), state(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(v.alive()).toHaveLength(0);

    const off = fakeVoice([{ id: 'a', age: 1000 }, { id: 'b', age: 1000 }]);
    const app2 = new VoiceChatClearApp(() => ({ ...cfg, voiceChat: { clearWhenEmpty: false, delayMinutes: 0 } }), () => NOW);
    app2.onVoiceStateUpdate(state(VC, off.channel), state(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(off.alive()).toHaveLength(2);
  });
});
