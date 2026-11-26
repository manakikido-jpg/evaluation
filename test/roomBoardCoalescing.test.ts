import { afterEach, expect, it, vi } from 'vitest';
import type { Db } from '../src/db/client.js';
import { RoomBoardApp } from '../src/discord/roomBoard.js';
import { logger } from '../src/lib/logger.js';
import { cfg } from './helpers.js';

afterEach(() => vi.restoreAllMocks());
const makeApp = () => new RoomBoardApp({} as Db, () => cfg, async () => true);

it('更新中の20回の依頼を1回にまとめ、最後の部屋の状態まで反映する', async () => {
  const app = makeApp();
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  let state = 0;
  const snapshots: number[] = [];
  const refresh = vi.spyOn(app as unknown as { refresh(): Promise<void> }, 'refresh').mockImplementation(async () => {
    snapshots.push(state);
    if (snapshots.length === 1) { started(); await hold; }
  });
  const first = app.refreshNow();
  await firstStarted;
  const requests: Promise<void>[] = [];
  for (let n = 1; n <= 20; n++) { state = n; requests.push(app.refreshNow()); }
  release();
  await Promise.all([first, ...requests]);
  expect(snapshots).toEqual([0, 20]);
  expect(refresh).toHaveBeenCalledTimes(2);
  state = 21;
  await app.refreshNow();
  expect(snapshots).toEqual([0, 20, 21]);
});

it('更新に失敗しても次の依頼を受け付け、待ち状態のままにしない', async () => {
  const app = makeApp();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const refresh = vi.spyOn(app as unknown as { refresh(): Promise<void> }, 'refresh')
    .mockRejectedValueOnce(new Error('test failure')).mockResolvedValue(undefined);
  await app.refreshNow();
  await app.refreshNow();
  expect(refresh).toHaveBeenCalledTimes(2);
});
