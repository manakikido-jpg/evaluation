import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import sharp from 'sharp';

it('保管した237枚が一覧と一致し、原画に欠落や破損がない', () => {
  const base = new URL('../assets/shinpu-cards/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  expect(manifest.totalPlanned).toBe(237);
  expect(manifest.complete).toBe(237);
  expect(manifest.percent).toBe(100);
  expect(manifest.cards).toHaveLength(manifest.complete);
  expect(manifest.cards.map((c: { id: string }) => c.id).sort()).toEqual(Array.from({ length: 237 }, (_, i) => `SK-${String(i + 1).padStart(3, '0')}`));
  expect(new Set(manifest.cards.map((c: { id: string }) => c.id)).size).toBe(237);
  const listed: string[] = [];
  for (const card of manifest.cards) {
    expect(card.id).toMatch(/^SK-\d{3}$/);
    expect(card.file).toBe(`originals/${card.id}.png`);
    const bytes = readFileSync(new URL(card.file, base));
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBe(card.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(card.sha256);
    listed.push(`${card.id}.png`);
  }
  expect(readdirSync(new URL('originals/', base)).sort()).toEqual(listed.sort());
});

it('保存素材237点すべてに完成カードがあり、比較用原画と区別できる', () => {
  const base = new URL('../assets/shinpu-cards/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  const layout = JSON.parse(readFileSync(new URL('layout-progress.json', base), 'utf8'));
  expect(manifest.cardComplete).toBe(237);
  expect(manifest.cardPercent).toBe(100);
  expect(layout.cards.filter((c: { layout_status: string }) => c.layout_status === 'complete')).toHaveLength(237);
  expect(layout.cards.filter((c: { layout_status: string }) => c.layout_status === 'illustration_only')).toHaveLength(0);
  const listed: string[] = [];
  for (const card of manifest.cards) {
    expect(card.layoutStatus).toBe('complete');
    expect(card.cardFile).toBe(`cards/${card.id}.png`);
    const bytes = readFileSync(new URL(card.cardFile, base));
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBe(card.cardBytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(card.cardSha256);
    listed.push(`${card.id}.png`);
  }
  expect(readdirSync(new URL('cards/', base)).filter(f => f.endsWith('.png')).sort()).toEqual(listed.sort());
  expect(manifest.cards.filter((c: { stackable: boolean }) => c.stackable).map((c: { id: string }) => c.id)).toEqual(['SK-038']);
});


it('全完成カードに読める大きさの軽量版と一覧用画像があり、原画を保持する', async () => {
  const base = new URL('../assets/shinpu-cards/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  let pngTotal = 0, webTotal = 0, thumbTotal = 0;
  for (const card of manifest.cards) {
    for (const [fileKey, bytesKey, hashKey, width] of [
      ['webFile', 'webBytes', 'webSha256', 900],
      ['thumbnailFile', 'thumbnailBytes', 'thumbnailSha256', 360],
    ] as const) {
      const bytes = readFileSync(new URL(card[fileKey], base));
      expect(bytes.length).toBe(card[bytesKey]);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(card[hashKey]);
      const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBe(width);
      expect(decoded.info.height).toBe(Math.round(width * 4 / 3));
      expect(bytes.length).toBeLessThan(card.cardBytes);
    }
    expect(card.thumbnailBytes).toBeLessThan(card.webBytes);
    pngTotal += card.cardBytes; webTotal += card.webBytes; thumbTotal += card.thumbnailBytes;
  }
  expect(manifest.optimization.png_bytes).toBe(pngTotal);
  expect(manifest.optimization.web_bytes).toBe(webTotal);
  expect(manifest.optimization.thumbnail_bytes).toBe(thumbTotal);
  expect(webTotal).toBeLessThan(pngTotal * 0.15);
  const ids = manifest.cards.map((c: { id: string }) => `${c.id}.webp`).sort();
  expect(readdirSync(new URL('cards-web/', base)).sort()).toEqual(ids);
  expect(readdirSync(new URL('thumbnails/', base)).sort()).toEqual(ids);
  const gallery = readFileSync(new URL('gallery.html', base), 'utf8');
  expect(gallery.match(/<figure>/g)).toHaveLength(manifest.complete);
  expect(gallery.match(/loading="lazy"/g)).toHaveLength(manifest.complete);
  expect(gallery).not.toMatch(/src="(?:cards|originals)\//);
}, 30000);
