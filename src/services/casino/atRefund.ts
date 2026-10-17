import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { casinoGames, settings } from '../../db/schema.js';
import { addCoins } from '../economy.js';
import { AT_PAYLINES, atGrid } from './slotAt.js';
import type { AtGameState } from './slotAtPlay.js';

/**
 * 🦊 AT 機の補填（2026-10-18 まで、鬼7 やまぜた 7 が 1 本のラインにそろっても白狐目にならなかった）。
 * 記録に残った止まった目から「7 がそろって見えたのに白狐目でなかった回」をさがし、
 * 1 回につき AT 1 回の平均の獲得を渡す。渡した回は覚えておき、2 回は渡さない。
 */

const KEY = 'casino.atSevenRefund';

/** 1 本のラインに 7（白狐7・鬼7）が 3 つ並んでいるか */
export const showsSevens = (stops: number[]) => {
  const g = atGrid(stops);
  return AT_PAYLINES.some((l) => l.rows.every((row, r) => g[r]![row] === 'w7' || g[r]![row] === 'r7'));
};

export type AtRefundRow = { memberId: string; games: number[] };

/** 補填する回（まだ渡していないもの）を人ごとに */
export async function findAtSevenMisses(db: Db): Promise<{ rows: AtRefundRow[]; paid: number[] }> {
  const paid = await paidGames(db);
  const games = await db
    .select({ id: casinoGames.id, memberId: casinoGames.memberId, state: casinoGames.state })
    .from(casinoGames)
    .where(and(eq(casinoGames.game, 'atslot'), eq(casinoGames.status, 'done')))
    .orderBy(casinoGames.id);
  const by = new Map<string, number[]>();
  for (const g of games) {
    const s = g.state as AtGameState;
    if (s.role === 'byakko' || s.waiting || !Array.isArray(s.stops) || !showsSevens(s.stops) || paid.includes(g.id)) continue;
    by.set(g.memberId, [...(by.get(g.memberId) ?? []), g.id]);
  }
  return { rows: [...by].map(([memberId, ids]) => ({ memberId, games: ids })), paid };
}

/** AT 1 回の平均の獲得（AT が終わった回の won の平均。まだなければ 0） */
export async function avgAtWin(db: Db): Promise<{ avg: number; count: number }> {
  const rows = await db.select({ state: casinoGames.state }).from(casinoGames).where(eq(casinoGames.game, 'atslot'));
  const wins = rows.flatMap((r) => ((r.state as AtGameState).events ?? []).flatMap((e) => (e.k === 'at_end' ? [e.won] : [])));
  return { avg: wins.length ? Math.floor(wins.reduce((a, b) => a + b, 0) / wins.length) : 0, count: wins.length };
}

async function paidGames(db: Db): Promise<number[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return (row?.value as { games?: number[] } | undefined)?.games ?? [];
}

/**
 * 補填する（1 回あたり perGame 銭）。まだ渡していない回だけ、同じトランザクションで渡して覚える。
 * 同時に押されても、渡した回の記録の行を先に取るので 1 回だけ
 */
export async function payAtSevenRefund(db: Db, perGame: number, by: string): Promise<{ people: number; games: number; total: number }> {
  if (!Number.isSafeInteger(perGame) || perGame < 1 || perGame > 1_000_000) return { people: 0, games: 0, total: 0 };
  return db.transaction(async (tx) => {
    await tx.insert(settings).values({ key: KEY, value: { games: [] }, updatedBy: by }).onConflictDoNothing();
    const [lock] = await tx.select().from(settings).where(eq(settings.key, KEY)).for('update');
    const done = new Set((lock?.value as { games?: number[] } | undefined)?.games ?? []);
    const { rows } = await findAtSevenMisses(tx as unknown as Db);
    let people = 0;
    let games = 0;
    let total = 0;
    for (const r of rows) {
      const ids = r.games.filter((id) => !done.has(id));
      if (!ids.length) continue;
      const amount = perGame * ids.length;
      await addCoins(tx, r.memberId, amount, 'admin_grant', { note: `AT 機の補填（7 がそろったのに当たらなかった ${ids.length} 回）`, by, atRefundGames: ids });
      ids.forEach((id) => done.add(id));
      people++;
      games += ids.length;
      total += amount;
    }
    await tx.update(settings).set({ value: { games: [...done] }, updatedBy: by, updatedAt: new Date() }).where(eq(settings.key, KEY));
    return { people, games, total };
  });
}
