import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { deliverPresenceGift, failPresenceGift, pendingPresenceGifts, recentPresenceGifts, requestPresenceGift } from '../src/services/presenceGifts.js';
import { walletOf } from '../src/services/economy.js';
import { ticketsOf } from '../src/services/tickets.js';
import { makeDb } from './helpers.js';

const A = '780000000000000001';
const B = '780000000000000002';
const STAFF = '780000000000000009';
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('🎁 浮上している人へのプレゼント', () => {
  it('おかしな受付は断る（量・券の種類・理由）', async () => {
    expect(await requestPresenceGift(db, { kind: 'coins' }, 0, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'nai' }, 1, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'fuku' }, 11, 'お礼', STAFF)).toBeUndefined();
    expect(await requestPresenceGift(db, { kind: 'coins' }, 100, '', STAFF)).toBeUndefined();
    expect(await pendingPresenceGifts(db)).toEqual([]);
  });

  it('銭: オンラインの人に配る。1 件 1 回だけ（2 回目は何もしない）', async () => {
    const g = (await requestPresenceGift(db, { kind: 'coins' }, 100, 'イベントのお礼', STAFF))!;
    expect((await pendingPresenceGifts(db)).map((x) => x.id)).toEqual([g.id]);
    expect(await deliverPresenceGift(db, g.id, [A, B, A])).toEqual({ status: 'ok', count: 2 });
    expect(await deliverPresenceGift(db, g.id, [A, B])).toEqual({ status: 'done' });
    expect((await walletOf(db, A)).balance).toBe(100);
    expect((await walletOf(db, B)).balance).toBe(100);
    expect((await recentPresenceGifts(db))[0]).toMatchObject({ status: 'done', count: 2 });
    expect(await pendingPresenceGifts(db)).toEqual([]);
  });

  it('券も配れる。配れなかったものは配らない', async () => {
    const g = (await requestPresenceGift(db, { kind: 'ticket', ticketKind: 'fuku' }, 2, 'お祭り', STAFF))!;
    expect(await deliverPresenceGift(db, g.id, [A])).toEqual({ status: 'ok', count: 1 });
    expect((await ticketsOf(db, A)).fuku).toBe(2);
    const h = (await requestPresenceGift(db, { kind: 'coins' }, 50, 'テスト', STAFF))!;
    await failPresenceGift(db, h.id, 'presence_off');
    expect(await deliverPresenceGift(db, h.id, [A])).toEqual({ status: 'done' });
    expect((await walletOf(db, A)).balance).toBe(0);
    expect((await recentPresenceGifts(db))[0]).toMatchObject({ status: 'failed', reason: 'presence_off' });
  });
});
