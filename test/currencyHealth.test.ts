import { describe, expect, it } from 'vitest';
import { currencyHealth } from '../src/services/currencyHealth.js';
import type { Distribution, EconomyOverview } from '../src/services/economyStats.js';
import { cfg } from './helpers.js';

const ov = (x: Partial<EconomyOverview>): EconomyOverview =>
  ({ supply: 100_000, issued: 10_000, income: 9_000, admin: 0, net: 1_000, giftVolume: 0, marketVolume: 0, issueLines: [], incomeLines: [], adminLines: [], buckets: [], ...x }) as EconomyOverview;
const dist = (x: Partial<Distribution>): Distribution => ({ holders: 50, total: 100_000, average: 2_000, median: 1_500, top10Share: 0.3, gini: 0.3, top: [], bands: [], ...x });
const level = (h: ReturnType<typeof currencyHealth>, key: string) => h.checks.find((c) => c.key === key)?.level;

describe('🩺 通貨の健康診断', () => {
  it('つり合っていれば ok', () => {
    const h = currencyHealth(ov({}), dist({}), cfg);
    expect(h.level).toBe('ok');
    expect(h.checks.map((c) => c.key)).toEqual(['return', 'growth', 'spread', 'casino']);
  });

  it('戻りが少ない・急にふえる・かたよる・高い設定の台は注意', () => {
    const h = currencyHealth(ov({ income: 3_000, net: 40_000, supply: 140_000 }), dist({ top10Share: 0.8 }), {
      ...cfg,
      casino: { ...cfg.casino, slotMachines: [6, 5, 'random'], atMachines: [4] },
    });
    expect(level(h, 'return')).toBe('bad');
    expect(level(h, 'growth')).toBe('bad');
    expect(level(h, 'spread')).toBe('bad');
    expect(level(h, 'casino')).toBe('bad');
    expect(h.level).toBe('bad');
    // 使われすぎ（へりすぎ）は注意
    expect(level(currencyHealth(ov({ income: 15_000 }), dist({}), cfg), 'return')).toBe('warn');
  });

  it('数字が足りないときは、その項目を出さない', () => {
    const h = currencyHealth(ov({ issued: 0, supply: 0, net: 0 }), dist({ holders: 3 }), cfg);
    expect(h.checks.map((c) => c.key)).toEqual(['casino']);
  });
});
