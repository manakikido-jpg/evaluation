import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { VoiceCounterApp } from '../src/discord/voiceCounter.js';
import { counterName, countInGroups } from '../src/services/voiceCounter.js';
import { applyOverrides, overridesSchema } from '../src/services/settings.js';
import { cfg } from './helpers.js';

const groups = [
  { name: '大きな縁側', min: 3, max: 20 },
  { name: '小さな縁側', min: 3, max: 20 },
  { name: '作業部屋', min: 2, max: 5 },
];
const ch = (id: string, name: string, members: number) => ({ id, name, position: 0, members });

describe('👥 縁側の人数', () => {
  it('名前に「縁側」がある仲間の人数を合わせる（ほかの通話は数えない）', () => {
    const channels = [ch('1', '大きな縁側 1', 3), ch('2', '大きな縁側 2', 2), ch('3', '小さな縁側 1', 1), ch('4', '作業部屋 1', 5), ch('5', '雑談', 9)];
    expect(countInGroups(channels, groups, '縁側')).toBe(6);
    const vc = { name: '{icon} {n}人｜縁側', midAt: 5, highAt: 10 };
    expect(counterName(vc, 0)).toBe('💤 0人｜縁側');
    expect(counterName(vc, 4)).toBe('🟢 4人｜縁側');
    expect(counterName(vc, 5)).toBe('🟡 5人｜縁側');
    expect(counterName(vc, 10)).toBe('🔴 10人｜縁側');
  });

  it('名前が変わるときだけ書きかえる。前に書きかえてから 5 分あける', async () => {
    let t = 0;
    const setName = vi.fn(async (n: string) => { target.name = n; });
    const target = { name: '👥 縁側', setName };
    const voice = (id: string, name: string, n: number) => ({ id, name, rawPosition: 0, type: ChannelType.GuildVoice, members: { filter: () => ({ size: n }) } });
    const list = [voice('100000000000000001', '大きな縁側 1', 2)];
    const guild = { channels: { cache: { get: () => target, values: () => list.values() } } };
    const c = { ...cfg, voiceGroups: groups, voiceCounter: { channelId: '100000000000000099', name: '👥 縁側 いま {n} 人', match: '縁側', midAt: 5, highAt: 10 } };
    const app = new VoiceCounterApp(() => c, () => t);
    app.attach(guild as never);
    t = 10 * 60_000;
    await app.tick();
    expect(setName).toHaveBeenCalledTimes(1);
    expect(target.name).toBe('👥 縁側 いま 2 人');
    // 同じ人数なら書きかえない
    await app.tick();
    expect(setName).toHaveBeenCalledTimes(1);
    // 人数が変わっても 5 分たつまでは待つ
    list.push(voice('100000000000000002', '大きな縁側 2', 1));
    t += 60_000;
    await app.tick();
    expect(setName).toHaveBeenCalledTimes(1);
    t += 4 * 60_000;
    await app.tick();
    expect(target.name).toBe('👥 縁側 いま 3 人');
  });

  it('設定: チャンネルを空（null）にすると止める。送らなければ前のまま', () => {
    const on = applyOverrides(cfg, overridesSchema.parse({ voiceCounter: { channelId: '100000000000000099', name: '縁側 {n}' } }));
    expect(on.voiceCounter).toMatchObject({ channelId: '100000000000000099', name: '縁側 {n}', match: '縁側', midAt: 5, highAt: 10 });
    const off = applyOverrides({ ...cfg, voiceCounter: on.voiceCounter }, overridesSchema.parse({ voiceCounter: { channelId: null } }));
    expect(off.voiceCounter.channelId).toBeUndefined();
    expect(applyOverrides(cfg, overridesSchema.parse({})).voiceCounter.channelId).toBeUndefined();
  });
});
