import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { approveMemberAlt, altsOfMain, removeMemberAlt, requestMemberAlt } from '../src/services/memberAlts.js';
import { isRestrictedAccount } from '../src/services/staffAlts.js';
import { makeDb } from './helpers.js';

const MAIN = '700000000000000901', ALT = '700000000000000902', OTHER = '700000000000000903';
let db: Db, close: () => Promise<void>;
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => close());

describe('🔗 メンバーのサブアカウント', () => {
  it('申告 → 承認でサブの銭を本アカウントへ移し、そのあとサブには銭が入らない', async () => {
    await addCoins(db, ALT, 500, 'adjust');
    await addCoins(db, MAIN, 100, 'adjust');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: ALT, by: ALT })).toBe('self');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: MAIN, by: ALT })).toBe('ok');
    expect(await requestMemberAlt(db, { altId: ALT, mainId: OTHER, by: ALT })).toBe('exists');
    expect(await requestMemberAlt(db, { altId: OTHER, mainId: ALT, by: OTHER })).toBe('main_is_alt');
    expect(await requestMemberAlt(db, { altId: MAIN, mainId: OTHER, by: MAIN })).toBe('alt_has_alts');
    // 申告中はまだ制限しない
    expect(await isRestrictedAccount(db, ALT)).toBe(false);
    const [a, b] = await Promise.all([approveMemberAlt(db, ALT, 'staff'), approveMemberAlt(db, ALT, 'staff')]);
    expect([a.status, b.status].sort()).toEqual(['done', 'ok']);
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect((await walletOf(db, MAIN)).balance).toBe(600);
    expect(await isRestrictedAccount(db, ALT)).toBe(true);
    await addCoins(db, ALT, 300, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(0);
    expect((await altsOfMain(db, MAIN)).map((x) => x.altId)).toEqual([ALT]);
    // 外すと、また銭が入る
    expect(await removeMemberAlt(db, ALT, 'staff')).toBe(true);
    await addCoins(db, ALT, 300, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(300);
  });
});
