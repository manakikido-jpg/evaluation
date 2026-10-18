import type { GuildConfig } from '../config.js';
import type { Distribution, EconomyOverview } from './economyStats.js';

/**
 * 🩺 通貨の健康診断。経済のページの数字から、銭がふえすぎ・へりすぎ・かたよりすぎを見る（計算だけ）。
 * 目安の線は、ほかのサーバーの経済でよく使われる考え方から決めた（決まりではない）。
 */

export type HealthLevel = 'ok' | 'warn' | 'bad' | 'none';
/** meter: <meter> の目盛り（low〜high が よい所、optimum がいちばんよい所） */
export type HealthMeter = { value: number; min: number; max: number; low: number; high: number; optimum: number; scale: string };
export type HealthCheck = { key: string; label: string; level: HealthLevel; value: string; advice: string; goal: string; meter?: HealthMeter };
export type CurrencyHealth = { level: HealthLevel; summary: string; checks: HealthCheck[] };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const worst = (ls: HealthLevel[]): HealthLevel => (ls.includes('bad') ? 'bad' : ls.includes('warn') ? 'warn' : ls.includes('ok') ? 'ok' : 'none');
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const NO_DATA = 'まだ数字が足りません。';

export function currencyHealth(o: EconomyOverview, d: Distribution, cfg: GuildConfig): CurrencyHealth {
  const coin = cfg.economy.currencyName;
  const checks: HealthCheck[] = [];

  // 1. 戻り率: 配った量のうち、使われて鯖に戻った割合
  if (o.issued > 0) {
    const r = o.income / o.issued;
    checks.push({
      key: 'return',
      label: '配った量のうち、使われて戻った割合',
      level: r < 0.5 ? 'bad' : r < 0.8 || r > 1.3 ? 'warn' : 'ok',
      value: pct(r),
      goal: '80〜130%',
      meter: { value: clamp(r, 0, 2), min: 0, max: 2, low: 0.8, high: 1.3, optimum: 1, scale: '0% 〜 200%' },
      advice:
        r < 0.8
          ? `戻りが少なく、${coin}がふえています。授与品・物御籤の値段を上げる、楽しい使い道（色のロール・季節の品）を足す、配る量を少し下げる、などを考えてください。`
          : r > 1.3
            ? `配るより使われるほうが多く、${coin}がへっています。値段を下げる、イベントで配る、などを考えてください。`
            : 'ちょうどよいつり合いです。',
    });
  } else checks.push({ key: 'return', label: '配った量のうち、使われて戻った割合', level: 'none', value: '—', goal: '80〜130%', advice: `この期間は、まだ${coin}を配っていません。` });

  // 2. 出回る量の増え方（期間のはじめと比べて）
  const before = o.supply - o.net;
  if (before > 0) {
    const g = o.net / before;
    checks.push({
      key: 'growth',
      label: `出回っている${coin}の増え方（この期間）`,
      level: g > 0.3 ? 'bad' : g > 0.1 || g < -0.2 ? 'warn' : 'ok',
      value: `${g >= 0 ? '+' : ''}${pct(g)}`,
      goal: '−20%〜+10%',
      meter: { value: clamp(g, -0.5, 0.5), min: -0.5, max: 0.5, low: -0.2, high: 0.1, optimum: 0, scale: '−50% 〜 +50%' },
      advice: g > 0.1 ? '急にふえています。人がふえたときは自然ですが、そうでなければ「戻った割合」を見てください。' : g < -0.2 ? '急にへっています。遊べない人が出ていないか見てください。' : 'おだやかです。',
    });
  } else checks.push({ key: 'growth', label: `出回っている${coin}の増え方（この期間）`, level: 'none', value: '—', goal: '−20%〜+10%', advice: NO_DATA });

  // 3. かたより: 上位 1 割の人が持っている割合
  if (d.holders >= 10) {
    checks.push({
      key: 'spread',
      label: '上位 1 割の人が持っている割合',
      level: d.top10Share > 0.7 ? 'bad' : d.top10Share > 0.5 ? 'warn' : 'ok',
      value: pct(d.top10Share),
      goal: '50% まで',
      meter: { value: d.top10Share, min: 0, max: 1, low: 0.1, high: 0.5, optimum: 0.3, scale: '0% 〜 100%' },
      advice:
        d.top10Share > 0.5
          ? `一部の人に${coin}が集まっています。お賽銭（持ちすぎた分を少し納める）をオンにする、高い品を足す、などを考えてください。`
          : 'みんなに行き渡っています。',
    });
  } else checks.push({ key: 'spread', label: '上位 1 割の人が持っている割合', level: 'none', value: '—', goal: '50% まで', advice: `${coin}を持っている人が 10 人より少ないので、まだ見ません。` });

  // 4. カジノ: 払い戻しが 100% をこえる設定（4 以上）に決めてある台
  const high = [...cfg.casino.slotMachines, ...cfg.casino.atMachines].filter((m) => m !== 'random' && m >= 4).length;
  checks.push({
    key: 'casino',
    label: '払い戻しが 100% をこえる設定（4〜6）に決めた台',
    level: high > 2 ? 'bad' : high > 0 ? 'warn' : 'ok',
    value: `${high} 台`,
    goal: '0 台',
    meter: { value: Math.min(high, 6), min: 0, max: 6, low: 0, high: 0.5, optimum: 0, scale: '0 〜 6 台' },
    advice: high > 0 ? `設定 4〜6 の台は、遊ぶほど${coin}がふえます。1〜2 台までにするか、「おまかせ」にしてください。` : '決めた台はありません（おまかせは、低い設定が多めに出ます）。',
  });

  const level = worst(checks.map((c) => c.level));
  const summary = level === 'none' ? 'まだ数字が足りません。' : level === 'ok' ? 'いまは、ちょうどよい状態です。' : level === 'warn' ? '少し気をつけたい所があります。' : 'すぐに見直したい所があります。';
  return { level, summary, checks };
}
