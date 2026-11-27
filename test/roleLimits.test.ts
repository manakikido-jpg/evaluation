import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members } from '../src/db/schema.js';
import { setEmaPromotion } from '../src/services/emaPromotion.js';
import { resetAllShuin } from '../src/services/shuin.js';
import { setNewSystemRoles } from '../src/services/ujikoKeep.js';
import { aramitamaAccessRole, casinoRoleLimit, newSystemActive, roomsUjikoOnly, setPerkUjiko } from '../src/services/perkGate.js';
import { casinoCfgFor } from '../src/services/casino/boost.js';
import { casinoAllowed } from '../src/web/casino.js';
import { addTickets } from '../src/services/tickets.js';
import { useCasinoBoost } from '../src/services/casino/boost.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const S = '896000000000000001', U = '896000000000000002', A = '896000000000000003';
const ARA = '896000000000008888';
const T0 = new Date('2026-12-01T03:00:00Z');
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: S, username: 's', displayName: '参拝者', roleIds: [ROLE.sanpaisha] },
    { id: U, username: 'u', displayName: '氏子', roleIds: [ROLE.ujiko] },
    { id: A, username: 'a', displayName: '荒魂', roleIds: [ARA] },
  ]);
});
afterEach(async () => close());

const start = async () => {
  await setEmaPromotion(db, true, 'guji');
  await resetAllShuin(db, 'guji', T0);
  await setNewSystemRoles(db, { aramitama: ARA }, 'guji');
};

describe('🎰 ロールごとのカジノの上限（新制度）', () => {
  it('新制度が始まるまでは、だれも変わらない', async () => {
    expect(await newSystemActive(db)).toBe(false);
    expect(await casinoRoleLimit(db, cfg, [ROLE.sanpaisha])).toBeNull();
    expect((await casinoCfgFor(db, cfg, S)).casino.dailyBetLimit).toBe(cfg.casino.dailyBetLimit);
    expect(await aramitamaAccessRole(db)).toBeUndefined();
  });

  it('始まったら：荒魂500・参拝者5,000・氏子はふつうの上限', async () => {
    await start();
    expect(await casinoRoleLimit(db, cfg, [ARA])).toEqual({ limit: 500, who: 'aramitama' });
    expect(await casinoRoleLimit(db, cfg, [ROLE.sanpaisha])).toEqual({ limit: 5000, who: 'sanpaisha' });
    expect(await casinoRoleLimit(db, cfg, [ROLE.ujiko])).toBeNull();
    expect(await casinoRoleLimit(db, cfg, [])).toBeNull(); // 位のロールがない人は今までどおり
    expect((await casinoCfgFor(db, cfg, A)).casino.dailyBetLimit).toBe(500);
    expect((await casinoCfgFor(db, cfg, S)).casino.dailyBetLimit).toBe(5000);
    expect((await casinoCfgFor(db, cfg, U)).casino.dailyBetLimit).toBe(cfg.casino.dailyBetLimit);
    // 1回の賭けの最高も、1日の上限を超えない
    expect((await casinoCfgFor(db, cfg, A)).casino.maxBet).toBeLessThanOrEqual(500);
  });

  it('参拝者は、大勝負の札が効いていても上限は5,000のまま。氏子は札で上がる', async () => {
    await start();
    for (const id of [S, U]) {
      await addTickets(db, id, 'casino_boost', 1);
      expect((await useCasinoBoost(db, id, T0, cfg.casino)).status).toBe('ok');
    }
    expect((await casinoCfgFor(db, cfg, S, T0)).casino.dailyBetLimit).toBe(5000);
    expect((await casinoCfgFor(db, cfg, U, T0)).casino.dailyBetLimit).toBeGreaterThan(cfg.casino.dailyBetLimit);
  });

  it('荒魂（位のロールなし）も、新制度ではカジノに入れる', async () => {
    await start();
    expect(casinoAllowed({ ...cfg, casino: { ...cfg.casino, accessRoleId: undefined, requireRank: true } } as typeof cfg, [ARA], false, await aramitamaAccessRole(db))).toBe(true);
    expect(casinoAllowed({ ...cfg, casino: { ...cfg.casino, accessRoleId: undefined, requireRank: true } } as typeof cfg, [ARA], false)).toBe(false);
  });
});

describe('🏨 宿・シクレを作れるのは氏子以上（新制度）', () => {
  it('新制度の前は⑤のスイッチしだい。始まったら、いつも氏子以上だけ', async () => {
    expect(await roomsUjikoOnly(db)).toBe(false);
    await setPerkUjiko(db, true, 'guji');
    expect(await roomsUjikoOnly(db)).toBe(true);
    await setPerkUjiko(db, false, 'guji');
    await start();
    expect(await roomsUjikoOnly(db)).toBe(true);
  });
});
