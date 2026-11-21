import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { lazyStaticAsset, StaticAssetCache } from '../src/web/staticAssetCache.js';

it('登録しただけでは素材を読まず、ハッシュと配信内容に同じ読み込みを使う', () => {
  const cache = new StaticAssetCache(8);
  const bytes = new Uint8Array([1, 2, 3]);
  const load = vi.fn(() => bytes);
  const asset = lazyStaticAsset(cache, 'one', 'image/webp', load);
  expect(asset.type).toBe('image/webp');
  expect(load).not.toHaveBeenCalled();
  expect(cache.byteLength).toBe(0);
  expect(asset.version).toBe(createHash('sha256').update(bytes).digest('hex').slice(0, 10));
  expect(asset.body).toBe(bytes);
  expect(load).toHaveBeenCalledOnce();
});

it('よく使う素材を残し、合計サイズが上限を超える前に古いものを外す', () => {
  const cache = new StaticAssetCache(6);
  const a = vi.fn(() => new Uint8Array([1, 1, 1]));
  const b = vi.fn(() => new Uint8Array([2, 2, 2]));
  const c = vi.fn(() => new Uint8Array([3, 3, 3]));
  cache.read('a', a);
  cache.read('b', b);
  cache.read('a', a);
  cache.read('c', c);
  expect(cache.byteLength).toBe(6);
  cache.read('a', a);
  expect(a).toHaveBeenCalledOnce();
  cache.read('b', b);
  expect(b).toHaveBeenCalledTimes(2);
  expect(cache.byteLength).toBe(6);
  expect(cache.size).toBe(2);
});

it('上限より大きい素材は保持せず、読み込み失敗も記憶しない', () => {
  const cache = new StaticAssetCache(2);
  const asset = lazyStaticAsset(cache, 'large', 'video/mp4', () => new Uint8Array([1, 2, 3]));
  expect(asset.body).toEqual(new Uint8Array([1, 2, 3]));
  expect(cache.byteLength).toBe(0);
  const load = vi.fn<() => Uint8Array<ArrayBuffer>>()
    .mockImplementationOnce(() => { throw new Error('read failed'); })
    .mockReturnValue(new Uint8Array([4]));
  const retry = lazyStaticAsset(cache, 'retry', 'image/webp', load);
  expect(() => retry.body).toThrow('read failed');
  expect(retry.body).toEqual(new Uint8Array([4]));
});

it('追い出した画像を読み直しても、内容・URL用のハッシュを維持する', () => {
  const cache = new StaticAssetCache(3);
  const bytes = new Uint8Array([7, 8, 9]);
  const load = vi.fn(() => bytes.slice());
  const asset = lazyStaticAsset(cache, 'a', 'image/webp', load);
  const version = asset.version;
  cache.read('other', () => new Uint8Array([1, 2, 3]));
  expect(asset.version).toBe(version);
  expect(load).toHaveBeenCalledOnce();
  expect(asset.body).toEqual(bytes);
  expect(load).toHaveBeenCalledTimes(2);
  expect(asset.version).toBe(createHash('sha256').update(asset.body).digest('hex').slice(0, 10));
});
