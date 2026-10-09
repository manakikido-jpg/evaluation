import { afterEach, beforeEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { casinoGames, members, slotSeats } from '../src/db/schema.js';
import { playSlots } from '../src/services/casino/casino.js';
import { atMachineRows, playAt } from '../src/services/casino/slotAtPlay.js';
import { changeSlotSeat, slotSeatViews } from '../src/services/casino/slotSeats.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import { recordJoin } from '../src/services/members.js';
import { cfg as base, makeDb } from './helpers.js';
const A = '760000000000000001', B = '760000000000000002';
const NOW = new Date('2026-10-09T03:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const cfg = { ...base, casino: { ...base.casino, atOpen: true, dailyBetLimit: 0, slotMachines: [1, 1], atMachines: [1, 1] } };
const top = (n: number) => n - 1;
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  for (const id of [A, B]) {
    await addCoins(db, id, 10000, 'adjust');
    await recordJoin(db, { id, username: id, displayName: id === A ? 'あや<b>' : 'べに', avatarUrl: id === A ? 'https://cdn.discordapp.com/avatars/a/icon.png' : null, roleIds: [], isBot: false, joinedAt: NOW });
  }
});
afterEach(async () => close());

it('通常機は同時に座ろうとしても1人だけ。拒否した人の銭やゲームは変わらない', async () => {
  const results = await Promise.all([A, B].map((id) => playSlots(db, cfg, id, 100, top, NOW, 1)));
  expect(results.map((r) => r.status).sort()).toEqual(['occupied', 'ok']);
  expect(await db.select().from(casinoGames)).toHaveLength(1);
  const seats = await slotSeatViews(db, NOW);
  const denied = seats[1]!.memberId === A ? B : A;
  expect((await walletOf(db, denied)).balance).toBe(10000);
  expect((await slotSeatViews(db, at(179999)))[1]).toBeDefined();
  expect((await slotSeatViews(db, at(180000)))[1]).toBeUndefined();
  expect((await playSlots(db, cfg, denied, 100, top, at(180000), 1)).status).toBe('ok');
});

for (const game of ['slots', 'atslot'] as const) {
  const play = (id: string, now: Date, machine = 1) => game === 'slots' ? playSlots(db, cfg, id, 100, top, now, machine) : playAt(db, cfg, id, machine, top, now);
  it(`${game}: 離席は5分だけ。連打で延ばさず、他人の戻る・退席を拒否する`, async () => {
    expect((await play(A, NOW)).status).toBe('ok');
    expect(await changeSlotSeat(db, game, A, 1, 'away', at(60000))).toBe('ok');
    expect(await changeSlotSeat(db, game, A, 1, 'away', at(300000))).toBe('ok');
    expect(await changeSlotSeat(db, game, B, 1, 'leave', at(300000))).toBe('expired');
    expect(await changeSlotSeat(db, game, B, 1, 'return', at(300000))).toBe('expired');
    expect((await play(B, at(359999))).status).toBe('occupied');
    expect((await walletOf(db, B)).balance).toBe(10000);
    expect(await changeSlotSeat(db, game, A, 1, 'return', at(360000))).toBe('expired');
    expect((await play(B, at(360000))).status).toBe('ok');
  });
  it(`${game}: 戻ると離席を終える。本人が退席すればすぐ他の人が回せる`, async () => {
    await play(A, NOW);
    await changeSlotSeat(db, game, A, 1, 'away', at(60000));
    expect(await changeSlotSeat(db, game, A, 1, 'return', at(120000))).toBe('ok');
    expect((await play(B, at(121000))).status).toBe('occupied');
    expect(await changeSlotSeat(db, game, A, 1, 'leave', at(122000))).toBe('ok');
    expect((await play(B, at(123000))).status).toBe('ok');
  });
}

it('通常機を移ると前の席を空ける。未完了の回は離席・退席できない', async () => {
  await playSlots(db, cfg, A, 100, top, NOW, 1);
  await playSlots(db, cfg, A, 100, top, at(1000), 2);
  expect((await slotSeatViews(db, at(1000)))[1]).toBeUndefined();
  expect((await playSlots(db, cfg, B, 100, top, at(1000), 1)).status).toBe('ok');
  await db.insert(casinoGames).values({ memberId: A, game: 'slots', bet: 100, state: {}, status: 'playing' });
  expect(await changeSlotSeat(db, 'slots', A, 2, 'away', at(2000))).toBe('unfinished');
  expect(await changeSlotSeat(db, 'slots', A, 2, 'leave', at(2000))).toBe('unfinished');
  expect((await db.select().from(slotSeats).where(eq(slotSeats.machine, 2)))[0]?.awayUntil).toBeNull();
});

it('AT機も保存されたアイコンを読み、ない人はnullで返す', async () => {
  await playAt(db, cfg, A, 1, top, NOW);
  expect((await atMachineRows(db, cfg))[0]).toMatchObject({ seatBy: A, seatName: 'あや<b>', seatAvatar: 'https://cdn.discordapp.com/avatars/a/icon.png' });
  await db.update(members).set({ avatarUrl: null }).where(eq(members.id, A));
  expect((await atMachineRows(db, cfg))[0]?.seatAvatar).toBeNull();
});
