import { and, arrayContains, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { GuildConfig, TableKind } from '../../../config.js';
import type { Db } from '../../../db/client.js';
import { casinoGames, casinoTables, coinTx, keibaBets, mahjongResults, type CasinoTable } from '../../../db/schema.js';
import { jstDate } from '../../activity.js';
import { addCoins, spendWithin } from '../../economy.js';
import { todayBets } from '../casino.js';
import { applyKeibaResults, loadRoster } from '../keibaStable.js';
import { cryptoRng, type Rng } from '../cards.js';
import { HOUSE_BOT_ID, isBot } from './bots.js';
import { ENGINES } from './engines.js';
import type { Credit, Ctx, Effects, Form, Step, TableEngine, Who } from './types.js';

/**
 * 卓を動かす。どの操作も「行をロック → 時間の分を進める → 操作 → 銭の出し入れ → 保存」を 1 つのトランザクションで行う。
 * 銭が足りない・1 日の上限を超える引き出しがあれば、全部取り消す。
 */

class Stop extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type TableResult = { status: 'ok'; table: CasinoTable } | { status: string };

const engineOf = (kind: string) => (ENGINES as Record<string, TableEngine<unknown> | undefined>)[kind];

/** 銭を渡す（🏇 最低保証で足す分は 1 人 1 日の上限まで。渡した額を返す） */
export async function payCredit(tx: Db, cfg: GuildConfig, c: Credit, now: Date, kind: string, tableId: number): Promise<number> {
  if (c.amount <= 0) return 0;
  if (c.cap !== 'keiba_purse') {
    await addCoins(tx, c.memberId, c.amount, c.reason, { game: kind, table: tableId });
    return c.amount;
  }
  const limit = cfg.casino.keibaPurseDailyCap;
  const since = new Date(`${jstDate(now)}T00:00:00+09:00`);
  const [got] = await tx
    .select({ n: sql<number>`coalesce(sum(${coinTx.amount}), 0)::int` })
    .from(coinTx)
    .where(and(eq(coinTx.memberId, c.memberId), eq(coinTx.reason, 'keiba_prize'), gte(coinTx.at, since), sql`${coinTx.detail}->>'purse' = 'true'`));
  const pay = limit > 0 ? Math.min(c.amount, Math.max(0, limit - Number(got?.n ?? 0))) : c.amount;
  if (pay > 0) await addCoins(tx, c.memberId, pay, c.reason, { game: kind, table: tableId, purse: true });
  return pay;
}

async function applyFx(tx: Db, cfg: GuildConfig, fx: Effects | undefined, now: Date, tableId: number, kind: string): Promise<void> {
  if (!fx) return;
  // 🤖 BOT の銭は胴元が出す（引かない・渡さない）。収支には鯖が出した分・戻った分として入れる
  const house: { bet: number; payout: number }[] = [];
  for (const d of fx.debits ?? []) if (isBot(d.memberId) && d.amount > 0) house.push({ bet: 0, payout: d.amount });
  for (const c of fx.credits ?? []) if (isBot(c.memberId) && c.amount > 0) house.push({ bet: c.amount, payout: 0 });
  fx = { ...fx, debits: fx.debits?.filter((d) => !isBot(d.memberId)), credits: fx.credits?.filter((c) => !isBot(c.memberId)) };
  for (const h of house) {
    await tx.insert(casinoGames).values({ memberId: HOUSE_BOT_ID, game: kind, bet: h.bet, payout: h.payout, state: { table: tableId, bot: true }, status: 'done', createdAt: now, finishedAt: now });
  }
  const limited = new Map<string, number>();
  for (const d of fx.debits ?? []) if (d.limited) limited.set(d.memberId, (limited.get(d.memberId) ?? 0) + d.amount);
  if (cfg.casino.dailyBetLimit > 0) {
    for (const [memberId, amount] of limited) if ((await todayBets(tx, memberId, now)) + amount > cfg.casino.dailyBetLimit) throw new Stop('limit');
  }
  for (const d of fx.debits ?? []) {
    if (d.amount <= 0) continue;
    if (!(await spendWithin(tx, d.memberId, d.amount, d.reason, { game: kind, table: tableId }))) throw new Stop('poor');
  }
  for (const c of fx.credits ?? []) await payCredit(tx, cfg, c, now, kind, tableId);
  for (const m of fx.mahjong ?? []) await tx.insert(mahjongResults).values({ ...m, tableId, finishedAt: now });
  if (fx.keiba?.length) await applyKeibaResults(tx, fx.keiba, now, cfg.casino.keibaRoyaltyPct);
  if (fx.keibaBets?.length) await tx.insert(keibaBets).values(fx.keibaBets.map((b) => ({ ...b, at: now })));
  for (const r of fx.records ?? []) {
    await tx.insert(casinoGames).values({ memberId: r.memberId, game: r.game, bet: r.bet, payout: r.payout, state: { table: tableId }, status: 'done', createdAt: now, finishedAt: now });
  }
}

/** 時間の分を進める（止まっていた間の分も。何回か続けて） */
function catchUp<S>(engine: TableEngine<S>, state: S, ctx: Ctx, fxs: Effects[]): S {
  let s = state;
  for (let i = 0; i < 30; i++) {
    const due = engine.due(s);
    if (due === null || due > ctx.now) break;
    const r = engine.tick(s, ctx);
    if (!r || !r.ok) break;
    s = r.state;
    if (r.fx) fxs.push(r.fx);
  }
  return s;
}

async function save(tx: Db, t: CasinoTable, engine: TableEngine<unknown>, state: unknown, now: Date): Promise<CasinoTable> {
  const due = engine.due(state);
  const closed = engine.closed(state, now.getTime());
  const [row] = await tx
    .update(casinoTables)
    .set({
      state,
      seatIds: closed ? [] : engine.seats(state),
      version: t.version + 1,
      status: closed ? 'closed' : 'open',
      dueAt: due === null || closed ? null : new Date(due),
      updatedAt: now,
    })
    .where(eq(casinoTables.id, t.id))
    .returning();
  return row!;
}

/** 卓に何かする（op がなければ時間の分だけ進める）。操作が断られても、時間の分は進めて保存する */
export async function onTable(
  db: Db,
  cfg: GuildConfig,
  id: number,
  op: ((engine: TableEngine<unknown>, state: unknown, ctx: Ctx) => Step<unknown>) | null,
  now = new Date(),
  rng: Rng = cryptoRng,
): Promise<TableResult> {
  const run = (withOp: boolean) =>
    db.transaction(async (tx) => {
      const [t] = await tx.select().from(casinoTables).where(eq(casinoTables.id, id)).for('update');
      if (!t || t.status !== 'open') throw new Stop('not_found');
      const engine = engineOf(t.kind);
      if (!engine) throw new Stop('not_found');
      // 🏇 競馬は、次のレースの馬を名簿から選ぶ
      const ctx: Ctx = { now: now.getTime(), rng, cfg, ...(t.kind === 'keiba' ? { roster: await loadRoster(tx, now) } : {}) };
      const fxs: Effects[] = [];
      let state = catchUp(engine, t.state, ctx, fxs);
      let error: string | undefined;
      if (op && withOp) {
        const r = op(engine, state, ctx);
        if (r.ok) {
          if (r.fx) fxs.push(r.fx);
          state = catchUp(engine, r.state, ctx, fxs);
        } else error = r.error;
      }
      if (state === t.state) {
        if (error) throw new Stop(error);
        return t;
      }
      for (const fx of fxs) await applyFx(tx, cfg, fx, now, t.id, t.kind);
      const saved = await save(tx, t, engine, state, now);
      return error ? { saved, error } : saved;
    });
  try {
    const r = await run(true);
    if ('error' in r) return { status: r.error };
    return { status: 'ok', table: r };
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    // 銭が足りない・上限: 操作の分は取り消し、時間の分だけ進める
    if (op && (err.code === 'poor' || err.code === 'limit')) await run(false).catch(() => undefined);
    return { status: err.code };
  }
}

export async function tableById(db: Db, id: number): Promise<CasinoTable | undefined> {
  const [t] = await db.select().from(casinoTables).where(eq(casinoTables.id, id));
  return t;
}

/** その人が座っている卓 */
export async function myTable(db: Db, memberId: string): Promise<CasinoTable | undefined> {
  const [t] = await db
    .select()
    .from(casinoTables)
    .where(and(eq(casinoTables.status, 'open'), arrayContains(casinoTables.seatIds, [memberId])))
    .orderBy(desc(casinoTables.id))
    .limit(1);
  return t;
}

export async function openTables(db: Db, kind?: TableKind): Promise<CasinoTable[]> {
  return db
    .select()
    .from(casinoTables)
    .where(and(eq(casinoTables.status, 'open'), kind ? eq(casinoTables.kind, kind) : undefined))
    .orderBy(desc(casinoTables.id))
    .limit(50);
}

/** 卓を作る（作った人が座る）。1 人 1 卓まで */
export async function createTable(db: Db, cfg: GuildConfig, kind: TableKind, host: Who, form: Form, now = new Date(), rng: Rng = cryptoRng): Promise<TableResult> {
  const engine = engineOf(kind);
  if (!engine) return { status: 'not_found' };
  if (await myTable(db, host.id)) return { status: 'seated' };
  const r = engine.create(host, form, { now: now.getTime(), rng, cfg, ...(kind === 'keiba' ? { roster: await loadRoster(db, now) } : {}) });
  if (!r.ok) return { status: r.error };
  try {
    const row = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(casinoTables)
        .values({ kind, hostId: host.id, state: r.state, seatIds: engine.seats(r.state), dueAt: engine.due(r.state) === null ? null : new Date(engine.due(r.state)!), createdAt: now, updatedAt: now })
        .returning();
      await applyFx(tx, cfg, r.fx, now, t!.id, kind);
      return t!;
    });
    return { status: 'ok', table: row };
  } catch (err) {
    if (err instanceof Stop) return { status: err.code };
    throw err;
  }
}

export async function joinTable(db: Db, cfg: GuildConfig, id: number, who: Who, form: Form, now = new Date(), rng: Rng = cryptoRng): Promise<TableResult> {
  const mine = await myTable(db, who.id);
  if (mine && mine.id !== id) return { status: 'seated' };
  if (mine) return { status: 'ok', table: mine };
  return onTable(db, cfg, id, (e, s, ctx) => e.join(s, who, form, ctx), now, rng);
}

export const leaveTable = (db: Db, cfg: GuildConfig, id: number, memberId: string, now = new Date(), rng: Rng = cryptoRng) =>
  onTable(db, cfg, id, (e, s, ctx) => e.leave(s, memberId, ctx), now, rng);

export const actTable = (db: Db, cfg: GuildConfig, id: number, memberId: string, form: Form, now = new Date(), rng: Rng = cryptoRng) =>
  onTable(db, cfg, id, (e, s, ctx) => e.act(s, memberId, form, ctx), now, rng);

/** 見に来たとき・2 秒ごとに: 時間が来ていれば進める */
export async function pollTable(db: Db, cfg: GuildConfig, id: number, now = new Date(), rng: Rng = cryptoRng): Promise<CasinoTable | undefined> {
  const t = await tableById(db, id);
  if (!t || t.status !== 'open' || !t.dueAt || t.dueAt > now) return t;
  const r = await onTable(db, cfg, id, null, now, rng);
  return r.status === 'ok' && 'table' in r ? r.table : tableById(db, id);
}

/** 時間が来た卓をまとめて進める（ロビーを開いたとき） */
export async function sweepTables(db: Db, cfg: GuildConfig, now = new Date()): Promise<void> {
  const due = await db.select({ id: casinoTables.id }).from(casinoTables).where(and(eq(casinoTables.status, 'open'), lte(casinoTables.dueAt, now))).limit(30);
  for (const t of due) await onTable(db, cfg, t.id, null, now).catch(() => undefined);
}

/** 卓の数（ロビー） */
export async function tableCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ kind: casinoTables.kind, n: sql<number>`count(*)::int` })
    .from(casinoTables)
    .where(and(eq(casinoTables.status, 'open'), inArray(casinoTables.kind, Object.keys(ENGINES))))
    .groupBy(casinoTables.kind);
  return new Map(rows.map((r) => [r.kind, r.n]));
}
