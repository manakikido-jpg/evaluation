import { describe, expect, it, vi } from 'vitest';
import { nextVoiceLine, walletView, walletDuration, WalletApp } from '../src/discord/wallet.js';
import { emptyTickets } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';
import { activityDaily, voiceUsage } from '../src/db/schema.js';
import type { Interaction } from 'discord.js';

describe('/残高', () => {
  it('銭・今日の通話・券・最近の出入りを出す', () => {
    const at = new Date('2026-09-27T12:00:00Z');
    const v = walletView(cfg.economy, {
      balance: 1234,
      lifetimeEarned: 5000,
      today: { vcCoins: 30, vcMinutes: 65 },
      recent: [
        { amount: 500, reason: 'gacha_refund', at },
        { amount: -500, reason: 'gacha', at },
      ],
      tickets: { ...emptyTickets(), fuku: 1 },
      custom: [],
      buffs: { luck: 3 },
    });
    const text = [v.embeds[0]!.description, ...v.embeds[0]!.fields.map(f => `${f.name}\n${f.value}`)].join('\n');
    for (const t of ['🪙銭 **1,234** 枚', '累計の受取：5,000枚', `今日の受取 **30 / ${cfg.economy.voiceDailyCap} 枚**`, '1時間5分', '🧧 福の札 **×1**', '運気アップ：物御籤あと3回', '＋500枚', '物御籤の払い戻し', '－500枚'])
      expect(text).toContain(t);
    const empty = walletView(cfg.economy, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 0, vcMinutes: 0 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 } });
    // 役職の倍率があれば、上限もその分
    const ranked = walletView({ ...cfg.economy, voicePer10Min: 10, voiceDailyCap: 150 }, { balance: 0, lifetimeEarned: 0, today: { vcCoins: 30, vcMinutes: 20 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 }, voicePercent: 150, voiceCapPercent: 200 });
    expect(ranked.embeds[0]!.fields[1]!.value).toContain('今日の受取 **30 / 300 枚**');
    expect(ranked.embeds[0]!.fields[1]!.value).toContain('10分ごと 15枚・1日300枚まで');
    expect(empty.embeds[0]!.fields.at(-1)!.value).toContain('まだありません');
    expect(empty.embeds[0]!.fields.find(f => f.name.includes('券'))!.value).toContain('持っている券はありません');
  });

  it('次に通話の銭が入るまで: あと何分で何枚（上限に届いたら、その知らせ）', () => {
    const e = { voicePer10Min: 5 };
    // 4 分 → あと 6 分で +5
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 4 }, 100)).toEqual(['-# あと **6 分**で +5 枚（2 人以上の通話で、スピーカーミュートしていない時間だけ数えます）']);
    // 0 分・20 分ちょうど → あと 10 分
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 0 }, 100)[0]).toContain('あと **10 分**で +5 枚');
    expect(nextVoiceLine(e, { vcCoins: 10, vcMinutes: 20 }, 100)[0]).toContain('あと **10 分**で +5 枚');
    // 上限の手前は残りだけ・上限に届いたら知らせ
    expect(nextVoiceLine(e, { vcCoins: 98, vcMinutes: 197 }, 100)[0]).toContain('あと **3 分**で +2 枚');
    expect(nextVoiceLine(e, { vcCoins: 100, vcMinutes: 200 }, 100)).toEqual(['-# 今日の上限に届きました（日本時間の 0 時からまた）']);
    // 役職の倍率（150%）・0% なら出さない
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 150, 150)[0]).toContain('+8 枚');
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 0, 0)).toEqual(['今の役職では通常の通話報酬はありません。']);
    expect(nextVoiceLine(e, { vcCoins: 0, vcMinutes: 1 }, 100, 0)[0]).toContain('通常の通話報酬はありません');
    // /残高 の中にも出る
    const v = walletView(cfg.economy, { balance: 230, lifetimeEarned: 47454, today: { vcCoins: 0, vcMinutes: 4 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 } });
    expect(v.embeds[0]!.fields[1]!.value).toContain(`あと **6 分**で +${cfg.economy.voicePer10Min} 枚`);
  });
});


it('浮上時間と報酬対象時間を区別し、0時間・端数・長時間も時間と分で出す', () => {
  expect(walletDuration(0)).toBe('0時間0分');
  expect(walletDuration(59)).toBe('0時間59分');
  expect(walletDuration(60)).toBe('1時間0分');
  expect(walletDuration(93)).toBe('1時間33分');
  expect(walletDuration(420)).toBe('7時間0分');
  const v = walletView(cfg.economy, { balance: 4056, lifetimeEarned: 93381, today: { vcCoins: 0, vcMinutes: 93, presenceMinutes: 420 }, recent: [], tickets: emptyTickets(), custom: [], buffs: { luck: 0 }, voicePercent: 0, voiceCapPercent: 0 });
  expect(v.embeds[0]!.fields[0]!.value).toContain('7時間0分');
  expect(v.embeds[0]!.fields[1]!.value).toContain('1時間33分');
  expect(v.embeds[0]!.fields[1]!.value).not.toContain('上限に届きました');
});


it('本人の今日のVC時間を合算し、前の日や他人の時間は混ぜない', async () => {
  const { db, close } = await makeDb();
  const id = '700000000000000001';
  try {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T03:00:00Z'));
    await db.insert(activityDaily).values({ memberId: id, date: '2026-10-09', vcMinutes: 93, vcCoins: 0 });
    await db.insert(voiceUsage).values([
      { memberId: id, date: '2026-10-09', channelId: 'a', minutes: 200 },
      { memberId: id, date: '2026-10-09', channelId: 'b', minutes: 220 },
      { memberId: id, date: '2026-10-08', channelId: 'a', minutes: 900 },
      { memberId: 'other', date: '2026-10-09', channelId: 'a', minutes: 900 },
    ]);
    const i = {
      isChatInputCommand: () => true, commandName: 'zandaka', inCachedGuild: () => true, guildId: cfg.guildId,
      user: { id }, member: { roles: { cache: new Map() } },
      deferReply: vi.fn(async () => undefined), editReply: vi.fn(async (_body: unknown) => undefined),
    };
    await new WalletApp(db, () => cfg).onInteraction(i as unknown as Interaction);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
    const body = i.editReply.mock.calls[0]![0] as ReturnType<typeof walletView>;
    expect(body.embeds[0]!.fields[0]!.value).toContain('7時間0分');
    expect(body.embeds[0]!.fields[1]!.value).toContain('1時間33分');
  } finally { vi.useRealTimers(); await close(); }
});
