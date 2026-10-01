import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { omikujiEmbed, omikujiVoiceBlock } from '../src/discord/omikuji.js';
import { walletOf } from '../src/services/economy.js';
import { describeStreakRewards, drawFortune, drawOmikuji, FORTUNES, nextStreakReward, omikujiRange, omikujiReward, streakOf } from '../src/services/omikuji.js';
import { ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

/** 決まった順に数を返す（くじの結果を決めるため） */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('おみくじ', () => {
  it('出やすさは合計 100。乱数の位置で運勢が決まる', () => {
    expect(FORTUNES.reduce((n, f) => n + f.weight, 0)).toBe(100);
    expect(drawFortune(() => 0).name).toBe('大吉');
    expect(drawFortune(() => 0.079).name).toBe('大吉');
    expect(drawFortune(() => 0.08).name).toBe('中吉');
    expect(drawFortune(() => 0.999).name).toBe('大凶');
  });

  it('花びら: 基本 10 なら 吉 10・大吉 30・凶 5。基本 0 ならなし', () => {
    const f = (name: string) => FORTUNES.find((x) => x.name === name)!;
    expect(omikujiReward({ omikujiBase: 10 }, f('吉'))).toBe(10);
    expect(omikujiReward({ omikujiBase: 10 }, f('大吉'))).toBe(30);
    expect(omikujiReward({ omikujiBase: 10 }, f('小吉'))).toBe(15);
    expect(omikujiReward({ omikujiBase: 10 }, f('凶'))).toBe(5);
    expect(omikujiReward({ omikujiBase: 1 }, f('凶'))).toBe(1);
    expect(omikujiReward({ omikujiBase: 0 }, f('大吉'))).toBe(0);
    expect(omikujiRange({ omikujiBase: 10 })).toBe('5〜30');
  });

  it('1 日 1 回（日本時間の 0 時に引き直せる）。花びらが増える', async () => {
    const economy = { ...cfg.economy, omikujiBase: 10 };
    const r1 = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T14:00:00Z'), seq(0, 0.5)); // 日本時間 23:00
    expect(r1.status).toBe('drawn');
    if (r1.status !== 'drawn') return;
    expect(r1.fortune.name).toBe('大吉');
    expect(r1.amount).toBe(30);
    expect(r1.balance).toBe(30);
    expect(r1.sayings).toHaveLength(4);

    const again = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T14:59:00Z'), seq(0.999));
    expect(again).toEqual({ status: 'already', fortune: r1.fortune, streak: 1 });

    const next = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T15:00:00Z'), seq(0.5)); // 日本時間 0:00
    expect(next.status).toBe('drawn');
    expect((await walletOf(db, 'A')).balance).toBe(30 + 10);
  });

  it('同時に何回押しても 1 回だけ', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'))));
    expect(rs.filter((r) => r.status === 'drawn')).toHaveLength(1);
  });

  it('連続日数: 1 日も空けずに引いた日数（今日まだなら昨日まで）', () => {
    expect(streakOf([], '2026-10-01')).toBe(0);
    expect(streakOf(['2026-10-01', '2026-09-30', '2026-09-29', '2026-09-27'], '2026-10-01')).toBe(3);
    expect(streakOf(['2026-09-30', '2026-09-29'], '2026-10-01')).toBe(2);
    expect(streakOf(['2026-09-29'], '2026-10-01')).toBe(0);
    // 月・年をまたぐ
    expect(streakOf(['2027-01-01', '2026-12-31', '2026-12-30'], '2027-01-01')).toBe(3);
    const sc = { rewards: [{ days: 7, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1 }, { days: 30, repeat: false, coins: 300, ticket: 'none' as const, tickets: 0 }] };
    expect(nextStreakReward(sc, 6)).toMatchObject({ left: 1, reward: { days: 7 } });
    expect(nextStreakReward(sc, 29)).toMatchObject({ left: 1, reward: { days: 30 } });
    expect(nextStreakReward(sc, 30)).toMatchObject({ left: 5, reward: { days: 7 } });
    expect(describeStreakRewards(sc, cfg.economy)).toBe('7 日ごとに 🪙銭 50・🎁物御籤の無料券 ×1／30 日目に 🪙銭 300');
    expect(describeStreakRewards({ rewards: [] }, cfg.economy)).toBe('なし');
  });

  it('続けた日のおまけ（7 日ごと・30 日目だけ）。1 日空けると 1 日目から。もう 1 回の分は数えない', async () => {
    const economy = { ...cfg.economy, omikujiBase: 10 };
    const streak = { rewards: [{ days: 3, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1 }, { days: 6, repeat: false, coins: 0, ticket: 'none' as const, tickets: 0, roleId: '980000000000000060' }] };
    // 日本時間の正午
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 3));
    const got: { streak: number; bonus: number[] }[] = [];
    for (const d of [1, 2, 3, 4, 5, 6, 8, 9]) {
      const r = await drawOmikuji(db, economy, 'A', day(d), seq(0.5), { streak });
      if (r.status !== 'drawn') throw new Error('not drawn');
      got.push({ streak: r.streak, bonus: r.bonus.map((b) => b.days) });
      if (d === 3) {
        const extra = await drawOmikuji(db, economy, 'A', day(d), seq(0.5), { extra: true, streak });
        expect(extra).toMatchObject({ status: 'drawn', streak: 0, bonus: [] });
      }
    }
    expect(got).toEqual([
      { streak: 1, bonus: [] },
      { streak: 2, bonus: [] },
      { streak: 3, bonus: [3] },
      { streak: 4, bonus: [] },
      { streak: 5, bonus: [] },
      { streak: 6, bonus: [3, 6] },
      { streak: 1, bonus: [] },
      { streak: 2, bonus: [] },
    ]);
    expect((await ticketsOf(db, 'A')).gacha_free).toBe(2);
    // 9 回（もう 1 回も入れて）× 10 ＋ おまけ 50 × 2
    expect((await walletOf(db, 'A')).balance).toBe(9 * 10 + 100);
    expect(await drawOmikuji(db, economy, 'A', day(9), seq(0.5), { streak })).toMatchObject({ status: 'already', streak: 2 });
    // カード
    const sc = { rewards: [{ days: 7, repeat: true, coins: 50, ticket: 'gacha_free' as const, tickets: 1, roleId: '980000000000000060' }] };
    const r = await drawOmikuji(db, economy, 'B', day(1), seq(0.5), { streak: sc });
    if (r.status !== 'drawn') throw new Error('not drawn');
    const e = omikujiEmbed({ ...r, streak: 7, bonus: sc.rewards }, 'さくら', economy, sc);
    expect(e.description).toContain('🔥 連続 **7** 日目 ・ あと 7 日で 7 日のおまけ');
    expect(e.description).toContain('🎁 **7 日続いたおまけ**: 🪙銭 50・🎁物御籤の無料券 ×1・<@&980000000000000060>');
  });

  it('通話に入っているときだけ引ける（AFK・数えない通話は入っていないのと同じ。設定で切れる）', () => {
    const economy = { ...cfg.economy, omikujiVoiceOnly: true, excludedVoiceChannelIds: ['900000000000000003'] };
    const m = (channelId: string | null) => ({ voice: { channelId }, guild: { afkChannelId: '900000000000000002' } }) as never;
    expect(cfg.economy.omikujiVoiceOnly).toBe(true);
    expect(omikujiVoiceBlock(economy, m('900000000000000001'))).toBeUndefined();
    expect(omikujiVoiceBlock(economy, m(null))).toContain('通話に入っているときだけ');
    expect(omikujiVoiceBlock(economy, m('900000000000000002'))).toBeDefined();
    expect(omikujiVoiceBlock(economy, m('900000000000000003'))).toBeDefined();
    expect(omikujiVoiceBlock({ ...economy, omikujiVoiceOnly: false }, m(null))).toBeUndefined();
  });

  it('カード: 運勢・一言・もらった花びら', async () => {
    const r = await drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'), seq(0, 0));
    if (r.status !== 'drawn') throw new Error('not drawn');
    const e = omikujiEmbed(r, 'さくら', cfg.economy);
    expect(e.title).toBe('⛩ おみくじ ― 大吉');
    expect(e.description).toContain('**さくら** さんの運勢');
    expect(e.description).toContain('📞 待ち人 … 通話で来る');
    expect(e.description).toContain('🪙銭 **+30**（いま 30 枚）');
  });
});
