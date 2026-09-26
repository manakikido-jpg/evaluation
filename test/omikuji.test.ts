import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { omikujiEmbed } from '../src/discord/omikuji.js';
import { walletOf } from '../src/services/economy.js';
import { drawFortune, drawOmikuji, FORTUNES, omikujiRange, omikujiReward } from '../src/services/omikuji.js';
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
    expect(again).toEqual({ status: 'already', fortune: r1.fortune });

    const next = await drawOmikuji(db, economy, 'A', new Date('2026-09-26T15:00:00Z'), seq(0.5)); // 日本時間 0:00
    expect(next.status).toBe('drawn');
    expect((await walletOf(db, 'A')).balance).toBe(30 + 10);
  });

  it('同時に何回押しても 1 回だけ', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'))));
    expect(rs.filter((r) => r.status === 'drawn')).toHaveLength(1);
  });

  it('カード: 運勢・一言・もらった花びら', async () => {
    const r = await drawOmikuji(db, cfg.economy, 'A', new Date('2026-09-26T00:00:00Z'), seq(0, 0));
    if (r.status !== 'drawn') throw new Error('not drawn');
    const e = omikujiEmbed(r, 'さくら', cfg.economy);
    expect(e.title).toBe('⛩ おみくじ ― 大吉');
    expect(e.description).toContain('**さくら** さんの運勢');
    expect(e.description).toContain('📞 待ち人 … 通話で来る');
    expect(e.description).toContain('🌸花びら **+30**（いま 30 枚）');
  });
});
