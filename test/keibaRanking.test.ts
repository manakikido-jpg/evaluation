import { expect, it } from 'vitest';
import { KeibaRanking } from '../src/web/views/keiba.js';
import { makeRace } from '../src/services/casino/keiba.js';

const { horses } = makeRace((n) => Math.floor(n / 2), 1, { dist: 2000 });

it('受付中と発走前は順位ではなく馬番を示す', () => {
  for (const phase of ['betting', 'racing'] as const) {
    const html = String(KeibaRanking({ s: { phase, horses }, mine: [] }));
    expect(html).toContain(phase === 'betting' ? '出走馬' : '発走前');
    expect(html).not.toMatch(/\d位/);
    expect(html.match(/class="kb-rank-name"/g)).toHaveLength(horses.length);
  }
});

it('購入した馬を複数とも強調し、馬名はHTMLとして実行させない', () => {
  const field = horses.map((h) => ({ ...h, name: h.no === 1 ? '<img src=x onerror=alert(1)>' : h.name }));
  const html = String(KeibaRanking({ s: { phase: 'betting', horses: field }, mine: [1, 3] }));
  expect(html.match(/class="kb-mine-rank"/g)).toHaveLength(2);
  expect(html).toContain('馬番1');
  expect(html).toContain('購入した馬');
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img');
});

it('ゴール後は到達順を示し、確定演出前に確定と表示しない', () => {
  const order = [...horses].reverse().map((h) => h.no);
  const html = String(KeibaRanking({ s: { phase: 'result', horses, run: { order } }, mine: [order[0]!] }));
  expect(html).toContain('到達順位');
  expect(html).not.toContain('確定着順');
  expect(html.indexOf(`馬番${order[0]}`)).toBeLessThan(html.indexOf(`馬番${order[1]}`));
  expect(html).toContain('1位');
});
