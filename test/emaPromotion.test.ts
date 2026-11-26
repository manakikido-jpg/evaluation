import { afterEach, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { ema, memberAlts, members } from '../src/db/schema.js';
import { emaPromotionEnabled, setEmaPromotion, emaPromotable, ujikoBelowKeep, collectEmaKeepWarnings } from '../src/services/emaPromotion.js';
import { EMA_EXPIRE_DAYS, type EmaTier } from '../src/domain/ema.js';
import { cfg, makeDb, ROLE } from './helpers.js';
import type { GuildConfig } from '../src/config.js';

const withThresholds = (patch: Partial<GuildConfig['emaThresholds']>): GuildConfig => ({ ...cfg, emaThresholds: { ...cfg.emaThresholds, ...patch } });

const SA = '870000000000000001'; // 参拝者
const SA2 = '870000000000000002'; // 参拝者
const UJ = '870000000000000003'; // 氏子
const UJ2 = '870000000000000004'; // 氏子
const SW = '870000000000000005'; // 世話役
const SW2 = '870000000000000006'; // 世話役
const now = new Date('2026-11-24T03:00:00Z');
let db: Db, close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: SA, username: 'sa', displayName: '参拝者A', roleIds: [ROLE.sanpaisha] },
    { id: SA2, username: 'sa2', displayName: '参拝者B', roleIds: [ROLE.sanpaisha] },
    { id: UJ, username: 'uj', displayName: '氏子A', roleIds: [ROLE.ujiko] },
    { id: UJ2, username: 'uj2', displayName: '氏子B', roleIds: [ROLE.ujiko] },
    { id: SW, username: 'sw', displayName: '世話役A', roleIds: [ROLE.sewayaku] },
    { id: SW2, username: 'sw2', displayName: '世話役B', roleIds: [ROLE.sewayaku] },
  ]);
});
afterEach(async () => close());

/** receiver に有効な絵馬を n 枚（別々の贈り主）。older=true で失効ずみ（氏子の票のみ失効する） */
async function seedEma(receiverId: string, n: number, older = false, tier: EmaTier = 'ujiko') {
  const createdAt = older ? new Date(now.getTime() - (EMA_EXPIRE_DAYS + 1) * 86_400_000) : now;
  const t = tier === 'ujiko' ? 0 : tier === 'sewayaku' ? 1 : 2;
  const base = 4700000000000000000n + BigInt(Number(receiverId.slice(-4))) * 1000n + (older ? 500n : 0n) + BigInt(t) * 100_000n;
  await db.insert(ema).values(
    Array.from({ length: n }, (_, i) => ({ giverId: String(base + BigInt(i)), receiverId, tier, message: '', createdAt, revokedAt: null })),
  );
}

it('絵馬での昇格の ON/OFF（既定は OFF）', async () => {
  expect(await emaPromotionEnabled(db)).toBe(false);
  await setEmaPromotion(db, true, 'guji');
  expect(await emaPromotionEnabled(db)).toBe(true);
  await setEmaPromotion(db, false, 'guji');
  expect(await emaPromotionEnabled(db)).toBe(false);
});

it('参拝者は必要数（ここでは最低5枚）に届いた人を昇格候補に出す（お参り期間がなければ直近14日の票で・古い票は数えない）', async () => {
  const five = withThresholds({ ujikoMin: 5 });
  await seedEma(SA, 5); // 候補
  await seedEma(SA2, 4); // 足りない
  await seedEma(SA2, 2, true); // 直近14日より前は数えない（SA2は4枚のまま）
  expect(await emaPromotable(db, five, now)).toEqual([SA]);
});

it('氏子は絵馬では世話役に上がらない（氏子→世話役は毎月の投票）', async () => {
  await seedEma(UJ, 9); // 氏子の票は何枚あっても関係ない
  await seedEma(UJ2, 3, false, 'sewayaku'); // 前の決まりの世話役の票が残っていても上がらない
  expect(await emaPromotable(db, cfg, now)).toEqual([]);
});

it('世話役は総代の票3枚で昇格候補に（2枚では出さない）', async () => {
  await seedEma(SW, 3, false, 'sodai'); // 候補
  await seedEma(SW2, 2, false, 'sodai'); // 足りない
  await seedEma(SW2, 5, false, 'sewayaku'); // 世話役の票は総代昇格に関係ない
  expect(await emaPromotable(db, cfg, now)).toEqual([SW]);
});

it('承認ずみサブアカウントは昇格候補にしない', async () => {
  await seedEma(SA, 5);
  await db.insert(memberAlts).values({ mainId: UJ, altId: SA, status: 'approved', requestedBy: UJ });
  expect(await emaPromotable(db, cfg, now)).toEqual([]);
});

it('維持の注意：有効な氏子の票3枚未満の氏子を、少ない順に出す（参拝者は出さない）', async () => {
  await seedEma(UJ, 2); // 3枚未満＝注意
  await seedEma(UJ2, 3); // 3枚ちょうど＝注意なし
  // SA（参拝者）は絵馬0枚だが、氏子ではないので対象外
  expect(await ujikoBelowKeep(db, cfg, now)).toEqual([{ id: UJ, count: 2 }]);
});

it('枚数の設定は宮司が変えられる（総代の票2枚で候補・維持0枚で注意なし）', async () => {
  await seedEma(SW2, 2, false, 'sodai'); // 既定(3)では足りないが…
  expect(await emaPromotable(db, cfg, now)).toEqual([]);
  expect(await emaPromotable(db, withThresholds({ sodaiPromote: 2 }), now)).toEqual([SW2]); // 2に下げると候補
  // UJ2 は氏子で氏子の票0枚。維持0なら注意なし
  expect(await ujikoBelowKeep(db, withThresholds({ ujikoKeep: 0 }), now)).toEqual([]);
});

/** receiver の氏子の票をちょうど n 枚にする（それまでの氏子の票は消す） */
async function setUjikoVotes(receiverId: string, n: number) {
  await db.delete(ema).where(and(eq(ema.receiverId, receiverId), eq(ema.tier, 'ujiko')));
  if (n > 0) await db.insert(ema).values(Array.from({ length: n }, (_, i) => ({ giverId: String(4800000000000000000n + BigInt(i)), receiverId, tier: 'ujiko' as const, message: '', createdAt: now, revokedAt: null })));
}

it('維持の注意DM：一度は届いた氏子が割ったら1回だけ・据え置き0枚は知らせない・戻ると消える', async () => {
  // UJ：4枚（健全）→ 2枚（割る）→ 2枚のまま → 3枚（戻る）→ 1枚（また割る）
  await setUjikoVotes(UJ, 4);
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([]); // 健全：知らせない（到達済みを記録）
  await setUjikoVotes(UJ, 2);
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([{ id: UJ, count: 2 }]); // 割った → 1回知らせる
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([]); // もう知らせない（二度は出さない）
  // UJ2：0枚のまま据え置き（一度も届いていない）→ 知らせない
  await setUjikoVotes(UJ2, 0);
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([]);
  // UJ：戻すと注意が消え、また割ると改めて知らせる
  await setUjikoVotes(UJ, 3);
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([]); // 戻った：知らせない（記録を消す）
  await setUjikoVotes(UJ, 1);
  expect(await collectEmaKeepWarnings(db, cfg, now)).toEqual([{ id: UJ, count: 1 }]); // また割った → 改めて知らせる
});

it('維持の注意DM：維持0枚なら誰にも知らせない', async () => {
  await setUjikoVotes(UJ, 4);
  await collectEmaKeepWarnings(db, cfg, now); // 到達済みにしておく
  await setUjikoVotes(UJ, 0);
  expect(await collectEmaKeepWarnings(db, withThresholds({ ujikoKeep: 0 }), now)).toEqual([]);
});
