import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import type { DiscordActions } from '../src/lib/discordRest.js';
import { voiceTick } from '../src/services/activity.js';
import { activeCoreTime, coreTimeBonus, describeCoreTime, dueCoreTimeNotices, processCoreTimeNotices } from '../src/services/coreTime.js';
import { walletOf } from '../src/services/economy.js';
import { renderNotice } from '../src/services/notices.js';
import { overridesSchema } from '../src/services/settings.js';
import { cfg, makeDb } from './helpers.js';

// 2026-09-25 は金曜日
const jst = (s: string) => new Date(`${s}+09:00`);
const ct = cfg.coreTime;
const KEIDAI = '900000000000000055';
const withKeidai: GuildConfig = { ...cfg, channels: { ...cfg.channels, keidai: KEIDAI } };

describe('コアタイム', () => {
  it('標準は 金曜・土曜の 21:00〜23:00（日本時間）', () => {
    expect(describeCoreTime(ct)).toBe('金曜 21:00〜23:00・土曜 21:00〜23:00');
    expect(activeCoreTime(ct, jst('2026-09-25T20:59:00'))).toBeUndefined();
    expect(activeCoreTime(ct, jst('2026-09-25T21:00:00'))?.day).toBe(5);
    expect(activeCoreTime(ct, jst('2026-09-26T22:59:00'))?.day).toBe(6);
    expect(activeCoreTime(ct, jst('2026-09-26T23:00:00'))).toBeUndefined();
    expect(activeCoreTime(ct, jst('2026-09-24T21:30:00'))).toBeUndefined();
    expect(renderNotice('{コアタイム} {コアタイム倍率}', cfg, []).text).toBe('金曜 21:00〜23:00・土曜 21:00〜23:00 1.5');
  });

  it('設定: 終わりが始まりより前・時刻の形がおかしいものははじく。00:00 の代わりに 24:00', () => {
    expect(overridesSchema.safeParse({ coreTime: { slots: [{ day: 5, start: '23:00', end: '21:00' }] } }).success).toBe(false);
    expect(overridesSchema.safeParse({ coreTime: { slots: [{ day: 5, start: '9:00', end: '21:00' }] } }).success).toBe(false);
    expect(overridesSchema.safeParse({ coreTime: { slots: [{ day: 5, start: '22:00', end: '24:00' }] } }).success).toBe(true);
  });

  it('1.5 倍: 10 分 5 枚 → 8 枚（増えるのは 3 枚。端数は四捨五入）', () => {
    expect(coreTimeBonus(cfg.economy)).toBe(3);
    expect(coreTimeBonus({ ...cfg.economy, coreTimePercent: 100 })).toBe(0);
    expect(coreTimeBonus({ ...cfg.economy, coreTimePercent: 200 })).toBe(5);
  });

  it('予告: 前日 21 時と、始まる 1 時間前（20 時）。30 分までなら遅れても出す', () => {
    const keys = (s: string) => dueCoreTimeNotices(ct, jst(s)).map((n) => n.key);
    expect(keys('2026-09-24T21:00:00')).toEqual(['2026-09-25 21:00 day_before']);
    expect(keys('2026-09-24T21:29:00')).toEqual(['2026-09-25 21:00 day_before']);
    expect(keys('2026-09-24T21:30:00')).toEqual([]);
    expect(keys('2026-09-25T20:00:00')).toEqual(['2026-09-25 21:00 soon']);
    // 金曜 21 時は、土曜の前日の予告
    expect(keys('2026-09-25T21:05:00')).toEqual(['2026-09-26 21:00 day_before']);
    expect(keys('2026-09-26T20:10:00')).toEqual(['2026-09-26 21:00 soon']);
    expect(keys('2026-09-27T21:00:00')).toEqual([]);
  });
});

describe('予告と花びら', () => {
  let db: Db;
  let close: () => Promise<void>;
  let sent: string[];
  const discord = {
    sendMessage: async (c: string, b: { embeds?: { description?: string }[] }) => (sent.push(`${c} ${b.embeds?.[0]?.description}`), { id: 'm' }),
    guildChannels: async () => [],
  } as unknown as DiscordActions;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    sent = [];
  });
  afterEach(async () => {
    await close();
  });

  it('#境内 に 1 回だけ出す', async () => {
    const ctx = { db, cfg: withKeidai, discord };
    expect(await processCoreTimeNotices(ctx, jst('2026-09-24T21:00:00'))).toBe(1);
    expect(await processCoreTimeNotices(ctx, jst('2026-09-24T21:01:00'))).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(KEIDAI);
    expect(sent[0]).toContain('明日はコアタイム');
    expect(sent[0]).toContain('1.5 倍');
    await processCoreTimeNotices(ctx, jst('2026-09-25T20:00:00'));
    expect(sent[1]).toContain('このあと 21:00 からコアタイム');
  });

  it('コアタイム中の通話: 10 分で 8 枚。増えた分は 1 日の上限に数えず、上限に届いていてももらえる', async () => {
    const A = '820000000000000001';
    const e = { ...cfg.economy, voicePer10Min: 5, voiceDailyCap: 10 };
    const t = jst('2026-09-25T21:00:00');
    const tick = async (n: number) => {
      for (let i = 0; i < n; i++) await voiceTick(db, e, [A], t, { coreBonus: coreTimeBonus(e) });
    };
    await tick(10);
    expect((await walletOf(db, A)).balance).toBe(8);
    await tick(10);
    expect((await walletOf(db, A)).balance).toBe(16);
    // 上限（10）に届いたあとも、増えた分（3）はもらえる
    await tick(10);
    expect((await walletOf(db, A)).balance).toBe(19);
    // コアタイムでなければ、上限に届いたら何もない
    for (let i = 0; i < 10; i++) await voiceTick(db, e, [A], t);
    expect((await walletOf(db, A)).balance).toBe(19);
  });
});
