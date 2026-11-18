import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { memberAlts, members, settings, shuin, specialGoen } from '../src/db/schema.js';
import { ujikoRatingRows, ujikoRatingXlsx, UJIKO_RATING_ITEMS } from '../src/services/ujikoRating.js';
import { cfg, makeDb, ROLE } from './helpers.js';

// 名前の順を確かめたいので、わざと 50 音の順と作る順をずらす
const A = '810000000000000001', B = '810000000000000002', C = '810000000000000003';
const D = '810000000000000004', E = '810000000000000005', F = '810000000000000006', G = '810000000000000007';
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: A, username: 'a', displayName: 'いろは', roleIds: [ROLE.sanpaisha, ROLE.ujiko] },     // 氏子（対象）
    { id: B, username: 'b', displayName: 'あさひ', roleIds: [ROLE.ujiko] },                      // 氏子（対象・名前は先）
    { id: C, username: 'c', displayName: '参拝者さん', roleIds: [ROLE.sanpaisha] },              // 参拝者（除く）
    { id: D, username: 'd', displayName: '世話役さん', roleIds: [ROLE.ujiko, ROLE.sewayaku] },   // 上位の格（除く）
    { id: E, username: 'e', displayName: 'ボット', roleIds: [ROLE.ujiko], isBot: true },          // BOT（除く）
    { id: F, username: 'f', displayName: '退出', roleIds: [ROLE.ujiko], leftAt: new Date() },     // 退出（除く）
    { id: G, username: 'g', displayName: 'サブ', roleIds: [ROLE.ujiko] },                         // 承認サブ（除く）
  ]);
  await db.insert(memberAlts).values({ altId: G, mainId: A, status: 'approved', requestedBy: A });
});
afterEach(async () => close());
async function stamps(id: string, n: number, weight = 1) {
  await db.insert(shuin).values(Array.from({ length: n }, (_, i) => ({ giverId: String(820000000000000000n + BigInt(i)), receiverId: id, weight, giverRank: 'ujiko' })));
}

it('最上位の格が氏子の在籍メンバーだけを、名前順で出す（参拝者・上位職・BOT・退出・サブは除く）', async () => {
  const rows = await ujikoRatingRows(db, cfg);
  expect(rows.map(r => r.memberId)).toEqual([B, A]); // あさひ → いろは
  expect(rows.map(r => r.name)).toEqual(['あさひ', 'いろは']);
});

it('運営サブ（staff.alts）も除く', async () => {
  await db.insert(settings).values({ key: 'staff.alts', value: { list: [{ id: B }] }, updatedBy: A });
  const rows = await ujikoRatingRows(db, cfg);
  expect(rows.map(r => r.memberId)).toEqual([A]);
});

it('ご縁は御朱印の重みの合計＋特別ご縁、頂いた朱印は個数。取り消しは数えない', async () => {
  await stamps(B, 3, 2);         // 重み 2 × 3 = 6
  await stamps(A, 5, 1);         // 重み 1 × 5 = 5
  await db.insert(specialGoen).values({ memberId: B, amount: 4, reason: 'test', grantedBy: A, nonce: 'rating-test' });
  const revokedGiver = '820000000000000099';
  await db.insert(shuin).values({ giverId: revokedGiver, receiverId: A, weight: 10, giverRank: 'ujiko' });
  await db.update(shuin).set({ revokedAt: new Date() }).where(eq(shuin.giverId, revokedGiver));
  const by = new Map((await ujikoRatingRows(db, cfg)).map(r => [r.memberId, r]));
  expect(by.get(B)).toMatchObject({ goen: 10, shuinCount: 3 });  // 6 + 特別 4
  expect(by.get(A)).toMatchObject({ goen: 5, shuinCount: 5 });   // 取り消した 10 は入らない
});

it('エクセルは開ける形で、平均は式・名前やIDは文字（数式として実行されない）', async () => {
  const rows = [
    { memberId: '810000000000000001', name: '=あぶない', goen: 5, shuinCount: 3, joinedAt: new Date('2026-01-02T00:00:00Z') },
    { memberId: '810000000000000002', name: 'ふつう', goen: 0, shuinCount: 0, joinedAt: null },
  ];
  const buf = ujikoRatingXlsx(rows);
  expect(Buffer.from(buf.slice(0, 4)).toString('hex')).toBe('504b0304'); // ZIP の目印
  const xml = Buffer.from(buf).toString('utf8'); // 圧縮なしなので中身がそのまま入る
  // 平均は式（1 人目は 2 行目 → F2:J2）
  expect(xml).toContain('<f>IFERROR(AVERAGE(F2:J2),&quot;&quot;)</f>');
  expect(xml).toContain('<f>IFERROR(AVERAGE(F3:J3),&quot;&quot;)</f>');
  // 危ない名前は、式ではなく文字（inlineStr）として入る
  expect(xml).toContain('<is><t xml:space="preserve">=あぶない</t></is>');
  expect(xml).not.toContain('<f>=あぶない');
  // 見出しに評価の項目がある
  for (const item of UJIKO_RATING_ITEMS) expect(xml).toContain(`<t xml:space="preserve">${item}</t>`);
});
