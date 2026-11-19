import { afterEach, beforeEach, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { ema, members, settings, voicePairs } from '../src/db/schema.js';
import { giveEma, togetherStats, validEmaCountOf, emaMessagesOf, revokeEma } from '../src/services/ema.js';
import { EMA_EXPIRE_DAYS } from '../src/domain/ema.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const G = '860000000000000001'; // 氏子（贈れる）
const R = '860000000000000002'; // 参拝者（相手）
const R2 = '860000000000000003'; // 参拝者（相手2）
const W = '860000000000000004'; // 世話役（贈れる）
const P = '860000000000000005'; // 参拝者（贈れない）
const SW = '860000000000000006'; // 世話役（相手にできない）
const BOT = '860000000000000007'; // BOT
const now = new Date('2026-11-18T03:00:00Z');
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: G, username: 'g', displayName: '氏子ギバー', roleIds: [ROLE.ujiko] },
    { id: R, username: 'r', displayName: '参拝者アール', roleIds: [ROLE.sanpaisha] },
    { id: R2, username: 'r2', displayName: '参拝者ツー', roleIds: [ROLE.sanpaisha] },
    { id: W, username: 'w', displayName: '世話役ダブュ', roleIds: [ROLE.sewayaku] },
    { id: P, username: 'p', displayName: '参拝者ピー', roleIds: [ROLE.sanpaisha] },
    { id: SW, username: 'sw', displayName: '世話役エス', roleIds: [ROLE.sewayaku] },
    { id: BOT, username: 'bot', displayName: 'ボット', roleIds: [ROLE.ujiko], isBot: true },
  ]);
});
afterEach(async () => close());

/** 2 人を、違う日に合計◯分いっしょにいたことにする */
async function together(a: string, b: string, perDay: { date: string; minutes: number }[]) {
  const [x, y] = a < b ? [a, b] : [b, a];
  await db.insert(voicePairs).values(perDay.map((d) => ({ memberA: x, memberB: y, date: d.date, minutes: d.minutes })));
}
const met = [
  { date: '2026-11-10', minutes: 60 },
  { date: '2026-11-12', minutes: 60 },
  { date: '2026-11-15', minutes: 60 },
];

it('いっしょにいた日数と分を、順番に関係なく数える', async () => {
  await together(R, G, met);
  expect(await togetherStats(db, G, R)).toEqual({ days: 3, minutes: 180 });
  expect(await togetherStats(db, R, G)).toEqual({ days: 3, minutes: 180 });
  expect(await togetherStats(db, G, R2)).toEqual({ days: 0, minutes: 0 });
});

it('氏子以上が、条件を満たした参拝者に絵馬を贈れる。贈り直しは1枚のまま期限が延びる', async () => {
  await together(G, R, met);
  const first = await giveEma(db, cfg, G, R, '  いつもありがとう  ', now);
  expect(first).toMatchObject({ ok: true, created: true, count: 1, days: 3, minutes: 180 });
  expect((await db.select().from(ema))[0]).toMatchObject({ giverId: G, receiverId: R, tier: 'ujiko', message: 'いつもありがとう' });
  // 別の氏子（世話役）からも贈れる → 2枚
  await together(W, R, met);
  expect(await giveEma(db, cfg, W, R, 'いい人', now)).toMatchObject({ ok: true, count: 2 });
  // 同じ人が贈り直す → 1枚のまま、期限（created_at）が新しくなる
  const later = new Date(now.getTime() + 5 * 86_400_000);
  const re = await giveEma(db, cfg, G, R, 'やっぱり最高', later);
  expect(re).toMatchObject({ ok: true, created: false, count: 2 });
  const row = (await db.select().from(ema).where(and(eq(ema.giverId, G), eq(ema.receiverId, R))))[0]!;
  expect(row.message).toBe('やっぱり最高');
  expect(row.createdAt.getTime()).toBe(later.getTime());
});

it('参拝者は贈れない・相手が世話役以上/自分/BOT/条件不足/退出者/運営サブも贈れない', async () => {
  // 参拝者は贈れない（相手の条件以前に不可）
  expect(await giveEma(db, cfg, P, R, '', now)).toMatchObject({ ok: false, reason: 'giver_not_ujiko' });
  // 相手が世話役以上
  expect(await giveEma(db, cfg, G, SW, '', now)).toMatchObject({ ok: false, reason: 'receiver_rank' });
  // 自分・BOT
  expect(await giveEma(db, cfg, G, G, '', now)).toMatchObject({ ok: false, reason: 'self' });
  expect(await giveEma(db, cfg, G, BOT, '', now)).toMatchObject({ ok: false, reason: 'bot' });
  // 条件不足（2日・120分）
  await together(G, R2, [{ date: '2026-11-10', minutes: 60 }, { date: '2026-11-12', minutes: 60 }]);
  expect(await giveEma(db, cfg, G, R2, '', now)).toMatchObject({ ok: false, reason: 'not_together', days: 2, minutes: 120 });
  // 運営サブ（条件判定より前に不可）
  await db.insert(settings).values({ key: 'staff.alts', value: { list: [{ id: R2 }] }, updatedBy: G });
  expect(await giveEma(db, cfg, G, R2, '', now)).toMatchObject({ ok: false, reason: 'staff_alt' });
  // 退出者（条件は満たすが退出）
  await together(G, R, met);
  await db.update(members).set({ leftAt: now }).where(eq(members.id, R));
  expect(await giveEma(db, cfg, G, R, '', now)).toMatchObject({ ok: false, reason: 'left' });
});

it('有効な枚数は、失効（30日超）と取り消しを除く。一言は匿名で新しい順に返す', async () => {
  const old = new Date(now.getTime() - (EMA_EXPIRE_DAYS + 1) * 86_400_000);
  await db.insert(ema).values([
    { giverId: G, receiverId: R, tier: 'ujiko', message: '新しい', createdAt: now },
    { giverId: W, receiverId: R, tier: 'ujiko', message: '古い（失効）', createdAt: old },
    { giverId: R2, receiverId: R, tier: 'ujiko', message: '取り消し', createdAt: now, revokedAt: now },
  ]);
  expect(await validEmaCountOf(db, R, now)).toBe(1);
  const msgs = await emaMessagesOf(db, R, now);
  expect(msgs.map((m) => m.message)).toEqual(['新しい']);
  expect(Object.keys(msgs[0]!)).not.toContain('giverId'); // 誰が贈ったかは返さない
});

it('絵馬を取り消せる（運営用）', async () => {
  await together(G, R, met);
  await giveEma(db, cfg, G, R, 'ありがとう', now);
  expect(await validEmaCountOf(db, R, now)).toBe(1);
  expect(await revokeEma(db, G, R, now)).toBe(true);
  expect(await validEmaCountOf(db, R, now)).toBe(0);
  expect(await revokeEma(db, G, R, now)).toBe(false); // もうない
});
