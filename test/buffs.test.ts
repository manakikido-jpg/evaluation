import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gachaSchema } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { gachaMenu, useTicketMenu } from '../src/discord/gacha.js';
import { voiceTick } from '../src/services/activity.js';
import {
  buffsOf,
  cancelNameDeco,
  decoratedNick,
  dueNameDecos,
  giftGacha,
  nameDecoOf,
  startNameDeco,
  useFuku,
  useLuck,
  validDecoEmoji,
} from '../src/services/buffs.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { createPrize, deletePrize, drawGacha, ensureGachaPrizes, listPrizes } from '../src/services/gacha.js';
import { addTickets, emptyTickets, ticketsOf } from '../src/services/tickets.js';
import { cfg, makeDb } from './helpers.js';

const U = '830000000000000001';
const B = '830000000000000002';
const T0 = new Date('2026-09-27T12:00:00Z');
const H = 3_600_000;
const g = gachaSchema.parse({});

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => {
  await close();
});

describe('🧧 福の札', () => {
  it('使うと 24 時間、通話でもらえる銭が 2 倍（重ねると 24 時間のびる）', async () => {
    expect(await useFuku(db, U, T0)).toEqual({ status: 'no_ticket' });
    await addTickets(db, U, 'fuku', 2);
    const r = await useFuku(db, U, T0);
    expect(r).toEqual({ status: 'ok', until: new Date(T0.getTime() + 24 * H) });
    expect(await useFuku(db, U, T0)).toEqual({ status: 'ok', until: new Date(T0.getTime() + 48 * H) });
    // 10 分通話: ふつうは voicePer10Min、福の札で 2 倍
    let got: { memberId: string; amount: number }[] = [];
    for (let m = 0; m < 10; m++) got = await voiceTick(db, cfg.economy, [U, B], new Date(T0.getTime() + m * 60_000));
    expect(got).toEqual([
      { memberId: U, amount: cfg.economy.voicePer10Min * 2 },
      { memberId: B, amount: cfg.economy.voicePer10Min },
    ]);
    expect((await buffsOf(db, U, T0)).fukuUntil).toEqual(new Date(T0.getTime() + 48 * H));
    expect((await buffsOf(db, U, new Date(T0.getTime() + 49 * H))).fukuUntil).toBeUndefined();
  });
});

describe('🍀 運気アップの札・🎫 無料券・💝 贈り券', () => {
  it('運気アップ: 次の 10 回は大吉が 2 倍出やすい（使うたびに減る）', async () => {
    await ensureGachaPrizes(db, g);
    await addTickets(db, U, 'luck', 1);
    expect(await useLuck(db, U)).toEqual({ status: 'ok', remaining: 10 });
    await addCoins(db, U, 500, 'adjust');
    // 大吉 3%・中吉 12%… の合計 100 で、大吉だけ 2 倍（6/103）。0.05 は大吉に入る
    const r = await drawGacha(db, g, U, 1, [], () => 0.05);
    expect(r).toMatchObject({ status: 'ok', pulls: [{ tier: 'daikichi', lucky: true }] });
    expect((await buffsOf(db, U)).luck).toBe(9);
  });

  it('無料券で 1 回（銭は減らない・引いた記録の値段は 0）。なければ引けない', async () => {
    await ensureGachaPrizes(db, g);
    expect(await drawGacha(db, g, U, 1, [], () => 0.99, T0, { free: true })).toEqual({ status: 'no_ticket' });
    await addTickets(db, U, 'gacha_free', 1);
    const r = await drawGacha(db, g, U, 1, [], () => 0.99, T0, { free: true });
    expect(r).toMatchObject({ status: 'ok', balance: 0, pulls: [{ tier: 'kichi' }] });
    expect((await ticketsOf(db, U)).gacha_free).toBe(0);
    expect(await drawGacha(db, g, U, 10, [], () => 0.99, T0, { free: true })).toEqual({ status: 'disabled' });
  });

  it('贈り券: 相手に無料券が 1 枚。自分には贈れない', async () => {
    expect(await giftGacha(db, U, B)).toBe('no_ticket');
    await addTickets(db, U, 'gacha_gift', 1);
    expect(await giftGacha(db, U, U)).toBe('self');
    expect(await giftGacha(db, U, B)).toBe('ok');
    expect((await ticketsOf(db, B)).gacha_free).toBe(1);
    expect((await ticketsOf(db, U)).gacha_gift).toBe(0);
  });
});

describe('🏷 名前の飾り', () => {
  it('絵文字 1 つだけ', () => {
    expect(validDecoEmoji('🌸')).toBe(true);
    expect(validDecoEmoji('👨‍👩‍👧')).toBe(true);
    expect(validDecoEmoji('🌸🌸')).toBe(false);
    expect(validDecoEmoji('a')).toBe(false);
    expect(validDecoEmoji('@everyone')).toBe(false);
    expect(decoratedNick('🌸', 'さくら')).toBe('🌸 さくら');
    expect(decoratedNick('🌸', 'あ'.repeat(40))).toHaveLength(32);
  });

  it('7 日間。飾っている間に使うと絵文字を替えてのばす（元の名前は最初のまま）。失敗したら券を戻す', async () => {
    await addTickets(db, U, 'name_deco', 3);
    const a = await startNameDeco(db, U, '🌸', 'さくら', T0);
    expect(a).toEqual({ status: 'ok', until: new Date(T0.getTime() + 7 * 24 * H), baseNick: 'さくら' });
    const b = await startNameDeco(db, U, '🍡', '🌸 さくら', new Date(T0.getTime() + H));
    expect(b).toEqual({ status: 'ok', until: new Date(T0.getTime() + 14 * 24 * H), baseNick: 'さくら' });
    const prev = await nameDecoOf(db, U);
    await startNameDeco(db, U, '🎐', '🍡 さくら', new Date(T0.getTime() + 2 * H));
    await cancelNameDeco(db, U, prev);
    expect(await nameDecoOf(db, U)).toMatchObject({ emoji: '🍡', baseNick: 'さくら' });
    expect((await ticketsOf(db, U)).name_deco).toBe(1);
    expect(await dueNameDecos(db, new Date(T0.getTime() + 13 * 24 * H))).toEqual([]);
    expect((await dueNameDecos(db, new Date(T0.getTime() + 15 * 24 * H))).map((d) => d.memberId)).toEqual([U]);
  });
});

describe('物御籤の画面（札）', () => {
  it('無料券・券を使うボタン、効いている札の表示。使う券のメニュー', async () => {
    await ensureGachaPrizes(db, g);
    const prizes = await listPrizes(db);
    const names = { role: () => undefined, shop: () => undefined };
    const tickets = { ...emptyTickets(), gacha_free: 2, fuku: 1, room_free: 3 };
    const m = gachaMenu(g, prizes, names, { balance: 0, sinceTop: 0, tickets, buffs: { fukuUntil: new Date(T0.getTime() + H), luck: 4 } }, '🪙銭');
    const ids = (m.components[0]!.toJSON().components as { custom_id: string }[]).map((c) => c.custom_id);
    expect(ids).toEqual(['gacha:draw:1', 'gacha:draw:10', 'gacha:draw:free', 'gacha:use']);
    const text = JSON.stringify(m.embeds);
    expect(text).toContain('🧧 福の札');
    expect(text).toContain('あと **4** 回');
    // 券を使うメニュー: 使うと効く札だけ（部屋代の券は出さない）
    const menu = JSON.stringify(useTicketMenu(tickets).components);
    expect(menu).toContain('gacha:usepick');
    expect(menu).toContain('"value":"fuku"');
    expect(menu).toContain('"value":"gacha_free"');
    expect(menu).not.toContain('room_free');
    expect(useTicketMenu(emptyTickets()).components).toEqual([]);
    // 何も持っていなければ、引くボタンだけ
    const none = gachaMenu(g, prizes, names, { balance: 0, sinceTop: 0, tickets: emptyTickets() }, '🪙銭');
    expect((none.components[0]!.toJSON().components as unknown[]).length).toBe(2);
    // 使わない: 中身をすべて消しても落ちない
    for (const p of prizes) await deletePrize(db, p.id);
    await createPrize(db, { tier: 'kichi', kind: 'coins', amount: 10, weight: 1, fallback: false });
    expect(await walletOf(db, U)).toMatchObject({ balance: 0 });
  });
});

describe('🎟 自由な券', () => {
  it('作って物御籤の中身にする → 当たる → 使うと運営が対応するものに出る。リセットで取り上げ', async () => {
    const { createCustomTicket, customHoldingsOf, useCustom, setCustomTicketEnabled } = await import('../src/services/customTickets.js');
    const { listClaims, resetGacha, prizeLabel } = await import('../src/services/gacha.js');
    const t = await createCustomTicket(db, { emoji: '🎤', name: 'リクエスト曲券', note: '運営が 1 曲歌います' });
    await ensureGachaPrizes(db, g);
    for (const p of await listPrizes(db)) await deletePrize(db, p.id);
    const prize = await createPrize(db, { tier: 'kichi', kind: 'custom', customTicketId: t.id, amount: 2, weight: 1, fallback: false });
    expect(prizeLabel(prize, { role: () => undefined, shop: () => undefined, custom: () => t })).toBe('🎤リクエスト曲券 ×2');
    await addCoins(db, U, 500, 'adjust');
    const r = await drawGacha(db, g, U, 1, [], () => 0.5);
    expect(r).toMatchObject({ status: 'ok', pulls: [{ kind: 'custom', custom: { id: t.id, name: '🎤リクエスト曲券', count: 2 } }] });
    expect(await customHoldingsOf(db, U)).toMatchObject([{ ticket: { id: t.id }, count: 2 }]);
    const used = await useCustom(db, U, t.id);
    expect(used).toMatchObject({ status: 'ok', claim: { memberId: U, label: '🎤リクエスト曲券（使った）' } });
    expect((await listClaims(db)).length).toBe(1);
    expect(await useCustom(db, B, t.id)).toEqual({ status: 'no_ticket' });
    // 止めると物御籤には出ない（持っている人は使える）
    await setCustomTicketEnabled(db, t.id, false);
    expect(await drawGacha(db, g, U, 1, [])).toEqual({ status: 'empty' });
    // リセット: 残っている 1 枚を取り上げる
    const reset = await resetGacha(db, T0);
    expect(reset.ticketsTaken).toBe(1);
    expect(await customHoldingsOf(db, U)).toEqual([]);
  });

  it('券を使うメニューに自由な券も出る', async () => {
    const { createCustomTicket } = await import('../src/services/customTickets.js');
    const t = await createCustomTicket(db, { emoji: '📞', name: '運営と通話券', note: '' });
    const menu = JSON.stringify(useTicketMenu(emptyTickets(), [{ ticket: t, count: 1 }]).components);
    expect(menu).toContain(`"value":"custom:${t.id}"`);
    expect(menu).toContain('運営と通話券（1 枚）');
  });
});
