import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ema, memberAlts, members } from '../src/db/schema.js';
import { emaPromotionEnabled, setEmaPromotion, emaPromotableSanpaisha, ujikoBelowKeep } from '../src/services/emaPromotion.js';
import { EMA_EXPIRE_DAYS } from '../src/domain/ema.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const SA = '870000000000000001'; // 参拝者
const SA2 = '870000000000000002'; // 参拝者
const UJ = '870000000000000003'; // 氏子
const UJ2 = '870000000000000004'; // 氏子
const now = new Date('2026-11-24T03:00:00Z');
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: SA, username: 'sa', displayName: '参拝者A', roleIds: [ROLE.sanpaisha] },
    { id: SA2, username: 'sa2', displayName: '参拝者B', roleIds: [ROLE.sanpaisha] },
    { id: UJ, username: 'uj', displayName: '氏子A', roleIds: [ROLE.ujiko] },
    { id: UJ2, username: 'uj2', displayName: '氏子B', roleIds: [ROLE.ujiko] },
  ]);
});
afterEach(async () => close());

/** receiver に有効な絵馬を n 枚（別々の贈り主）。older=true で失効ずみ */
async function seedEma(receiverId: string, n: number, older = false) {
  const createdAt = older ? new Date(now.getTime() - (EMA_EXPIRE_DAYS + 1) * 86_400_000) : now;
  const base = 4700000000000000000n + BigInt(Number(receiverId.slice(-4))) * 1000n + (older ? 500n : 0n);
  await db.insert(ema).values(
    Array.from({ length: n }, (_, i) => ({ giverId: String(base + BigInt(i)), receiverId, tier: 'ujiko' as const, message: '', createdAt, revokedAt: null })),
  );
}

it('絵馬での昇格の ON/OFF（既定は OFF）', async () => {
  expect(await emaPromotionEnabled(db)).toBe(false);
  await setEmaPromotion(db, true, 'guji');
  expect(await emaPromotionEnabled(db)).toBe(true);
  await setEmaPromotion(db, false, 'guji');
  expect(await emaPromotionEnabled(db)).toBe(false);
});

it('参拝者で有効な絵馬5枚以上の人を昇格候補に出す（氏子・4枚以下・失効分は出さない）', async () => {
  await seedEma(SA, 5); // 候補
  await seedEma(SA2, 4); // 足りない
  await seedEma(UJ, 5); // 氏子は候補にしない
  await seedEma(SA, 2, true); // 失効分は数えない（SAは有効5枚のまま）
  expect(await emaPromotableSanpaisha(db, cfg, now)).toEqual([SA]);
});

it('承認ずみサブアカウントは昇格候補にしない', async () => {
  await seedEma(SA, 5);
  await db.insert(memberAlts).values({ mainId: UJ, altId: SA, status: 'approved', requestedBy: UJ });
  expect(await emaPromotableSanpaisha(db, cfg, now)).toEqual([]);
});

it('維持の注意：有効な絵馬3枚未満の氏子を、少ない順に出す（参拝者は出さない）', async () => {
  await seedEma(UJ, 2); // 3枚未満＝注意
  await seedEma(UJ2, 3); // 3枚ちょうど＝注意なし
  // SA（参拝者）は絵馬0枚だが、氏子ではないので対象外
  expect(await ujikoBelowKeep(db, cfg, now)).toEqual([{ id: UJ, count: 2 }]);
});
