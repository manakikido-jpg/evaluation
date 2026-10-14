import { expect, it } from 'vitest';
import { STATIC } from '../src/web/assets.js';
import { cards } from '../src/services/shinpu/engine.js';
import { ShinpuTestPage } from '../src/web/views/shinpu.js';

it('すべての実装札に表示できる別々のWebP画像がある', () => {
  const versions = new Set<string>();
  for (const card of cards) {
    const asset = STATIC[`shinpu-card-${card.id}.webp`];
    expect(asset?.type).toBe('image/webp');
    const bytes = Buffer.from(asset!.body);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
    expect(bytes.length).toBeGreaterThan(1000);
    versions.add(asset!.version);
  }
  expect(versions.size).toBe(cards.length);
});
it('背景と肖像の更新がCSSの画像URLにも反映される', () => {
  const css = String(STATIC['shinpu.css']!.body);
  for (const key of ['background', 'avatars']) {
    const name = `shinpu-${key}.webp`;
    expect(STATIC[name]?.type).toBe('image/webp');
    expect(css).toContain(`/static/${name}?v=${STATIC[name]!.version}`);
  }
});
it('画像の対応表と選択プレビューをCSPに対応したHTMLに出す', async () => {
  const page = await ShinpuTestPage({ csrf: 'test-csrf', name: 'ais' });
  const text = String(page);
  for (const card of cards) expect(text).toContain(`shinpu-card-${card.id}.webp?v=`);
  expect(text).toContain('id="selected-cards"');
  expect(text).toContain('id="clear-selection"');
  expect(text).toContain('id="deadline"');
  expect(text).not.toMatch(/<script>\s*\S|onclick=|style=/);
});
