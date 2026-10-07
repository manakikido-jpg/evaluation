import { addCoins, walletOf } from '../src/services/economy.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { addCustom, createCustomTicket, customHoldingsOf } from '../src/services/customTickets.js';
import { parsePresentItem, presentChoices, sendPresent } from '../src/services/presents.js';
import { addTickets, ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb, ROLE } from './helpers.js';

const A = '870000000000000101';
const B = '870000000000000102';
const ujiko = (id: string) => ({ id, roleIds: [ROLE.ujiko] });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await addCoins(db, A, 1000, 'adjust');
  await addCoins(db, B, 1000, 'adjust');
});
afterEach(async () => {
  await close();
});

describe('💝 /贈る', () => {
  it('持っている券を贈れる。足りない・自分・役職のない相手・1 段目の人は贈れない', async () => {
    await addTickets(db, A, 'fuku', 3);
    expect(parsePresentItem('fuku')).toEqual({ kind: 'ticket', ticket: 'fuku' });
    expect(parsePresentItem('coins')).toBeUndefined();
    expect(await presentChoices(db, A)).toEqual([{ value: 'fuku', label: '🧧福の札', count: 3, note: expect.stringContaining('2 倍'), manual: true }]);
    const fuku = { kind: 'ticket', ticket: 'fuku' } as const;
    expect((await sendPresent(db, cfg, ujiko(A), ujiko(A), fuku, 1)).status).toBe('self');
    expect((await sendPresent(db, cfg, ujiko(A), { id: B, roleIds: [] }, fuku, 1)).status).toBe('not_member');
    expect((await sendPresent(db, cfg, ujiko(A), { ...ujiko(B), bot: true }, fuku, 1)).status).toBe('not_member');
    expect((await sendPresent(db, cfg, ujiko(A), ujiko(B), fuku, 0)).status).toBe('invalid');
    // 役職のない人からは贈れない（参拝者からは贈れる: 下で確かめる）
    expect((await sendPresent(db, cfg, { id: A, roleIds: [] }, ujiko(B), fuku, 1)).status).toBe('no_rank');
    expect(await sendPresent(db, cfg, ujiko(A), ujiko(B), fuku, 5)).toEqual({ status: 'not_enough', label: '🧧福の札', have: 3 });
    expect(await sendPresent(db, cfg, ujiko(A), { id: B, roleIds: [ROLE.sanpaisha] }, fuku, 2)).toEqual({ status: 'ok', label: '🧧福の札', count: 2, left: 1 });
    expect((await ticketsOf(db, A)).fuku).toBe(1);
    expect((await ticketsOf(db, B)).fuku).toBe(2);
    // 参拝者（1 段目）も贈れる
    expect((await sendPresent(db, cfg, { id: B, roleIds: [ROLE.sanpaisha] }, ujiko(A), fuku, 1)).status).toBe('ok');
    // 運営は 1 段目でも贈れる
    expect((await sendPresent(db, cfg, { id: B, roleIds: [ROLE.shinshoku] }, ujiko(A), fuku, 1)).status).toBe('ok');
  });

  it('自由な券も贈れる', async () => {
    const t = await createCustomTicket(db, { emoji: '🎤', name: 'リクエスト曲券', note: '1 曲' });
    await addCustom(db, A, t.id, 2);
    const item = parsePresentItem(`custom:${t.id}`)!;
    expect((await presentChoices(db, A)).map((c) => c.value)).toEqual([`custom:${t.id}`]);
    expect(await sendPresent(db, cfg, ujiko(A), ujiko(B), item, 3)).toMatchObject({ status: 'not_enough', have: 2 });
    expect(await sendPresent(db, cfg, ujiko(A), ujiko(B), item, 2)).toEqual({ status: 'ok', label: '🎤リクエスト曲券', count: 2, left: 0 });
    expect((await customHoldingsOf(db, B)).map((c) => c.count)).toEqual([2]);
    expect(await presentChoices(db, A)).toEqual([]);
  });
});

describe('🎒 /持ち物 の見た目', () => {
  it('一覧から選ぶ。使えるものは「使う」、自動のものは「贈る」だけ。枚数は選ぶだけ', async () => {
    const { itemsView, itemDetail, itemGiveCount, itemGiveConfirm, itemGiveTarget } = await import('../src/discord/presents.js');
    expect(JSON.stringify(itemsView([]))).toContain('持っている券はありません');
    const fuku = { value: 'fuku', label: '🧧福の札', count: 3, note: '2 倍', manual: true };
    const room = { value: 'room_free', label: '🎫部屋代無料券', count: 1, note: '自動', manual: false };
    const custom = { value: 'custom:7', label: '🎤リクエスト曲券', count: 12, note: '1 曲', manual: true };
    const list = JSON.stringify(itemsView([fuku, room]));
    expect(list).toContain('items:pick');
    expect(list).toContain('（使う場面で自動）');
    expect(JSON.stringify(itemDetail(fuku))).toContain('gacha:use1:fuku');
    expect(JSON.stringify(itemDetail(room))).not.toContain('gacha:use1');
    expect(JSON.stringify(itemDetail(room))).toContain('items:give:room_free');
    expect(JSON.stringify(itemGiveTarget(custom))).toContain('items:to:custom:7');
    const to = { id: '870000000000000102', name: 'さくら' };
    const counts = (itemGiveCount(custom, to).components[0]!.components[0] as { options: { value: string; label: string }[] }).options;
    expect(counts.map((o) => o.value)).toEqual(['1', '2', '3', '5', '10', '12']);
    expect(counts.at(-1)!.label).toBe('全部（12 枚）');
    expect(JSON.stringify(itemGiveConfirm(custom, to, 5))).toContain('present:ok:preview');
  });
});


it('持ち物の手数料は1個20銭。残高不足・券不足では移動も徴収もしない', async () => {
  const { spendWithin, recentCoinTx } = await import('../src/services/economy.js');
  await db.transaction(tx => spendWithin(tx, A, 990, 'adjust'));
  await addTickets(db, A, 'fuku', 1);
  const item = { kind: 'ticket', ticket: 'fuku' } as const;
  expect(await sendPresent(db, cfg, ujiko(A), ujiko(B), item, 1)).toEqual({ status: 'insufficient', fee: 20, balance: 10 });
  expect((await ticketsOf(db, A)).fuku).toBe(1);
  expect((await ticketsOf(db, B)).fuku).toBe(0);
  await addCoins(db, A, 30, 'adjust');
  const results = await Promise.all([sendPresent(db, cfg, ujiko(A), ujiko(B), item, 1), sendPresent(db, cfg, ujiko(A), ujiko(B), item, 1)]);
  expect(results.map(r => r.status).sort()).toEqual(['not_enough', 'ok']);
  expect((await walletOf(db, A)).balance).toBe(20);
  expect((await walletOf(db, B)).balance).toBe(1000);
  expect((await ticketsOf(db, B)).fuku).toBe(1);
  expect((await recentCoinTx(db, A)).filter(r => r.reason === 'gift_fee')).toMatchObject([{ amount: -20 }]);
});


it('持ち物の確定ボタンを同時に二度押しても、券と手数料は1回だけ動く', async () => {
  const { PresentApp } = await import('../src/discord/presents.js');
  const app = new PresentApp(db, () => cfg);
  await addTickets(db, A, 'fuku', 3);
  const view = (app as any).confirmHolding(A, { value: 'fuku', label: '福の札', count: 3 }, { id: B, name: 'さくら' }, 1);
  const customId = view.components[0].components[0].custom_id;
  const replies: string[] = [];
  const makeInteraction = () => ({
    inCachedGuild: () => true, guildId: cfg.guildId, isAutocomplete: () => false, isChatInputCommand: () => false,
    isButton: () => true, isRepliable: () => true, customId, user: { id: A }, member: { displayName: 'もみじ', roles: { cache: new Map([[ROLE.ujiko, {}]]) } },
    guild: { members: { fetch: async () => ({ roles: { cache: new Map([[ROLE.ujiko, {}]]) }, user: { bot: false } }) } },
    client: { users: { send: async () => undefined } }, deferUpdate: async () => undefined,
    update: async (p: any) => { replies.push(p.content); }, editReply: async (p: any) => { replies.push(p.content); },
  });
  await Promise.all([app.onInteraction(makeInteraction() as any), app.onInteraction(makeInteraction() as any)]);
  expect((await ticketsOf(db, A)).fuku).toBe(2);
  expect((await ticketsOf(db, B)).fuku).toBe(1);
  expect((await walletOf(db, A)).balance).toBe(980);
  expect(replies.some(r => r.includes('手数料 20'))).toBe(true);
});
