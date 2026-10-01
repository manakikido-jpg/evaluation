import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GuildConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { casinoGames, casinoMatches } from '../src/db/schema.js';
import { addCoins, walletOf } from '../src/services/economy.js';
import type { Rng } from '../src/services/casino/cards.js';
import {
  actBlackjack,
  actHighLow,
  actOthello,
  activeGame,
  aimSlots,
  bigWins,
  casinoStats,
  checkBet,
  playBaccarat,
  playRoulette,
  playSlots,
  startBlackjack,
  startHighLow,
  startOthello,
  todayBets,
} from '../src/services/casino/casino.js';
import type { BjState } from '../src/services/casino/blackjack.js';
import { legalMoves } from '../src/services/casino/othello.js';
import { REELS, SLIP } from '../src/services/casino/slots.js';
import { cancelMatch, createMatch, joinMatch, MOVE_SECONDS, moveMatch, myMatch, OPEN_MINUTES, readMatch, resignMatch, sweepMatches } from '../src/services/casino/versus.js';
import { cfg, makeDb } from './helpers.js';

const A = '870000000000000001';
const B = '870000000000000002';
const C = '870000000000000003';
const NOW = new Date('2026-10-01T12:00:00+09:00');
const seq = (xs: number[]): Rng => {
  let i = 0;
  return (n) => xs[i++ % xs.length]! % n;
};
const card = (r: number, s = 0) => s * 13 + r - 1;
const ccfg = (patch: Partial<GuildConfig['casino']> = {}): GuildConfig => ({ ...cfg, casino: { ...cfg.casino, ...patch } });

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await makeDb());
  await addCoins(db, A, 5000, 'admin_grant');
  await addCoins(db, B, 5000, 'admin_grant');
});
afterEach(async () => {
  await close();
});
const bal = async (id: string) => (await walletOf(db, id)).balance;

describe('🎰 カジノ: 賭けの決まり', () => {
  it('お休み・止めたゲーム・賭けの量・1 日の上限・残高', async () => {
    expect(await checkBet(db, ccfg({ enabled: false }), A, 'slots', 100, NOW)).toBe('closed');
    expect(await checkBet(db, ccfg({ games: ['blackjack'] }), A, 'slots', 100, NOW)).toBe('game_off');
    expect(await checkBet(db, ccfg(), A, 'slots', 5, NOW)).toBe('bad_bet');
    expect(await checkBet(db, ccfg(), A, 'slots', 1001, NOW)).toBe('bad_bet');
    expect(await checkBet(db, ccfg(), C, 'slots', 100, NOW)).toBe('poor');
    const lim = ccfg({ dailyBetLimit: 250 });
    await playSlots(db, lim, A, 100, seq([65000, 7, 20]), NOW);
    await playSlots(db, lim, A, 100, seq([65000, 7, 20]), NOW);
    expect(await todayBets(db, A, NOW)).toBe(200);
    expect(await checkBet(db, lim, A, 'slots', 100, NOW)).toBe('limit');
    expect(await checkBet(db, lim, A, 'slots', 50, NOW)).toBe('ok');
    // 次の日はまた賭けられる
    expect(await checkBet(db, lim, A, 'slots', 100, new Date(NOW.getTime() + 86_400_000))).toBe('ok');
  });
});

describe('🎰 カジノ: 1 回で終わるゲーム', () => {
  it('スロット: 小役はその回に払う・はずれは 0', async () => {
    // 1000 / 65536 はぶどう（×2.5）
    const win = await playSlots(db, ccfg(), A, 10, seq([1000, 3, 5, 7]), NOW);
    expect(win.status === 'ok' && win.row.status).toBe('done');
    expect(await bal(A)).toBe(5000 - 10 + 25);
    const lose = await playSlots(db, ccfg(), A, 10, seq([65000, 9, 16]), NOW);
    expect(lose.status === 'ok' && lose.row.payout).toBe(0);
    expect(await bal(A)).toBe(5000 - 20 + 25);
  });

  it('スロット: BIG を引いたら持ち越し。7 を狙ってそろえたら払う（狙う回は賭けない）', async () => {
    const r = await playSlots(db, ccfg(), A, 100, seq([0, 1, 2, 3, 4, 5]), NOW);
    expect(r.status).toBe('ok');
    const row = r.status === 'ok' ? r.row : undefined!;
    expect(row.status).toBe('playing');
    expect(row.payout).toBe(0);
    expect(await bal(A)).toBe(4900);
    // 持っている間は新しく回せない
    expect((await playSlots(db, ccfg(), A, 100, seq([1000]), NOW)).status).toBe('busy');
    const at7 = REELS.map((x) => x.indexOf('seven'));
    // 遠い所で押すと、はずれて持ち越し
    const miss = await aimSlots(db, row.id, A, at7.map((x) => (x + SLIP + 3) % 21), NOW);
    expect(miss.status === 'ok' && miss.row.status).toBe('playing');
    expect(await bal(A)).toBe(4900);
    expect((await aimSlots(db, row.id, A, [1, 2], NOW)).status).toBe('invalid');
    expect((await aimSlots(db, row.id, B, at7, NOW)).status).toBe('not_found');
    // 少し手前で押せば、すべってそろう
    const hit = await aimSlots(db, row.id, A, at7.map((x) => (x + 2) % 21), NOW);
    expect(hit.status === 'ok' && hit.row.status).toBe('done');
    expect(hit.status === 'ok' && hit.row.payout).toBe(8000);
    expect(await bal(A)).toBe(4900 + 8000);
    expect((await aimSlots(db, row.id, A, at7, NOW)).status).toBe('done');
    expect((await bigWins(db, new Date(NOW.getTime() - 3_600_000))).map((g) => g.payout)).toEqual([8000]);
  });

  it('スロット: REG はおまかせでもそろう', async () => {
    const r = await playSlots(db, ccfg(), A, 10, seq([300, 1, 2, 3]), NOW);
    const row = r.status === 'ok' ? r.row : undefined!;
    expect(row.status).toBe('playing');
    const done = await aimSlots(db, row.id, A, 'assist', NOW);
    expect(done.status === 'ok' && done.row.payout).toBe(300);
    expect(await bal(A)).toBe(5000 - 10 + 300);
  });

  it('ルーレット: いくつもの所に賭けられる（当たった所だけ払う）。1 か所ごとに最低〜最高', async () => {
    const r = await playRoulette(db, ccfg(), A, [{ on: 'n7', amount: 50 }, { on: 'red', amount: 100 }, { on: 'black', amount: 100 }], seq([7]), NOW);
    expect(r.status === 'ok' && r.row).toMatchObject({ bet: 250, payout: 50 * 36 + 200 });
    expect(await bal(A)).toBe(5000 - 250 + 2000);
    expect((await playRoulette(db, ccfg(), A, [{ on: 'red', amount: 5 }], seq([7]), NOW)).status).toBe('bad_bet');
    // 1 か所は最高まで、合計は最高 × 10 まで
    expect((await playRoulette(db, ccfg(), A, [{ on: 'red', amount: 1000 }, { on: 'black', amount: 1000 }], seq([0]), NOW)).status).toBe('ok');
  });

  it('ルーレット・バカラ', async () => {
    const r = await playRoulette(db, ccfg(), A, [{ on: 'n17', amount: 100 }], seq([17]), NOW);
    expect(r.status === 'ok' && r.row.payout).toBe(3600);
    // プレイヤー 9 / バンカー 5 → プレイヤーの勝ち
    const b = await playBaccarat(db, ccfg(), B, 100, 'banker', seq([card(9), card(13), card(2), card(3)]), NOW);
    expect(b.status === 'ok' && b.row.payout).toBe(0);
    expect(await bal(A)).toBe(5000 - 100 + 3600);
    expect(await bal(B)).toBe(4900);
    const stats = await casinoStats(db, new Date(NOW.getTime() - 3_600_000));
    expect(stats.find((s) => s.game === 'roulette')).toMatchObject({ plays: 1, wagered: 100, paid: 3600 });
  });
});

describe('🃏 ブラックジャック（DB）', () => {
  it('途中から続けられる・同じ種類は 1 つだけ・ダブルダウンは賭けを足す', async () => {
    const s = await startBlackjack(db, ccfg(), A, 100, seq([0]), NOW);
    expect(s.status).toBe('ok');
    const row = s.status === 'ok' ? s.row : undefined!;
    // 分かりやすい手に差し替える（人 5+6 / ディーラー 10+7 / 次は 10）
    const st: BjState = { player: [card(5), card(6)], dealer: [card(10), card(7)], deck: [card(10)], doubled: false, phase: 'player' };
    await db.update(casinoGames).set({ state: st, status: 'playing', payout: 0 }).where(eq(casinoGames.id, row.id));
    expect((await startBlackjack(db, ccfg(), A, 100, seq([0]), NOW)).status).toBe('busy');
    expect((await activeGame(db, A, 'blackjack'))?.id).toBe(row.id);
    const before = await bal(A);
    const d = await actBlackjack(db, ccfg(), row.id, A, 'double', NOW);
    expect(d.status).toBe('ok');
    expect(d.status === 'ok' && d.row).toMatchObject({ status: 'done', bet: 200, payout: 400 });
    expect(await bal(A)).toBe(before - 100 + 400);
    // 終わったゲームはもう動かない・ほかの人は動かせない
    expect((await actBlackjack(db, ccfg(), row.id, A, 'hit', NOW)).status).toBe('done');
    expect((await actBlackjack(db, ccfg(), row.id, B, 'hit', NOW)).status).toBe('not_found');
  });

  it('同時に押しても 1 回だけ払う', async () => {
    const s = await startBlackjack(db, ccfg(), A, 100, seq([0]), NOW);
    const row = s.status === 'ok' ? s.row : undefined!;
    const st: BjState = { player: [card(10), card(9)], dealer: [card(10), card(7)], deck: [], doubled: false, phase: 'player' };
    await db.update(casinoGames).set({ state: st, status: 'playing', payout: 0 }).where(eq(casinoGames.id, row.id));
    const before = await bal(A);
    const rs = await Promise.all([actBlackjack(db, ccfg(), row.id, A, 'stand', NOW), actBlackjack(db, ccfg(), row.id, A, 'stand', NOW)]);
    expect(rs.filter((r) => r.status === 'ok')).toHaveLength(1);
    expect(await bal(A)).toBe(before + 200);
  });
});

describe('🔼 ハイ＆ロー（DB）', () => {
  it('当てて降りると倍率分、外れたら 0', async () => {
    const s = await startHighLow(db, ccfg(), A, 100, seq([card(5)]), NOW);
    const row = s.status === 'ok' ? s.row : undefined!;
    const g = await actHighLow(db, row.id, A, 'high', seq([card(10)]), NOW);
    expect(g.status === 'ok' && g.row.status).toBe('playing');
    const out = await actHighLow(db, row.id, A, 'cashout', seq([0]), NOW);
    expect(out.status === 'ok' && out.row.payout).toBe(Math.floor((100 * Math.floor((1000 * 0.95 * 13) / 8)) / 1000));
    const s2 = await startHighLow(db, ccfg(), A, 100, seq([card(5)]), NOW);
    const r2 = s2.status === 'ok' ? s2.row : undefined!;
    const lost = await actHighLow(db, r2.id, A, 'high', seq([card(5, 1)]), NOW);
    expect(lost.status === 'ok' && lost.row).toMatchObject({ status: 'done', payout: 0 });
    expect((await actHighLow(db, r2.id, A, 'cashout', seq([0]), NOW)).status).toBe('done');
  });
});

describe('⚫ オセロ CPU（DB）', () => {
  it('打つと CPU も打つ。投了は 0。置けない手は断る', async () => {
    const s = await startOthello(db, ccfg(), A, 100, 'easy', 'B', seq([0]), NOW);
    const row = s.status === 'ok' ? s.row : undefined!;
    expect((await actOthello(db, row.id, A, 0, seq([0]), NOW)).status).toBe('invalid');
    const m = await actOthello(db, row.id, A, 19, seq([0]), NOW);
    expect(m.status).toBe('ok');
    const board = (m.status === 'ok' ? m.row.state : {}) as { board: string; turn: string };
    expect(board.turn).toBe('B');
    expect(board.board.split('').filter((c) => c !== '.')).toHaveLength(6);
    const r = await actOthello(db, row.id, A, 'resign', seq([0]), NOW);
    expect(r.status === 'ok' && r.row).toMatchObject({ status: 'done', payout: 0 });
  });

  it('白を選ぶと CPU が先に打つ', async () => {
    const s = await startOthello(db, ccfg(), A, 100, 'normal', 'W', seq([0]), NOW);
    const st = (s.status === 'ok' ? s.row.state : {}) as { board: string; turn: string };
    expect(st.turn).toBe('W');
    expect(legalMoves(st.board, 'W').length).toBeGreaterThan(0);
  });
});

describe('⚔ メンバー対戦', () => {
  it('両方から預かり、勝った人が総取り', async () => {
    const c = await createMatch(db, ccfg(), A, 200, NOW);
    expect(c.status).toBe('ok');
    const id = c.status === 'ok' ? c.match.id : 0;
    expect(await bal(A)).toBe(4800);
    expect((await createMatch(db, ccfg(), A, 100, NOW)).status).toBe('busy');
    expect((await joinMatch(db, ccfg(), id, A, NOW)).status).toBe('self');
    expect((await joinMatch(db, ccfg(), id, C, NOW)).status).toBe('poor');
    const j = await joinMatch(db, ccfg(), id, B, NOW);
    expect(j.status).toBe('ok');
    expect(await bal(B)).toBe(4800);
    expect((await joinMatch(db, ccfg(), id, C, NOW)).status).toBe('not_found');
    // 白は先に置けない・黒は置ける
    expect((await moveMatch(db, id, B, 19, NOW)).status).toBe('invalid');
    expect((await moveMatch(db, id, A, 19, NOW)).status).toBe('ok');
    expect((await moveMatch(db, id, C, 18, NOW)).status).toBe('not_yours');
    const r = await resignMatch(db, id, B, NOW);
    expect(r.status === 'ok' && r.match).toMatchObject({ status: 'done', winnerId: A, endReason: 'resign' });
    expect(await bal(A)).toBe(5200);
    expect(await bal(B)).toBe(4800);
    expect(await myMatch(db, A)).toBeUndefined();
  });

  it('相手待ちは閉じると返る。来ないまま時間がたっても返る', async () => {
    const c = await createMatch(db, ccfg(), A, 300, NOW);
    const id = c.status === 'ok' ? c.match.id : 0;
    expect((await cancelMatch(db, id, B, NOW)).status).toBe('not_yours');
    expect((await cancelMatch(db, id, A, NOW)).status).toBe('ok');
    expect(await bal(A)).toBe(5000);
    const c2 = await createMatch(db, ccfg(), A, 300, NOW);
    const id2 = c2.status === 'ok' ? c2.match.id : 0;
    await sweepMatches(db, new Date(NOW.getTime() + (OPEN_MINUTES + 1) * 60_000));
    expect((await readMatch(db, id2))?.endReason).toBe('expired');
    expect(await bal(A)).toBe(5000);
  });

  it('1 手の持ち時間を長くできる（10 分なら 2 分では負けにならない）', async () => {
    expect((await createMatch(db, ccfg(), A, 0, NOW, 45)).status).toBe('invalid');
    const c = await createMatch(db, ccfg(), A, 0, NOW, 600);
    const id = c.status === 'ok' ? c.match.id : 0;
    await joinMatch(db, ccfg(), id, B, NOW);
    await moveMatch(db, id, A, 19, NOW);
    expect((await readMatch(db, id, new Date(NOW.getTime() + 300_000)))?.status).toBe('playing');
    await sweepMatches(db, new Date(NOW.getTime() + 300_000));
    expect((await readMatch(db, id, new Date(NOW.getTime() + 300_000)))?.status).toBe('playing');
    expect(await readMatch(db, id, new Date(NOW.getTime() + 601_000))).toMatchObject({ status: 'done', winnerId: A, endReason: 'timeout' });
  });

  it('持ち時間を過ぎたら、置く番の人の負け。0 銭の対戦もできる', async () => {
    const c = await createMatch(db, ccfg(), A, 0, NOW);
    const id = c.status === 'ok' ? c.match.id : 0;
    await joinMatch(db, ccfg(), id, C, NOW);
    await moveMatch(db, id, A, 19, NOW);
    const later = new Date(NOW.getTime() + (MOVE_SECONDS + 5) * 1000);
    const m = await readMatch(db, id, later);
    expect(m).toMatchObject({ status: 'done', winnerId: A, endReason: 'timeout' });
    expect(await bal(C)).toBe(0);
    const [row] = await db.select().from(casinoMatches);
    expect(row!.bet).toBe(0);
  });
});
