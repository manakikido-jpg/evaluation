import { describe, expect, it } from 'vitest';
import type { Guild, VoiceState } from 'discord.js';
import { AfkMuteApp } from '../src/discord/afkMute.js';
import { afkMutedIds } from '../src/services/afkMute.js';
import { cfg, makeDb } from './helpers.js';

const AFK = '960000000000000001';
const VC = '960000000000000002';
const USER = '960000000000000010';

function fakeGuild() {
  const voiceStates = new Map<string, VoiceState>();
  return { id: cfg.guildId, afkChannelId: AFK, voiceStates: { cache: voiceStates } } as unknown as Guild & { voiceStates: { cache: Map<string, VoiceState> } };
}

function state(guild: Guild, channelId: string | null, serverMute = false, calls: boolean[] = [], fail = false) {
  return {
    id: USER, guild, channelId, serverMute, member: { user: { bot: false } },
    setMute: async (m: boolean) => { if (fail) throw new Error('no'); calls.push(m); },
  } as unknown as VoiceState;
}

describe('奥の院に入ったら自動でミュート', () => {
  it('入ったらミュート、ほかの通話へ移ったら外す', async () => {
    const { db } = await makeDb();
    const app = new AfkMuteApp(db, () => cfg);
    const g = fakeGuild();
    const calls: boolean[] = [];
    await app.onVoiceStateUpdate(state(g, VC), state(g, AFK, false, calls));
    expect(calls).toEqual([true]);
    expect(await afkMutedIds(db)).toEqual([USER]);
    await app.onVoiceStateUpdate(state(g, AFK, true), state(g, VC, true, calls));
    expect(calls).toEqual([true, false]);
    expect(await afkMutedIds(db)).toEqual([]);
  });

  it('もとから運営がミュートしていた人は、出ても外さない', async () => {
    const { db } = await makeDb();
    const app = new AfkMuteApp(db, () => cfg);
    const g = fakeGuild();
    const calls: boolean[] = [];
    await app.onVoiceStateUpdate(state(g, VC, true), state(g, AFK, true, calls));
    await app.onVoiceStateUpdate(state(g, AFK, true), state(g, VC, true, calls));
    expect(calls).toEqual([]);
  });

  it('通話を抜けた人は覚えておき、次に入ったときや起動したときに外す。外せなければ覚えたまま', async () => {
    const { db } = await makeDb();
    const app = new AfkMuteApp(db, () => cfg);
    const g = fakeGuild();
    await app.onVoiceStateUpdate(state(g, VC), state(g, AFK));
    await app.onVoiceStateUpdate(state(g, AFK, true), state(g, null, true));
    expect(await afkMutedIds(db)).toEqual([USER]);
    await app.onVoiceStateUpdate(state(g, null, true), state(g, VC, true, [], true));
    expect(await afkMutedIds(db)).toEqual([USER]);
    const calls: boolean[] = [];
    g.voiceStates.cache.set(USER, state(g, VC, true, calls));
    await app.attach(g);
    expect(calls).toEqual([false]);
    expect(await afkMutedIds(db)).toEqual([]);
  });

  it('起動したとき、いま奥の院にいる人もミュートする', async () => {
    const { db } = await makeDb();
    const app = new AfkMuteApp(db, () => cfg);
    const g = fakeGuild();
    const calls: boolean[] = [];
    g.voiceStates.cache.set(USER, state(g, AFK, false, calls));
    await app.attach(g);
    expect(calls).toEqual([true]);
    expect(await afkMutedIds(db)).toEqual([USER]);
  });
});
