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
});
afterEach(async () => {
  await close();
});

describe('💝 /贈る', () => {
  it('持っている券を贈れる。足りない・自分・役職のない相手・1 段目の人は贈れない', async () => {
    await addTickets(db, A, 'fuku', 3);
    expect(parsePresentItem('fuku')).toEqual({ kind: 'ticket', ticket: 'fuku' });
    expect(parsePresentItem('coins')).toBeUndefined();
    expect(await presentChoices(db, A)).toEqual([{ value: 'fuku', label: '🧧福の札', count: 3 }]);
    const fuku = { kind: 'ticket', ticket: 'fuku' } as const;
    expect((await sendPresent(db, cfg, ujiko(A), ujiko(A), fuku, 1)).status).toBe('self');
    expect((await sendPresent(db, cfg, ujiko(A), { id: B, roleIds: [] }, fuku, 1)).status).toBe('not_member');
    expect((await sendPresent(db, cfg, ujiko(A), { ...ujiko(B), bot: true }, fuku, 1)).status).toBe('not_member');
    expect((await sendPresent(db, cfg, ujiko(A), ujiko(B), fuku, 0)).status).toBe('invalid');
    // 作ったばかりのアカウント（参拝者）からは贈れない
    expect(await sendPresent(db, cfg, { id: A, roleIds: [ROLE.sanpaisha] }, ujiko(B), fuku, 1)).toEqual({ status: 'rank_too_low', rankName: '氏子' });
    expect(await sendPresent(db, cfg, ujiko(A), ujiko(B), fuku, 5)).toEqual({ status: 'not_enough', label: '🧧福の札', have: 3 });
    expect(await sendPresent(db, cfg, ujiko(A), { id: B, roleIds: [ROLE.sanpaisha] }, fuku, 2)).toEqual({ status: 'ok', label: '🧧福の札', count: 2, left: 1 });
    expect((await ticketsOf(db, A)).fuku).toBe(1);
    expect((await ticketsOf(db, B)).fuku).toBe(2);
    // 運営は 1 段目でも贈れる
    expect((await sendPresent(db, cfg, { id: B, roleIds: [ROLE.shinshoku] }, ujiko(A), fuku, 2)).status).toBe('ok');
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
