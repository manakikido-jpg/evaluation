import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { casinoGames, type CasinoTable } from '../src/db/schema.js';
import { lobbyTable, lobbyResumes, visibleLobbyGames, lobbyGameHref } from '../src/services/casino/lobby.js';
import { cfg, makeDb } from './helpers.js';
let db: Db, close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
});
afterEach(async () => close());
const A = '760000000000000001',
  B = '760000000000000002';
const table = (kind: string, state: Record<string, unknown>, status = 'open'): CasinoTable => ({
  id: 1,
  kind,
  state,
  status,
  seatIds: [A],
  version: 1,
  hostId: A,
  createdAt: new Date(),
  updatedAt: new Date(),
  dueAt: null,
});
it('進行中の本人のゲームだけを、新しい順に種類ごとに1つ返す', async () => {
  await db.insert(casinoGames).values([
    { memberId: A, game: 'blackjack', bet: 20, status: 'playing', state: { secret: 'private-deck' } },
    { memberId: A, game: 'blackjack', bet: 20, status: 'playing', state: {} },
    { memberId: B, game: 'highlow', bet: 20, status: 'playing', state: {} },
    { memberId: A, game: 'othello', bet: 20, status: 'done', state: {} },
    { memberId: A, game: 'poker', bet: 20, status: 'playing', state: {} },
  ]);
  const rows = await lobbyResumes(db, A, ['blackjack', 'highlow', 'poker', 'othello']);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({ game: 'blackjack', id: 2 });
  expect(JSON.stringify(rows)).not.toContain('private-deck');
  expect(await lobbyResumes(db, A, ['poker'])).toEqual([]);
});
it('手札を含めず、席数と実際の手番を案内する。閉じた卓と未対応の種類は出さない', () => {
  const t = table('poker', { phase: 'preflop', turn: 0, seats: [{ id: A, hole: [1, 2] }, { id: B }, null, null, null, null], deck: ['private-deck'] });
  const mine = lobbyTable(t, A)!;
  expect(mine).toMatchObject({ players: 2, capacity: 6, seated: true, yourTurn: true, canJoin: false, status: 'あなたの番' });
  expect(lobbyTable(t, 'other')).toMatchObject({ canJoin: true, yourTurn: false });
  expect(JSON.stringify(mine)).not.toContain('private-deck');
  expect(lobbyTable({ ...t, status: 'closed' }, A)).toBeUndefined();
  expect(lobbyTable({ ...t, kind: 'toString' }, A)).toBeUndefined();
  expect(lobbyTable({ ...t, kind: 'future-game' }, A)).toBeUndefined();
});
it('満席と対局開始済みには参加の案内を出さず、三人麻雀の席数も守る', () => {
  const full = table('poker', { phase: 'waiting', seats: Array.from({ length: 6 }, (_, i) => ({ id: String(i) })) });
  expect(lobbyTable(full, B)!.canJoin).toBe(false);
  const mj = table('mahjong', { phase: 'lobby', n: 3, seats: [{ id: A }, { id: B }] });
  expect(lobbyTable(mj, 'other')).toMatchObject({ capacity: 3, canJoin: true });
  expect(lobbyTable({ ...mj, state: { ...(mj.state as object), phase: 'playing' } }, 'other')!.canJoin).toBe(false);
  expect(lobbyTable(table('daifugo', { phase: 'playing', seats: [{ id: A }] }), B)!.canJoin).toBe(false);
});
it('準備中のAT機とゲームのURLを正しく扱う', () => {
  expect(visibleLobbyGames({ ...cfg.casino, games: ['atslot', 'slots'], atOpen: false })).toEqual(['slots']);
  expect(visibleLobbyGames({ ...cfg.casino, games: ['atslot', 'slots'], atOpen: true })).toEqual(['atslot', 'slots']);
  expect(['blackjack', 'poker', 'mahjong', 'versus'].map((g) => lobbyGameHref(g as 'blackjack'))).toEqual([
    '/casino/blackjack',
    '/casino/tables/poker',
    '/casino/jansou',
    '/casino/versus',
  ]);
});
