import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { giveFlow, revokeFlow } from '../src/services/flows.js';
import { giversOf, giveShuin, goenOf, goshuinchoOf } from '../src/services/shuin.js';
import { cfg, makeDb, member, ROLE } from './helpers.js';

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

const A = '200000000000000001';
const B = '200000000000000002';
const C = '200000000000000003';

describe('朱印を押す', () => {
  it('押した人の役職の格だけご縁が増える', async () => {
    const r = await giveFlow(db, cfg, member(A, ROLE.sewayaku), member(B, ROLE.sanpaisha));
    expect(r).toMatchObject({ kind: 'given', weight: 3, goen: 3, restamped: false });
    expect(await goenOf(db, B)).toBe(3);
  });

  it('同じ人には 1 回だけ', async () => {
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    const r = await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    expect(r).toMatchObject({ kind: 'already', weight: 2, goen: 2 });
    expect(await goenOf(db, B)).toBe(2);
  });

  it('何人にでも押せる', async () => {
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(C, ROLE.sanpaisha));
    await giveFlow(db, cfg, member(C, ROLE.sanpaisha), member(B, ROLE.sanpaisha));
    expect(await goenOf(db, B)).toBe(3);
    expect(await goenOf(db, C)).toBe(2);
  });

  it('同時に 2 回押されても 1 回分しか入らない', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => giveShuin(db, { giverId: A, receiverId: B, weight: 3, giverRank: 'sewayaku' })),
    );
    expect(results.filter((r) => r.status === 'given')).toHaveLength(1);
    expect(await goenOf(db, B)).toBe(3);
  });

  it.each([
    ['self', member(A, ROLE.ujiko), member(A, ROLE.ujiko)],
    ['bot', member(A, ROLE.ujiko), { id: B, isBot: true, roleIds: [] }],
    ['giver_no_rank', member(A), member(B, ROLE.sanpaisha)],
    ['receiver_no_rank', member(A, ROLE.ujiko), member(B)],
    ['yakudoshi', member(A, ROLE.sodai, ROLE.yakudoshi), member(B, ROLE.sanpaisha)],
  ] as const)('押せない: %s', async (reason, giver, receiver) => {
    const r = await giveFlow(db, cfg, giver, receiver);
    expect(r).toEqual({ kind: 'denied', reason });
    expect(await goenOf(db, receiver.id)).toBe(0);
  });

  it('相手がサーバーにいないと押せない', async () => {
    expect(await giveFlow(db, cfg, member(A, ROLE.ujiko), undefined)).toEqual({ kind: 'denied', reason: 'not_member' });
  });

  it('神職は自動役職を持っていても格 5', async () => {
    const r = await giveFlow(db, cfg, member(A, ROLE.ujiko, ROLE.shinshoku), member(B, ROLE.sanpaisha));
    expect(r).toMatchObject({ kind: 'given', weight: 5 });
  });
});

describe('昇格', () => {
  it('ご縁が基準を超えたら昇格が返る', async () => {
    const receiver = member(B, ROLE.sanpaisha);
    // 宮司(10) + 神職(5) で 15、世話役(3) で 18、氏子(2) で 20
    await giveFlow(db, cfg, member('300000000000000001', ROLE.guji), receiver);
    await giveFlow(db, cfg, member('300000000000000002', ROLE.shinshoku), receiver);
    await giveFlow(db, cfg, member('300000000000000003', ROLE.sewayaku), receiver);
    const r = await giveFlow(db, cfg, member('300000000000000004', ROLE.ujiko), receiver);
    expect(r.kind).toBe('given');
    if (r.kind !== 'given') return;
    expect(r.goen).toBe(20);
    expect(r.promotion?.to.key).toBe('ujiko');
    expect(r.promotion?.removeRoleIds).toEqual([ROLE.sanpaisha]);
  });

  it('基準未満なら昇格しない', async () => {
    const r = await giveFlow(db, cfg, member(A, ROLE.guji), member(B, ROLE.sanpaisha));
    expect(r.kind === 'given' && r.promotion).toBeFalsy();
  });
});

describe('取り消し', () => {
  it('取り消すとご縁が減る', async () => {
    await giveFlow(db, cfg, member(A, ROLE.sewayaku), member(B, ROLE.sanpaisha));
    expect(await revokeFlow(db, A, B)).toEqual({ status: 'revoked', weight: 3, goen: 0 });
    expect(await revokeFlow(db, A, B)).toEqual({ status: 'not_found', goen: 0 });
  });

  it('押し直すと今の格で 1 回分だけ入る', async () => {
    await giveFlow(db, cfg, member(A, ROLE.ujiko), member(B, ROLE.sanpaisha));
    await revokeFlow(db, A, B);
    // その後 A が世話役に昇格して押し直した
    const r = await giveFlow(db, cfg, member(A, ROLE.sewayaku), member(B, ROLE.sanpaisha));
    expect(r).toMatchObject({ kind: 'given', weight: 3, goen: 3, restamped: true });
    expect(await giveFlow(db, cfg, member(A, ROLE.sewayaku), member(B, ROLE.sanpaisha))).toMatchObject({
      kind: 'already',
    });
  });

  it('押していない相手の取り消しは not_found', async () => {
    expect(await revokeFlow(db, A, B)).toEqual({ status: 'not_found', goen: 0 });
  });
});

describe('御朱印帳', () => {
  it('ご縁・人数・役職別・最近の人・押した人数', async () => {
    await giveFlow(db, cfg, member(A, ROLE.sewayaku), member(B, ROLE.sanpaisha));
    await giveFlow(db, cfg, member(C, ROLE.ujiko), member(B, ROLE.sanpaisha));
    await giveFlow(db, cfg, member(B, ROLE.sanpaisha), member(A, ROLE.sewayaku));
    await giveFlow(db, cfg, member(B, ROLE.sanpaisha), member(C, ROLE.ujiko));
    await revokeFlow(db, B, C);

    const data = await goshuinchoOf(db, B);
    expect(data.goen).toBe(5);
    expect(data.receivedCount).toBe(2);
    expect(data.byRank).toEqual({ sewayaku: 1, ujiko: 1 });
    expect(new Set(data.recentGiverIds)).toEqual(new Set([A, C]));
    expect(data.givenCount).toBe(1);

    const givers = await giversOf(db, B);
    expect(givers.map((g) => g.giverId).sort()).toEqual([A, C].sort());
  });

  it('まだ誰からも押されていない人', async () => {
    expect(await goshuinchoOf(db, B)).toEqual({
      goen: 0,
      receivedCount: 0,
      byRank: {},
      recentGiverIds: [],
      givenCount: 0,
    });
  });
});
