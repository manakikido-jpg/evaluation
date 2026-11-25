import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { members, shuin } from '../src/db/schema.js';
import { grantGoenPerks } from '../src/services/goenPerks.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';

const A = '910000000000000001';
const B = '910000000000000002';
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: A, username: 'a', displayName: 'A', roleIds: [] },
    { id: B, username: 'b', displayName: 'B', roleIds: [] },
  ]);
});
afterEach(async () => close());

const addGoen = (receiver: string, weight: number, giver: string) => db.insert(shuin).values({ giverId: giver, receiverId: receiver, weight, giverRank: 'sanpaisha' });

it('ご縁の節目に届いた人へ、銭を1回ずつ渡す（節目は25/50/100/200・冪等）', async () => {
  await addGoen(A, 30, '911000000000000001'); // ご縁30 → 25の節目だけ
  await addGoen(B, 120, '911000000000000002'); // ご縁120 → 25・50・100
  const g1 = await grantGoenPerks(db, cfg);
  expect(g1.filter((x) => x.memberId === A).map((x) => x.goen)).toEqual([25]);
  expect(g1.filter((x) => x.memberId === B).map((x) => x.goen)).toEqual([25, 50, 100]);
  expect((await walletOf(db, A)).balance).toBe(500);
  expect((await walletOf(db, B)).balance).toBe(500 + 1000 + 2000);
  // 冪等：2回目は何も渡さない
  expect(await grantGoenPerks(db, cfg)).toEqual([]);
  expect((await walletOf(db, B)).balance).toBe(3500);
});

it('あとからご縁がのびたら、新しく届いた節目だけ渡す', async () => {
  await addGoen(A, 30, '911000000000000003');
  await grantGoenPerks(db, cfg); // 25
  await addGoen(A, 80, '911000000000000004'); // ご縁110 → 50・100 が新たに
  const g = await grantGoenPerks(db, cfg);
  expect(g.map((x) => x.goen)).toEqual([50, 100]);
  expect((await walletOf(db, A)).balance).toBe(500 + 1000 + 2000);
});

it('🔓 解放：銭0・ロールだけの節目（限定チャンネルを開くロール）も、届いたらロールを1回だけ返す', async () => {
  const ROOM = '980000000000000077';
  const c = { ...cfg, goenPerks: [{ goen: 20, coins: 0, roleId: ROOM, label: '縁結びの間' }] };
  await addGoen(A, 25, '911000000000000005');
  const g = await grantGoenPerks(db, c);
  expect(g).toEqual([{ memberId: A, goen: 20, coins: 0, roleId: ROOM, label: '縁結びの間' }]);
  expect((await walletOf(db, A)).balance).toBe(0); // 銭は渡さない
  expect(await grantGoenPerks(db, c)).toEqual([]); // 二度は渡さない
});
