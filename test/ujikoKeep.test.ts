import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { ema, engawaPairs, invites, members, ujikoKeepState } from '../src/db/schema.js';
import { setEmaPromotion, emaPromotable, emaStepProgress } from '../src/services/emaPromotion.js';
import { resetAllShuin } from '../src/services/shuin.js';
import { giveEma } from '../src/services/ema.js';
import { emaStepFrom } from '../src/domain/ema.js';
import { isMotoUjiko, keepCardOf, runUjikoKeep, setNewSystemRoles, newSystemRoles } from '../src/services/ujikoKeep.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const U = '890000000000000001'; // 氏子
const S = '890000000000000002'; // 参拝者（贈る人）
const MOTO_ROLE = '890000000000009999';
const DAY = 86_400_000;
const T0 = new Date('2026-12-01T03:00:00Z'); // ④の日
let db: Db, close: () => Promise<void>;
let n = 0;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  await db.insert(members).values([
    { id: U, username: 'u', displayName: '氏子', roleIds: [ROLE.ujiko] },
    { id: S, username: 's', displayName: '参拝者', roleIds: [ROLE.sanpaisha] },
  ]);
});
afterEach(async () => close());

/** 絵馬を n 枚（tier＝ujiko: 氏子以上から／sanpai: 参拝者から） */
async function votes(receiverId: string, count: number, tier: 'ujiko' | 'sanpai', at: Date) {
  await db.insert(ema).values(Array.from({ length: count }, () => ({ giverId: String(891000000000000000n + BigInt(n++)), receiverId, tier, message: '', createdAt: at, revokedAt: null })));
}
const start = async () => {
  await setEmaPromotion(db, true, 'guji');
  await resetAllShuin(db, 'guji', T0);
};
const days = (d: number) => new Date(T0.getTime() + d * DAY);

describe('🍃 氏子のキープ', () => {
  it('③④の前は動かない。④のあと、はじめに判定の日（④から30日後）を決める', async () => {
    expect(await runUjikoKeep(db, cfg, T0)).toEqual([]);
    expect(await db.select().from(ujikoKeepState)).toEqual([]);
    await start();
    expect(await runUjikoKeep(db, cfg, days(1))).toEqual([]);
    const [row] = await db.select().from(ujikoKeepState);
    expect(row).toMatchObject({ memberId: U, state: 'ujiko' });
    expect(row!.nextJudgeAt!.getTime()).toBe(days(30).getTime());
  });

  it('判定の7日前に、足りなければ1回だけ知らせる。足りていれば知らせない', async () => {
    await start();
    await runUjikoKeep(db, cfg, days(1));
    expect(await runUjikoKeep(db, cfg, days(22))).toEqual([]); // まだ8日前
    const warn = await runUjikoKeep(db, cfg, days(23));
    expect(warn).toMatchObject([{ type: 'warn', id: U, p: { total: 0, short: 20, met: false } }]);
    expect(await runUjikoKeep(db, cfg, days(24))).toEqual([]); // 1回だけ
  });

  it('絵馬20・うち参拝者から10が要る。招待は5まで、合計にも参拝者からにも足す', async () => {
    await start();
    await runUjikoKeep(db, cfg, days(1));
    await votes(U, 15, 'ujiko', days(2));
    await votes(U, 5, 'sanpai', days(25)); // 合計20・参拝者から5 → 参拝者からが足りない
    expect((await keepCardOf(db, cfg, U, days(29)))).toMatchObject({ kind: 'keep', p: { total: 20, fromSanpai: 5, short: 5, met: false } });
    // 期間中に「1人」と数えた招待 5 → 参拝者から 5+5=10 で届く
    for (let i = 0; i < 6; i++) await db.insert(invites).values({ memberId: String(892000000000000000n + BigInt(i)), inviterId: U, qualifiedAt: days(10) });
    expect((await keepCardOf(db, cfg, U, days(29)))).toMatchObject({ p: { invites: 6, inviteUsed: 5, short: 0, met: true } });
    const judged = await runUjikoKeep(db, cfg, days(30));
    expect(judged).toMatchObject([{ type: 'kept', id: U }]);
    expect((await db.select().from(ujikoKeepState))[0]!.nextJudgeAt!.getTime()).toBe(days(60).getTime());
  });

  it('参拝者からの絵馬は30日で切れる（氏子以上からの絵馬は残る）', async () => {
    await start();
    await runUjikoKeep(db, cfg, days(1));
    await votes(U, 10, 'ujiko', days(2));
    await votes(U, 10, 'sanpai', days(2));
    expect((await keepCardOf(db, cfg, U, days(29)))).toMatchObject({ p: { total: 20, fromSanpai: 10, met: true } });
    expect((await keepCardOf(db, cfg, U, days(40)))).toMatchObject({ p: { total: 10, fromSanpai: 0, met: false } });
  });

  it('足りないとき：元氏子のロールが未設定なら見送り（1回だけ知らせる）。設定ずみなら元氏子に', async () => {
    await start();
    await runUjikoKeep(db, cfg, days(1));
    await runUjikoKeep(db, cfg, days(23));
    expect(await runUjikoKeep(db, cfg, days(30))).toMatchObject([{ type: 'hold', id: U }]);
    expect(await runUjikoKeep(db, cfg, days(31))).toEqual([]);
    expect(await isMotoUjiko(db, U)).toBe(false);
    await setNewSystemRoles(db, { motoUjiko: MOTO_ROLE }, 'guji');
    expect(await newSystemRoles(db)).toEqual({ motoUjiko: MOTO_ROLE });
    expect(await runUjikoKeep(db, cfg, days(32))).toMatchObject([{ type: 'demote', id: U }]);
    expect(await isMotoUjiko(db, U)).toBe(true);
  });

  it('お守りがあれば1回防ぐ。前の判定で使った人は、次の判定では使えない', async () => {
    await start();
    await setNewSystemRoles(db, { motoUjiko: MOTO_ROLE }, 'guji');
    await runUjikoKeep(db, cfg, days(1));
    let stock = 2;
    const deps = { consumeOmamori: async () => (stock > 0 ? (stock--, true) : false) };
    expect(await runUjikoKeep(db, cfg, days(30), deps)).toMatchObject([{ type: 'omamori', id: U }]);
    expect(stock).toBe(1);
    // 次の判定（60日）：お守りは残っているが使えない → 元氏子
    const next = await runUjikoKeep(db, cfg, days(60), deps);
    expect(next.at(-1)).toMatchObject({ type: 'demote', id: U });
    expect(stock).toBe(1);
  });
});

describe('🍂 元氏子', () => {
  async function demote() {
    await start();
    await setNewSystemRoles(db, { motoUjiko: MOTO_ROLE }, 'guji');
    await runUjikoKeep(db, cfg, days(1));
    await votes(U, 8, 'ujiko', days(2)); // 降格の前の絵馬（リセットされる）
    await runUjikoKeep(db, cfg, days(30));
    expect(await isMotoUjiko(db, U)).toBe(true);
    // Discord 側の付け替え（位は参拝者に）
    await db.update(members).set({ roleIds: [ROLE.sanpaisha, MOTO_ROLE] }).where(eq(members.id, U));
  }

  it('元氏子になる前の絵馬は数えない。元氏子になってからの絵馬15・うち参拝者から10で氏子に戻る', async () => {
    await demote();
    expect(await keepCardOf(db, cfg, U, days(31))).toMatchObject({ kind: 'moto', p: { total: 0, need: 15, needSanpai: 10 } });
    await votes(U, 5, 'ujiko', days(32));
    await votes(U, 9, 'sanpai', days(33));
    expect(await runUjikoKeep(db, cfg, days(34))).toEqual([]);
    // ふつうの参拝者→氏子の決まり（2週間ごとの数）では上げない
    expect(await emaPromotable(db, cfg, days(34))).toEqual([]);
    expect(await emaStepProgress(db, cfg, U, emaStepFrom('sanpaisha', cfg.emaThresholds)!, days(34))).toEqual({ count: 14, need: 15 });
    await votes(U, 1, 'sanpai', days(35));
    expect(await emaPromotable(db, cfg, days(36))).toEqual([U]);
    expect(await runUjikoKeep(db, cfg, days(36))).toMatchObject([{ type: 'return', id: U }]);
    const [row] = await db.select().from(ujikoKeepState);
    expect(row).toMatchObject({ state: 'ujiko' });
    expect(row!.nextJudgeAt!.getTime()).toBe(days(66).getTime());
  });

  it('元氏子は参拝者・氏子のどちらにも贈れ、参拝者からも贈ってもらえる（参拝者からの絵馬として数える）', async () => {
    await demote();
    const UJ2 = '890000000000000003';
    await db.insert(members).values({ id: UJ2, username: 'u2', displayName: '氏子2', roleIds: [ROLE.ujiko] });
    const pair = async (a: string, b: string) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      await db.insert(engawaPairs).values(['2026-12-20', '2026-12-21', '2026-12-22'].map((date) => ({ memberA: x, memberB: y, date, minutes: 40 })));
    };
    await pair(U, S); await pair(U, UJ2);
    const at = days(35);
    // 元氏子 → 参拝者：氏子の票として数える（参拝者の昇格に入る）
    expect(await giveEma(db, cfg, U, S, '', at)).toMatchObject({ ok: true, tier: 'ujiko' });
    // 元氏子 → 氏子：参拝者の票（30日で切れる・「参拝者から」に入る）
    expect(await giveEma(db, cfg, U, UJ2, '', at)).toMatchObject({ ok: true, tier: 'sanpai' });
    // 参拝者 → 元氏子：贈れる（参拝者の票）
    expect(await giveEma(db, cfg, S, U, '', at)).toMatchObject({ ok: true, tier: 'sanpai' });
    expect(await keepCardOf(db, cfg, U, days(36))).toMatchObject({ kind: 'moto', p: { total: 1, fromSanpai: 1 } });
  });
});
