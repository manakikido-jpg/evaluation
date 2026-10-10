import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { longVoiceBonuses, members, voiceUsage } from '../src/db/schema.js';
import { awardLongVoiceBonuses, activityWeek, notifyLongVoiceBonuses } from '../src/services/longVoiceBonus.js';
import * as economy from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { recordPresence } from '../src/services/voiceUsage.js';
import { cfg, makeDb } from './helpers.js';

const ID = '870000000000000001';
const now = new Date('2026-10-09T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await recordJoin(db, { id: ID, username: 'sakura', displayName: 'さくら', avatarUrl: null, roleIds: [], isBot: false, joinedAt: now });
});
afterEach(async () => { vi.restoreAllMocks(); await close(); });
const usage = (date: string, minutes = 420, channelId = 'channel-a') => db.insert(voiceUsage).values({ memberId: ID, date, channelId, minutes });
const sender = () => ({ sendMessage: vi.fn(async (_channel: string, _body: unknown) => ({ id: 'notice' })) });

describe('7時間の浮上ボーナス', () => {
  it('VC移動の時間を合算し、419分ではまだ、420分で1回だけ追加する', async () => {
    await usage('2026-10-09', 200);
    await usage('2026-10-09', 219, 'channel-b');
    await awardLongVoiceBonuses(db, cfg, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(0);
    await recordPresence(db, [{ id: 'channel-b', name: '通話', categoryId: null, categoryName: null, memberIds: [ID] }], now);
    await Promise.all([awardLongVoiceBonuses(db, cfg, now), awardLongVoiceBonuses(db, cfg, now)]);
    await awardLongVoiceBonuses(db, { ...cfg, economy: { ...cfg.economy, longVoiceBonusAmount: 600 } }, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(300);
    expect(await db.select().from(longVoiceBonuses)).toHaveLength(1);
  });

  it('数える通話チャンネルを決めると、そのチャンネルの時間だけで 7 時間を数える', async () => {
    const A = '870000000000000101', B = '870000000000000102';
    await usage('2026-10-09', 300, A);
    await usage('2026-10-09', 200, B);
    const only = (ids: string[]) => ({ ...cfg, economy: { ...cfg.economy, longVoiceBonusVoiceChannelIds: ids } });
    await awardLongVoiceBonuses(db, only([A]), now);
    expect((await economy.walletOf(db, ID)).balance).toBe(0);
    await awardLongVoiceBonuses(db, only([A, B]), now);
    expect((await economy.walletOf(db, ID)).balance).toBe(300);
  });

  it('同じ週の3日目は払わず、日本時間の月曜0時で週の回数を戻す', async () => {
    for (const date of ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']) {
      await usage(date);
      await awardLongVoiceBonuses(db, cfg, new Date(`${date}T00:00:00+09:00`));
    }
    expect((await economy.walletOf(db, ID)).balance).toBe(900);
    const rows = await db.select().from(longVoiceBonuses);
    expect(rows.map(r => r.weekSlot).sort()).toEqual([1, 1, 2]);
    expect(rows.some(r => r.date === '2026-10-11')).toBe(false);
    expect(activityWeek(new Date('2026-10-11T14:59:59Z'))).toBe('2026-10-05');
    expect(activityWeek(new Date('2026-10-11T15:00:00Z'))).toBe('2026-10-12');
    expect(activityWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12-28');
  });

  it('BOT・退出者・0銭は対象外、通常の日額上限0でも追加分は払う', async () => {
    await usage('2026-10-09');
    await awardLongVoiceBonuses(db, { ...cfg, economy: { ...cfg.economy, longVoiceBonusAmount: 0 } }, now);
    await db.update(members).set({ isBot: true }).where(eq(members.id, ID));
    await awardLongVoiceBonuses(db, cfg, now);
    await db.update(members).set({ isBot: false, leftAt: now }).where(eq(members.id, ID));
    await awardLongVoiceBonuses(db, cfg, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(0);
    await db.update(members).set({ leftAt: null }).where(eq(members.id, ID));
    await awardLongVoiceBonuses(db, { ...cfg, economy: { ...cfg.economy, voiceDailyCap: 0 } }, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(300);
  });

  it('日付をまたぐ時間を混ぜず、過去の日へはさかのぼって払わない', async () => {
    await usage('2026-10-08', 600);
    await usage('2026-10-09', 419);
    await awardLongVoiceBonuses(db, cfg, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(0);
  });

  it('支払いが失敗したら回数と入金を両方戻して、次回やり直せる', async () => {
    await usage('2026-10-09');
    vi.spyOn(economy, 'addCoins').mockRejectedValueOnce(new Error('一時的なDBの失敗'));
    await awardLongVoiceBonuses(db, cfg, now);
    expect(await db.select().from(longVoiceBonuses)).toHaveLength(0);
    expect((await economy.walletOf(db, ID)).balance).toBe(0);
    await awardLongVoiceBonuses(db, cfg, now);
    expect((await economy.walletOf(db, ID)).balance).toBe(300);
  });

  it('慶事へ受取人だけ通知し、送信失敗と同時処理でも入金を重ねない', async () => {
    await usage('2026-10-09');
    await awardLongVoiceBonuses(db, cfg, now);
    const discord = sender();
    discord.sendMessage.mockRejectedValueOnce(new Error('送信失敗'));
    await notifyLongVoiceBonuses(db, cfg, discord, now);
    expect((await db.select().from(longVoiceBonuses))[0]?.notifiedAt).toBeNull();
    await Promise.all([notifyLongVoiceBonuses(db, cfg, discord, now), notifyLongVoiceBonuses(db, cfg, discord, now)]);
    expect(discord.sendMessage).toHaveBeenCalledTimes(2);
    expect(discord.sendMessage).toHaveBeenLastCalledWith(cfg.channels.keiji, expect.objectContaining({ content: expect.stringContaining('300銭'), allowed_mentions: { parse: [], users: [ID] } }));
    expect((await economy.walletOf(db, ID)).balance).toBe(300);
    await notifyLongVoiceBonuses(db, cfg, discord, now);
    expect(discord.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('送信中の通知は奪わず、停止後に残った通知を5分後に設定先へ再送する', async () => {
    await usage('2026-10-09');
    await awardLongVoiceBonuses(db, cfg, now);
    await db.update(longVoiceBonuses).set({ notifyClaimedAt: now });
    const discord = sender();
    await notifyLongVoiceBonuses(db, cfg, discord, now);
    expect(discord.sendMessage).not.toHaveBeenCalled();
    await notifyLongVoiceBonuses(db, { ...cfg, economy: { ...cfg.economy, longVoiceBonusChannelId: '910000000000000001', longVoiceBonusAmount: 600 } }, discord, new Date(now.getTime() + 301_000));
    expect(discord.sendMessage).toHaveBeenCalledWith('910000000000000001', expect.objectContaining({ content: expect.stringContaining('300銭') }));
  });
});
