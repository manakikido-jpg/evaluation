import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('保管した100枚が一覧と一致し、原画に欠落や破損がない', () => {
  const base = new URL('../assets/shinpu-cards/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  expect(manifest.totalPlanned).toBe(237);
  expect(manifest.complete).toBe(100);
  expect(manifest.percent).toBe(42.2);
  expect(manifest.cards).toHaveLength(manifest.complete);
  expect(new Set(manifest.cards.map((c: { id: string }) => c.id)).size).toBe(100);
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

it('保存素材100点すべてに完成カードがあり、比較用原画と区別できる', () => {
  const base = new URL('../assets/shinpu-cards/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base), 'utf8'));
  const layout = JSON.parse(readFileSync(new URL('layout-progress.json', base), 'utf8'));
  expect(manifest.cardComplete).toBe(100);
  expect(manifest.cardPercent).toBe(42.2);
  expect(layout.cards.filter((c: { layout_status: string }) => c.layout_status === 'complete')).toHaveLength(100);
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
