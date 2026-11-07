import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { giftGacha } from '../src/services/buffs.js';
import { drawStyles } from '../src/services/casino/styles.js';
import { addHorse, setSale } from '../src/services/casino/keibaStable.js';
import { addCoins, spendCoins, walletOf } from '../src/services/economy.js';
import { drawGacha } from '../src/services/gacha.js';
import { sendKoban } from '../src/services/koban.js';
import { createListing } from '../src/services/market.js';
import { approveMemberAlt, requestMemberAlt } from '../src/services/memberAlts.js';
import { sendPresent } from '../src/services/presents.js';
import { setStaffAlt } from '../src/services/staffAlts.js';
import { addTickets, ticketsOf } from '../src/services/tickets.js';
import { ujikoEvaluation } from '../src/services/ujikoEvaluation.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const MAIN = '700000000000000801', ALT = '700000000000000802', OTHER = '700000000000000803', STAFF_ALT = '700000000000000804';
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([MAIN, ALT, OTHER, STAFF_ALT].map((id) => ({ id, username: id, displayName: id, roleIds: [ROLE.sanpaisha] })));
  // 本アカウント側の申請なので、承認してもサブの銭は残る（残った銭を使えないことを確かめる）
  await addCoins(db, ALT, 5000, 'adjust');
  await addTickets(db, ALT, 'gacha_gift', 1);
  await addTickets(db, ALT, 'gacha_free', 1);
  expect(await requestMemberAlt(db, { altId: ALT, mainId: MAIN, by: MAIN, reason: 'テスト' })).toBe('ok');
  expect(await approveMemberAlt(db, ALT, 'staff')).toMatchObject({ status: 'ok', kept: true });
});
afterEach(async () => close());

describe('🔗 承認ずみのサブアカウントは、多重に使えない', () => {
  it('銭は残っていても使えない（カジノ・ショップ・送金など、銭を使うものは全部止まる）。入りもしない', async () => {
    expect((await walletOf(db, ALT)).balance).toBe(5000);
    expect(await spendCoins(db, ALT, 100, 'shop')).toBe(false);
    await addCoins(db, ALT, 100, 'adjust');
    expect((await walletOf(db, ALT)).balance).toBe(5000);
    // 本アカウントは、ふつうに使える
    await addCoins(db, MAIN, 100, 'adjust');
    expect(await spendCoins(db, MAIN, 100, 'shop')).toBe(true);
  });

  it('贈り券・贈り物（持ち物）は、サブからも、サブへも贈れない。券も入らない', async () => {
    expect(await giftGacha(db, ALT, MAIN)).toBe('restricted');
    expect(await giftGacha(db, MAIN, ALT)).toBe('restricted');
    const from = { id: ALT, roleIds: [ROLE.ujiko] }, to = { id: MAIN, roleIds: [ROLE.ujiko] };
    expect(await sendPresent(db, cfg, from, to, { kind: 'ticket', ticket: 'gacha_free' }, 1)).toEqual({ status: 'restricted' });
    expect(await sendPresent(db, cfg, to, from, { kind: 'ticket', ticket: 'gacha_free' }, 1)).toEqual({ status: 'restricted' });
    const before = (await ticketsOf(db, ALT)).gacha_free;
    await addTickets(db, ALT, 'gacha_free', 3);
    expect((await ticketsOf(db, ALT)).gacha_free).toBe(before);
  });

  it('小判は、サブからも、サブへも送れない', async () => {
    await expect(sendKoban(db, ALT, 'x', MAIN)).rejects.toThrow('サブアカウントは、小判を送れません');
    await expect(sendKoban(db, MAIN, 'x', ALT)).rejects.toThrow('サブアカウントには、小判を送れません');
  });

  it('市場に出品できない・物御籤も勝負の御籤も引けない（無料券でも）', async () => {
    expect(await createListing(db, cfg, { id: ALT, roleIds: [ROLE.ujiko] }, { category: 'other', title: 'x', description: '', price: 100 })).toEqual({ status: 'restricted' });
    expect((await drawGacha(db, { ...cfg.gacha, enabled: true }, ALT, 1, [], Math.random, new Date(), { free: true })).status).toBe('disabled');
    expect((await drawStyles(db, { ...cfg.casinoGacha, enabled: true }, ALT, 'r1', 1, 'web')).status).toBe('off');
  });

  it('評価・氏子への昇格の対象から外す（運営のサブも同じ）', async () => {
    await setStaffAlt(db, STAFF_ALT, true, 'staff', MAIN);
    const ids = (await ujikoEvaluation(db, cfg, { q: '', status: 'all' })).rows.map((r) => r.memberId);
    expect(ids).toContain(MAIN);
    expect(ids).not.toContain(ALT);
    expect(ids).not.toContain(STAFF_ALT);
  });

  it('運営のサブにしたときの残高の片付けは、今までどおりできる', async () => {
    await addCoins(db, STAFF_ALT, 300, 'adjust');
    expect(await setStaffAlt(db, STAFF_ALT, true, 'staff', MAIN)).toBe(true);
    expect((await walletOf(db, STAFF_ALT)).balance).toBe(0);
  });

  it('競馬の馬は、売りに出せない（サブから本アカウントへ馬を渡せないように）。売るのをやめるのはよい', async () => {
    const horse = (await addHorse(db, 'サブの馬', undefined, ALT))!;
    expect(await setSale(db, ALT, horse.id, 1000)).toBe(false);
    expect(await setSale(db, ALT, horse.id, null)).toBe(true);
  });
});

