import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { postCard, entryMessage, boardPanel } from '../src/discord/board.js';
import {
  applyPost,
  boardTick,
  closePost,
  completeEntry,
  createPost,
  disputeEntry,
  entriesOf,
  getPost,
  hire,
  refundEntry,
} from '../src/services/board.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const AUTHOR = '870000000000000001';
const A = '870000000000000002';
const B = '870000000000000003';
const C = '870000000000000004';
const T0 = new Date('2026-09-29T12:00:00Z');
const DAY = 86_400_000;
const author = { id: AUTHOR, roleIds: [ROLE.ujiko] };
const member = (id: string) => ({ id, roleIds: [ROLE.sanpaisha] });
const base = { category: 'work', title: '配信のサムネを作ってくれる人', body: '1 枚', slots: 2, reward: 1000, days: 7 };

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('📌 掲示板', () => {
  it('書く: 役職のある人。報酬は 2 段目以上で、報酬 × 人数を預かる。入力の範囲', async () => {
    expect((await createPost(db, cfg, { id: AUTHOR, roleIds: [] }, { ...base, reward: 0 }, T0)).status).toBe('no_rank');
    expect(await createPost(db, cfg, member(A), base, T0)).toMatchObject({ status: 'reward_rank', rankName: '氏子' });
    // 報酬なしなら 1 段目でも書ける
    expect((await createPost(db, cfg, member(A), { ...base, reward: 0 }, T0)).status).toBe('ok');
    expect((await createPost(db, cfg, author, { ...base, title: '' }, T0)).status).toBe('invalid');
    expect((await createPost(db, cfg, author, { ...base, slots: 0 }, T0)).status).toBe('invalid');
    expect((await createPost(db, cfg, author, { ...base, days: 31 }, T0)).status).toBe('invalid');
    expect(await createPost(db, cfg, author, base, T0)).toMatchObject({ status: 'insufficient', need: 2000 });
    await addCoins(db, AUTHOR, 3000, 'adjust');
    const r = await createPost(db, cfg, author, base, T0);
    expect(r).toMatchObject({ status: 'ok', post: { escrow: 2000, reward: 1000, slots: 2 }, balance: 1000 });
  });

  it('応募・採用・完了: 報酬から手数料を引いて渡す。人数がいっぱいで締め切る', async () => {
    await addCoins(db, AUTHOR, 2000, 'adjust');
    const r = await createPost(db, cfg, author, base, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const id = r.post.id;
    expect((await applyPost(db, cfg, id, author, T0)).status).toBe('self');
    expect((await applyPost(db, cfg, id, { id: A, roleIds: [] }, T0)).status).toBe('no_rank');
    const a = await applyPost(db, cfg, id, member(A), T0);
    if (a.status !== 'ok') throw new Error(a.status);
    expect((await applyPost(db, cfg, id, member(A), T0)).status).toBe('already');
    const b = await applyPost(db, cfg, id, member(B), T0);
    const c = await applyPost(db, cfg, id, member(C), T0);
    if (b.status !== 'ok' || c.status !== 'ok') throw new Error('apply');
    // 採用は募集した人だけ
    expect((await hire(db, cfg, a.entry.id, A, T0)).status).toBe('not_author');
    expect(await hire(db, cfg, a.entry.id, AUTHOR, T0)).toMatchObject({ status: 'ok', full: false });
    expect(await hire(db, cfg, b.entry.id, AUTHOR, T0)).toMatchObject({ status: 'ok', full: true });
    expect((await getPost(db, id))!.status).toBe('closed');
    expect((await hire(db, cfg, c.entry.id, AUTHOR, T0)).status).toBe('full');
    // 完了: 手数料（10%）を引いて 900 枚
    expect((await completeEntry(db, cfg, a.entry.id, A, {}, T0)).status).toBe('not_allowed');
    expect(await completeEntry(db, cfg, a.entry.id, AUTHOR, {}, T0)).toMatchObject({ status: 'ok', paid: 900 });
    expect((await walletOf(db, A)).balance).toBe(900);
    expect((await getPost(db, id))!.escrow).toBe(1000);
    expect((await completeEntry(db, cfg, a.entry.id, AUTHOR, {}, T0)).status).toBe('not_hired');
    // 期限で B にも渡す
    const t = await boardTick(db, cfg, new Date(T0.getTime() + cfg.market.autoReleaseDays * DAY));
    expect(t.paid.map((x) => x.entry.memberId)).toEqual([B]);
    expect((await getPost(db, id))!.escrow).toBe(0);
    // 見た目
    const card = JSON.stringify(postCard((await getPost(db, id))!, await entriesOf(db, id), cfg));
    expect(card).toContain('2 / 2 人');
    expect(card).toContain('（満員）');
    expect(JSON.stringify(boardPanel(cfg))).toContain('board:new');
  });

  it('締め切り: 採用しなかった分を戻す（期限でも）。問題ありは運営が戻せる', async () => {
    await addCoins(db, AUTHOR, 3000, 'adjust');
    const r = await createPost(db, cfg, author, { ...base, slots: 3, days: 3 }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const a = await applyPost(db, cfg, r.post.id, member(A), T0);
    if (a.status !== 'ok') throw new Error(a.status);
    await hire(db, cfg, a.entry.id, AUTHOR, T0);
    // 期限で締め切る: 採用しなかった 2 人分（2000）を戻す。採用中の 1 人分は残す
    const t = await boardTick(db, cfg, new Date(T0.getTime() + 3 * DAY));
    expect(t.closed).toHaveLength(1);
    expect((await walletOf(db, AUTHOR)).balance).toBe(2000);
    expect((await getPost(db, r.post.id))!.escrow).toBe(1000);
    // 問題あり → 運営が戻す
    expect(await disputeEntry(db, a.entry.id, C)).toBeUndefined();
    const d = await disputeEntry(db, a.entry.id, A);
    expect(d?.entry.status).toBe('disputed');
    expect(JSON.stringify(entryMessage(d!.entry, d!.post, cfg))).toContain('問題あり');
    // 問題ありは期限でも渡さない・募集した人も完了にできない
    expect((await boardTick(db, cfg, new Date(T0.getTime() + 30 * DAY))).paid).toEqual([]);
    expect((await completeEntry(db, cfg, a.entry.id, AUTHOR, {}, T0)).status).toBe('not_hired');
    const back = await refundEntry(db, a.entry.id, 'staff', T0);
    expect(back?.entry.status).toBe('refunded');
    expect((await walletOf(db, AUTHOR)).balance).toBe(3000);
    expect((await getPost(db, r.post.id))!.escrow).toBe(0);
  });

  it('本人が締め切る・運営が取り下げる。報酬なしの募集は、採用・完了の印だけ', async () => {
    const r = await createPost(db, cfg, member(A), { ...base, reward: 0, slots: 1 }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(await closePost(db, r.post.id, B)).toBeUndefined();
    const b = await applyPost(db, cfg, r.post.id, member(B), T0);
    if (b.status !== 'ok') throw new Error(b.status);
    await hire(db, cfg, b.entry.id, A, T0);
    expect(await completeEntry(db, cfg, b.entry.id, A, {}, T0)).toMatchObject({ status: 'ok', paid: 0 });
    expect((await disputeEntry(db, b.entry.id, A))).toBeUndefined();
    const removed = await closePost(db, r.post.id, 'staff-id', { staff: true }, T0);
    expect(removed?.post.status).toBe('removed');
    expect(JSON.stringify(postCard(removed!.post, [], cfg))).toContain('取り下げ');
  });
});
