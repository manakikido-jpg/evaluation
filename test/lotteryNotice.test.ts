import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fortuneGamesSchema } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { buyLottery, ensureLotteryRound, settleLotteries } from '../src/services/casino/fortune.js';
import { setLotteryChannel } from '../src/services/casino/lotteryNotice.js';
import { addCoins } from '../src/services/economy.js';
import { LotteryApp, lotteryPanel } from '../src/discord/lottery.js';
import { cfg, makeDb } from './helpers.js';

const A = '760000000000000011', B = '760000000000000012', CH = '910000000000000099';
const games = fortuneGamesSchema.parse({ enabled: true });

describe('🎫 週末宝くじの結果のお知らせ', () => {
  let db: Db;
  let close: () => Promise<void>;
  let now: Date;
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    now = new Date('2026-10-17T03:00:00Z');
    await addCoins(db, A, 10000, 'admin_grant');
    await addCoins(db, B, 10000, 'admin_grant');
  });
  afterEach(async () => close());

  it('パネルに入口のボタン', () => {
    expect(JSON.stringify(lotteryPanel())).toContain('lottery:enter');
    expect(JSON.stringify(lotteryPanel())).toContain('日曜 21 時');
  });

  it('抽選のあと、買った人みんなに当たり・はずれを DM。当選者は売り場に出す。二度は送らない', async () => {
    const round = (await ensureLotteryRound(db, games, now))!;
    await buyLottery(db, A, randomUUID(), round.id, games, () => now);
    await buyLottery(db, B, randomUUID(), round.id, games, () => now);
    await buyLottery(db, B, randomUUID(), round.id, games, () => now);
    await setLotteryChannel(db, CH, 'staff');
    const sendDm = vi.fn(async (_id: string, _text: string) => true);
    const sendMessage = vi.fn(async (_ch: string, _b: unknown) => ({ id: 'm' }));
    const app = new LotteryApp(db, () => cfg, { sendDm, sendMessage } as never, 'https://x.example');
    // 抽選の前は何も送らない
    expect(await app.notify(now)).toBe(0);
    await settleLotteries(db, round.drawAt, () => 0); // 1 番（A）が当たり
    const sent = await Promise.all([app.notify(round.drawAt), app.notify(round.drawAt)]);
    expect(sent[0]! + sent[1]!).toBe(2);
    const dm = new Map(sendDm.mock.calls.map(([id, text]) => [id, text]));
    expect(dm.get(A)).toContain('当たりました');
    expect(dm.get(A)).toContain('1 番');
    expect(dm.get(B)).toContain('はずれでした');
    expect(dm.get(B)).toContain('2 番・3 番');
    expect(sendMessage).toHaveBeenCalledOnce();
    const [ch, body] = sendMessage.mock.calls[0]! as [string, { content: string; allowed_mentions: unknown }];
    expect(ch).toBe(CH);
    expect(body.content).toContain(`<@${A}>`);
    expect(body.allowed_mentions).toEqual({ parse: [], users: [A] });
  });
});

describe('🏆 週末宝くじの等（1等・2等…）', () => {
  let db: Db;
  let close: () => Promise<void>;
  const now = new Date('2026-10-17T03:00:00Z');
  beforeEach(async () => {
    ({ db, close } = await makeDb());
    await addCoins(db, A, 10000, 'admin_grant');
    await addCoins(db, B, 10000, 'admin_grant');
  });
  afterEach(async () => close());

  it('賞金を等ごとの割合で分けて、ちがう券に当てる。DM と売り場に等ごとに出す', async () => {
    const { tierPrizes } = await import('../src/services/casino/fortune.js');
    const { fortuneRounds } = await import('../src/db/schema.js');
    const { walletOf } = await import('../src/services/economy.js');
    const tiers = fortuneGamesSchema.parse({ enabled: true, lotteryPrice: 100, lotteryReturnPct: 50, lotteryBonus: 1000, lotteryTiers: [{ name: '1等', count: 1, pct: 60 }, { name: '2等', count: 2, pct: 30 }] });
    const round = (await ensureLotteryRound(db, tiers, now))!;
    expect(round.tiers).toEqual(tiers.lotteryTiers);
    for (const who of [A, B, B, B]) await buyLottery(db, who, randomUUID(), round.id, tiers, () => now);
    // 売上 400 の 50％ ＋ 1000 = 1200 → 1等 720・2等 1本 180
    const [r0] = await db.select().from(fortuneRounds);
    expect(tierPrizes(r0!).map((t) => t.each)).toEqual([720, 180]);
    // 1等は 1 番（A）、2等は残りの先頭から 2 本（2 番・3 番 = B）
    await settleLotteries(db, round.drawAt, () => 0);
    const [r] = await db.select().from(fortuneRounds);
    expect(r!.winners).toEqual([
      { tier: '1等', number: 1, memberId: A, payout: 720 },
      { tier: '2等', number: 2, memberId: B, payout: 180 },
      { tier: '2等', number: 3, memberId: B, payout: 180 },
    ]);
    expect(r!.payout).toBe(1080);
    expect((await walletOf(db, A)).balance).toBe(10000 - 100 + 720);
    expect((await walletOf(db, B)).balance).toBe(10000 - 300 + 360);
    const sendDm = vi.fn(async (_id: string, _t: string) => true);
    const sendMessage = vi.fn(async (_c: string, _b: unknown) => ({ id: 'm' }));
    await setLotteryChannel(db, CH, 'staff');
    await new LotteryApp(db, () => cfg, { sendDm, sendMessage } as never, 'https://x.example').notify(round.drawAt);
    const dm = new Map(sendDm.mock.calls.map(([id, t]) => [id, t]));
    expect(dm.get(B)).toContain('2等（2 番）');
    expect(dm.get(B)).toContain('360 枚');
    const post = (sendMessage.mock.calls[0]![1] as { content: string; allowed_mentions: { users: string[] } });
    expect(post.content).toContain('1等 **1 番**');
    expect(post.content).toContain('2等 **3 番**');
    expect(post.allowed_mentions.users.sort()).toEqual([A, B].sort());
  });

  it('券が当たりの本数より少ないときは、出ない等がある', async () => {
    const tiers = fortuneGamesSchema.parse({ enabled: true, lotteryTiers: [{ name: '1等', count: 1, pct: 50 }, { name: '2等', count: 5, pct: 50 }] });
    const round = (await ensureLotteryRound(db, tiers, now))!;
    await buyLottery(db, A, randomUUID(), round.id, tiers, () => now);
    await buyLottery(db, B, randomUUID(), round.id, tiers, () => now);
    await settleLotteries(db, round.drawAt, () => 0);
    const { fortuneRounds } = await import('../src/db/schema.js');
    const [r] = await db.select().from(fortuneRounds);
    expect(r!.winners!.map((w) => w.tier)).toEqual(['1等', '2等']);
  });

  it('割合の合計は 100％ まで', () => {
    expect(fortuneGamesSchema.safeParse({ lotteryTiers: [{ name: '1等', count: 1, pct: 70 }, { name: '2等', count: 1, pct: 40 }] }).success).toBe(false);
    expect(fortuneGamesSchema.parse({}).lotteryTiers).toEqual([{ name: '1等', count: 1, pct: 100 }]);
  });
});
