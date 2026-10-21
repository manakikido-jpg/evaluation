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
