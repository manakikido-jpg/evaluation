import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { ticketIntro, ticketPanel } from '../src/discord/supportTickets.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import {
  addTicketMember,
  claimTicket,
  closeTicket,
  deliverTicket,
  isTicketStaff,
  loadTicketConfig,
  openTicket,
  payQuote,
  rateTicket,
  saveTicketConfig,
  setQuote,
  ticketByChannel,
  ticketTick,
  ticketTypeOf,
  touchTicket,
  transcriptText,
  setTicketChannel,
  TICKET_DEFAULTS,
} from '../src/services/supportTickets.js';
import { makeDb } from './helpers.js';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());

const U = '870000000000000101';
const S = '870000000000000102';
const ROLE = '870000000000000201';
const H = 3_600_000;
const T0 = new Date('2026-10-01T00:00:00Z');

describe('🎫 チケット', () => {
  it('はじめの種類（お問い合わせ・相談・役職の希望・スタンプ依頼）。1 人 1 種類 1 つまで・必須の質問', async () => {
    const c = await loadTicketConfig(db);
    expect(c.types.map((t) => t.key)).toEqual(['inquiry', 'soudan', 'role', 'stamp']);
    expect((await openTicket(db, c, { typeKey: 'inquiry', openerId: U, answers: [{ q: '内容', a: ' ' }] })).status).toBe('missing');
    const r = await openTicket(db, c, { typeKey: 'inquiry', openerId: U, answers: [{ q: '内容', a: 'しつもん' }] }, T0);
    expect(r.status).toBe('ok');
    expect((await openTicket(db, c, { typeKey: 'inquiry', openerId: U, answers: [{ q: '内容', a: 'もう一つ' }] })).status).toBe('already');
    // ちがう種類なら開ける
    expect((await openTicket(db, c, { typeKey: 'soudan', openerId: U, answers: [{ q: '相談', a: 'こまった' }] })).status).toBe('ok');
    expect((await openTicket(db, c, { typeKey: 'nope', openerId: U, answers: [] })).status).toBe('no_type');
    // 役職の希望: 選べる役職だけ
    expect((await openTicket(db, c, { typeKey: 'role', openerId: U, answers: [{ q: '理由', a: 'やりたい' }], roleId: ROLE })).status).toBe('bad_role');
    const withRole = { ...c, types: c.types.map((t) => (t.key === 'role' ? { ...t, roleChoices: [ROLE] } : t)) };
    expect((await openTicket(db, withRole, { typeKey: 'role', openerId: U, answers: [{ q: '理由', a: 'やりたい' }], roleId: ROLE })).status).toBe('ok');
  });

  it('担当・人を足す・話した時刻で、放置の知らせと自動で閉じる', async () => {
    const c = { ...TICKET_DEFAULTS, staleHours: 24, idleHours: 72 };
    const r = await openTicket(db, c, { typeKey: 'inquiry', openerId: U, answers: [{ q: '内容', a: 'しつもん' }] }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    await setTicketChannel(db, r.ticket.id, '870000000000000999');
    expect((await ticketByChannel(db, '870000000000000999'))?.id).toBe(r.ticket.id);
    expect((await claimTicket(db, r.ticket.id, S))?.assigneeId).toBe(S);
    expect((await addTicketMember(db, r.ticket.id, '870000000000000103'))?.members).toEqual(['870000000000000103']);
    // 運営の返事がないまま 24 時間 → 1 回だけ知らせる
    expect((await ticketTick(db, c, new Date(T0.getTime() + 23 * H))).stale).toHaveLength(0);
    expect((await ticketTick(db, c, new Date(T0.getTime() + 24 * H))).stale).toHaveLength(1);
    expect((await ticketTick(db, c, new Date(T0.getTime() + 25 * H))).stale).toHaveLength(0);
    // 運営が返事 → 開いた人が 72 時間返事なし → 案内 → さらに 24 時間で閉じる
    const staffAt = new Date(T0.getTime() + 26 * H);
    await touchTicket(db, r.ticket.id, 'staff', staffAt);
    expect((await ticketTick(db, c, new Date(staffAt.getTime() + 72 * H))).idleWarn).toHaveLength(1);
    expect((await ticketTick(db, c, new Date(staffAt.getTime() + 80 * H))).idleClose).toHaveLength(0);
    expect((await ticketTick(db, c, new Date(staffAt.getTime() + 96 * H))).idleClose.map((t) => t.id)).toEqual([r.ticket.id]);
    // 開いた人が話すと、案内は取り消し
    await touchTicket(db, r.ticket.id, 'user', new Date(staffAt.getTime() + 97 * H));
    expect((await ticketTick(db, c, new Date(staffAt.getTime() + 98 * H))).idleClose).toHaveLength(0);
  });

  it('依頼: 見積もり → 払う（預かる）→ 納品で担当に渡す。渡す前に閉じたら戻す。評価は 1 回だけ', async () => {
    const c = TICKET_DEFAULTS;
    await addCoins(db, U, 5000, 'adjust');
    const r = await openTicket(db, c, { typeKey: 'stamp', openerId: U, answers: [{ q: '内容', a: 'ねこ' }, { q: '期限', a: '' }] }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const id = r.ticket.id;
    expect((await payQuote(db, id, U, 1000)).status).toBe('no_quote');
    expect(await setQuote(db, id, S, 0, '1 週間')).toBeUndefined();
    await setQuote(db, id, S, 1000, '1 週間');
    expect((await payQuote(db, id, S, 1000)).status).toBe('not_opener');
    // 古い値段のボタンでは払わない
    expect((await payQuote(db, id, U, 999)).status).toBe('no_quote');
    expect(await payQuote(db, id, U, 1000)).toMatchObject({ status: 'ok', balance: 4000 });
    expect((await payQuote(db, id, U, 1000)).status).toBe('paid');
    // 払ったあとは見積もりを変えない・預かり中は自動で閉じない
    expect(await setQuote(db, id, S, 10, 'x')).toBeUndefined();
    expect(await deliverTicket(db, id)).toMatchObject({ to: S, amount: 1000 });
    expect(await deliverTicket(db, id)).toBeUndefined();
    expect((await walletOf(db, S)).balance).toBe(1000);
    // べつの依頼: 払ってから閉じると戻る
    const r2 = await openTicket(db, { ...c, types: c.types.map((t) => (t.key === 'stamp' ? { ...t, key: 'stamp2' } : t)) }, { typeKey: 'stamp2', openerId: U, answers: [{ q: '内容', a: 'いぬ' }] }, T0);
    if (r2.status !== 'ok') throw new Error(r2.status);
    await setQuote(db, r2.ticket.id, S, 500, '明日');
    await payQuote(db, r2.ticket.id, U, 500);
    expect((await walletOf(db, U)).balance).toBe(3500);
    const closed = await closeTicket(db, r2.ticket.id, S, 'staff', 'やりとり');
    expect(closed?.refunded).toBe(500);
    expect((await walletOf(db, U)).balance).toBe(4000);
    expect(await closeTicket(db, r2.ticket.id, S, 'staff', 'x')).toBeUndefined();
    expect(await rateTicket(db, r2.ticket.id, S, 5)).toBe(false);
    expect(await rateTicket(db, r2.ticket.id, U, 6)).toBe(false);
    expect(await rateTicket(db, r2.ticket.id, U, 4)).toBe(true);
    expect(await rateTicket(db, r2.ticket.id, U, 5)).toBe(false);
  });

  it('設定の保存と読み込み・運営かどうか・パネルと最初のメッセージ・やりとりの文字', async () => {
    const c = await loadTicketConfig(db);
    await saveTicketConfig(db, { ...c, staleHours: 12, types: [...c.types.slice(0, 1), { ...c.types[2]!, roleIds: [ROLE], roleChoices: [ROLE] }] }, S);
    const c2 = await loadTicketConfig(db);
    expect(c2.staleHours).toBe(12);
    expect(c2.types.map((t) => t.key)).toEqual(['inquiry', 'role']);
    const role = ticketTypeOf(c2, 'role')!;
    expect(isTicketStaff(role, [ROLE], [])).toBe(true);
    expect(isTicketStaff(role, ['870000000000000777'], ['870000000000000777'])).toBe(true);
    expect(isTicketStaff(role, [], [])).toBe(false);
    const panel = JSON.stringify(ticketPanel(c2));
    expect(panel).toContain('tk:open');
    expect(panel).toContain('役職の希望');
    const r = await openTicket(db, c2, { typeKey: 'role', openerId: U, answers: [{ q: '理由', a: 'やりたい' }], roleId: ROLE }, T0);
    if (r.status !== 'ok') throw new Error(r.status);
    const intro = ticketIntro(r.ticket, role, '銭');
    expect(JSON.stringify(intro.components)).toContain(`tk:hire:${r.ticket.id}`);
    expect(intro.allowed_mentions).toEqual({ users: [U], roles: [ROLE] });
    const text = transcriptText(r.ticket, role.label, [{ at: T0, author: 'あ', content: 'こんにちは', attachments: [] }]);
    expect(text).toContain('【理由】 やりたい');
    expect(text).toContain('あ: こんにちは');
  });
});
