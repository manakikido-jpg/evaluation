import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PAGE_HINTS } from '../src/web/pageHints.js';
import { STATIC } from '../src/web/assets.js';

it('❓ 左のメニューにあるページは、全部「このページの使い方」がある（3〜5 行・やさしい長さ）', () => {
  const layout = readFileSync(new URL('../src/web/views/layout.tsx', import.meta.url), 'utf8');
  const keys = [...new Set([...layout.matchAll(/\{ key: '([a-z]+)', href: '/g)].map((m) => m[1]!))];
  expect(keys.length).toBeGreaterThan(40);
  const missing = keys.filter((k) => !PAGE_HINTS[k]?.length);
  expect(missing).toEqual([]);
  for (const [key, steps] of Object.entries(PAGE_HINTS)) {
    expect(steps.length, key).toBeLessThanOrEqual(5);
    for (const s of steps) expect(s.length, `${key}: ${s}`).toBeLessThanOrEqual(120);
  }
});

it('💡 ヒントを出す・隠す JS は登録され、インラインのスクリプトを使わない', () => {
  const js = STATIC['page-hints.js']!;
  expect(js.type).toContain('javascript');
  expect(String(js.body)).toContain('data-hints-toggle');
  expect(String(js.body)).toContain('localStorage');
});
