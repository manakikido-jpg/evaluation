import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';
import { sql } from 'drizzle-orm';
import type { Db } from '../src/db/client.js';
import { drawOmikujiAuto, omikujiToday } from '../src/services/omikuji.js';
import { addTickets, ticketsOf } from '../src/services/tickets.js';
import { walletOf } from '../src/services/economy.js';
import { cfg, makeDb } from './helpers.js';
import { OmikujiApp } from '../src/discord/omikuji.js';
let db: Db;
let close: () => Promise<void>;
const now = new Date('2026-10-20T03:00:00Z');
const draw = (date = now) => drawOmikujiAuto(db, cfg.economy, 'A', date, () => 0);
beforeEach(async () => { ({ db, close } = await makeDb()); });
afterEach(async () => { vi.useRealTimers(); await close(); });

it('通常分は無料、次の操作で券1枚だけ使い、追加済みなら残りを使わない', async () => {
  await addTickets(db, 'A', 'omikuji_extra', 2);
  const first = await draw();
  expect(first.status).toBe('drawn');
  expect(first).not.toHaveProperty('ticketUsed');
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(2);
  const second = await draw();
  expect(second).toMatchObject({ status: 'drawn', ticketUsed: true, streak: 0, bonus: [] });
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(1);
  expect((await draw()).status).toBe('already');
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(1);
  if (first.status === 'drawn' && second.status === 'drawn') expect((await walletOf(db, 'A')).balance).toBe(first.amount + second.amount);
});
it('券がない日は追加結果も報酬も作らない', async () => {
  await draw(); const balance = (await walletOf(db, 'A')).balance;
  expect((await draw()).status).toBe('already');
  expect(await omikujiToday(db, 'A', now)).toEqual({ drawn: true, extraUsed: false });
  expect((await walletOf(db, 'A')).balance).toBe(balance);
});
it('引き済みの同時操作で、券も追加報酬も一度だけ', async () => {
  await draw(); await addTickets(db, 'A', 'omikuji_extra', 3);
  const results = await Promise.all([draw(), draw(), draw()]);
  expect(results.filter(r => r.status === 'drawn')).toHaveLength(1);
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(2);
});
it('初回の同時操作は券を使わない', async () => {
  await addTickets(db, 'A', 'omikuji_extra', 2);
  const results = await Promise.all([draw(), draw()]);
  expect(results.filter(r => r.status === 'drawn')).toHaveLength(1);
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(2);
});
it('報酬処理が失敗したら券と抽選記録も戻り、再試行できる', async () => {
  await draw(); await addTickets(db, 'A', 'omikuji_extra', 1);
  await db.execute(sql.raw(`CREATE FUNCTION fail_extra() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER fail_extra BEFORE INSERT ON coin_tx FOR EACH ROW EXECUTE FUNCTION fail_extra();`));
  await expect(draw()).rejects.toThrow();
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(1);
  expect((await omikujiToday(db, 'A', now)).extraUsed).toBe(false);
  await db.execute(sql.raw('DROP TRIGGER fail_extra ON coin_tx'));
  expect(await draw()).toMatchObject({ status: 'drawn', ticketUsed: true });
});
it('日本時間の0時で通常分に戻り、翌日の追加にも券を使える', async () => {
  await addTickets(db, 'A', 'omikuji_extra', 2);
  await draw(); await draw();
  const midnight = new Date('2026-10-20T15:00:00Z');
  expect(await draw(midnight)).toMatchObject({ status: 'drawn', streak: 2 });
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(1);
  expect(await draw(midnight)).toMatchObject({ status: 'drawn', ticketUsed: true });
});
it('Discord入口で利用条件を先に確認し、券使用を結果に出す', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const config = { ...cfg, omikujiTexts: { ...cfg.omikujiTexts, shake: false, slip: false }, economy: { ...cfg.economy, omikujiVoiceOnly: true } };
  const controller = new OmikujiApp(db, () => config);
  await draw(); await addTickets(db, 'A', 'omikuji_extra', 1);
  const reply = vi.fn().mockResolvedValue({});
  const guild = { channels: { cache: new Collection() }, afkChannelId: 'afk' };
  const member = { displayName: '利用者', voice: { channelId: null, channel: null }, guild, roles: { cache: new Collection() } };
  const i = { inCachedGuild: () => true, isChatInputCommand: () => false, isButton: () => true, customId: 'omikuji:draw', guild, guildId: cfg.guildId, channelId: 'home', user: { id: 'A' }, member, reply };
  await controller.onInteraction(i as never);
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(1);
  config.economy.omikujiVoiceOnly = false;
  await controller.onInteraction(i as never);
  expect((await ticketsOf(db, 'A')).omikuji_extra).toBe(0);
  expect(JSON.stringify(reply.mock.calls)).toContain('もう1回券を1枚使用');
});
