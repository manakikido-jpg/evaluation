import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { catalog, catalogCategories, catalogElements, findCatalogCards } from '../src/services/shinpu/catalog.js';
import { STATIC } from '../src/web/assets.js';
import { ShinpuCatalogPage } from '../src/web/views/shinpuCatalog.js';

it('237枚の仕様と2種類の軽量画像が保管先のSHA256に一致する', () => {
  expect(catalog.map(c => c.id)).toEqual(Array.from({ length: 237 }, (_, i) => `SK-${String(i + 1).padStart(3, '0')}`));
  expect(catalogCategories.map(category => catalog.filter(c => c.category === category).length)).toEqual([107, 78, 30, 19, 3]);
  for (const card of catalog) {
    expect(catalogElements).toContain(card.element);
    for (const [size, sha] of [['cards', card.webSha256], ['thumbnails', card.thumbnailSha256]]) {
      const asset = STATIC[`shinpu-catalog-${size}-${card.id}.webp`];
      expect(asset?.type).toBe('image/webp');
      const bytes = Buffer.from(asset!.body);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
    }
  }
  expect(catalog.filter(c => c.stackable).map(c => c.id)).toEqual(['SK-038']);
});
it('名前・全角ID・複数の検索語・種類・属性を合わせて探せる', () => {
  expect(findCatalogCards('ＳＫ－０３８')[0]?.name).toBe('紫電の短刀');
  expect(findCatalogCards('潮音 槍', '武器', '水').map(c => c.id)).toEqual(['SK-017', 'SK-024']);
  expect(findCatalogCards('潮音', '防具', '火')).toEqual([]);
});
it('一覧は24枚ずつ遅延読み込みし、拡大時だけ通常画像を出す', async () => {
  const first = String(await ShinpuCatalogPage({}));
  expect(first.match(/<img /g)).toHaveLength(24);
  expect(first).toContain('loading="lazy"');
  expect(first).not.toContain('shinpu-catalog-cards-SK-');
  expect(first).toContain('237／237枚（100.0％）');
  const last = String(await ShinpuCatalogPage({ page: 999 }));
  expect(last.match(/<img /g)).toHaveLength(21);
  expect(last).toContain('SK-237');
  const detail = String(await ShinpuCatalogPage({ card: catalog[37] }));
  expect(detail).toContain('shinpu-catalog-cards-SK-038.webp?v=');
  expect(detail).toContain('紫電の短刀');
  const evil = String(await ShinpuCatalogPage({ query: '\"><script>alert(1)</script>' }));
  expect(evil).not.toContain('<script>');
  expect(first + detail).not.toMatch(/onclick=|style=|<script>/);
});
