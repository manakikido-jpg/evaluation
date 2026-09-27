import { count, desc, eq, sql } from 'drizzle-orm';
import { GACHA_TIERS, type GachaConfig, type GachaTier, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { gachaDraws, gachaState } from '../db/schema.js';
import { addCoins, spendWithin, walletOf } from './economy.js';
import { addTickets, ticketsOf } from './tickets.js';

/**
 * 物御籤（もつみくじ）: 花びらで引くくじ。本物のお金は扱わない。
 * 運勢（大吉・中吉・小吉・吉）ごとに、物御籤限定のロール（色守り・称号）や券が出る。
 * 大吉が出ないまま決めた回数目（天井）は必ず大吉。
 */

export const TIER_LABEL: Record<GachaTier, { name: string; emoji: string; color: number }> = {
  daikichi: { name: '大吉', emoji: '🌸', color: 0xd4a017 },
  chukichi: { name: '中吉', emoji: '🏮', color: 0xd7003a },
  shokichi: { name: '小吉', emoji: '🎐', color: 0xe0607e },
  kichi: { name: '吉', emoji: '🍡', color: 0x8fbc8f },
};

type Rand = () => number;

/** 出る割合（%、小数 1 桁まで） */
export function gachaRates(g: Pick<GachaConfig, 'rates'>): Record<GachaTier, number> {
  const total = GACHA_TIERS.reduce((n, t) => n + g.rates[t], 0);
  return Object.fromEntries(GACHA_TIERS.map((t) => [t, total > 0 ? Math.round((g.rates[t] / total) * 1000) / 10 : 0])) as Record<GachaTier, number>;
}

export function pickTier(g: Pick<GachaConfig, 'rates'>, rand: Rand = Math.random): GachaTier {
  const total = GACHA_TIERS.reduce((n, t) => n + g.rates[t], 0);
  let r = rand() * total;
  for (const t of GACHA_TIERS) {
    r -= g.rates[t];
    if (r < 0) return t;
  }
  // 端数のときは、出る運勢のうちいちばん下
  return [...GACHA_TIERS].reverse().find((t) => g.rates[t] > 0) ?? 'kichi';
}

export type GachaPull = { tier: GachaTier; pity: boolean; roleId?: string; ticket?: TicketKind; count: number; coins: number };

export type GachaResult =
  | { status: 'ok'; pulls: GachaPull[]; balance: number; sinceTop: number; total: number; tickets: Record<TicketKind, number> }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'disabled' };

/**
 * 引く（1 回か 10 連）。花びらを払う → 運勢を決める → 券・花びらを渡す → 記録、を 1 つのトランザクションで。
 * ロールを付けるのは呼び出し側（pulls の roleId）。heldRoleIds: 今持っているロール（持っていない限定ロールを優先して出す）
 */
export async function drawGacha(db: Db, g: GachaConfig, memberId: string, times: number, heldRoleIds: readonly string[], rand: Rand = Math.random): Promise<GachaResult> {
  if (!g.enabled || !Number.isInteger(times) || times < 1 || times > 10) return { status: 'disabled' };
  const price = g.price * times;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'gacha:' + memberId}))`);
    if (!(await spendWithin(tx, memberId, price, 'gacha', { times }))) return { status: 'insufficient' as const, price, balance: (await walletOf(tx, memberId)).balance };
    const [state] = await tx.select().from(gachaState).where(eq(gachaState.memberId, memberId));
    let sinceTop = state?.sinceTop ?? 0;
    const owned = new Set(heldRoleIds);
    const pulls: GachaPull[] = [];
    for (let n = 0; n < times; n++) {
      const pity = g.pity > 0 && sinceTop + 1 >= g.pity;
      const tier = pity ? 'daikichi' : pickTier(g, rand);
      sinceTop = tier === 'daikichi' ? 0 : sinceTop + 1;
      const p = g.prizes[tier];
      const pool = p.role ? g.roleIds.filter((r) => !owned.has(r)) : [];
      const pull: GachaPull = { tier, pity, count: 0, coins: p.coins };
      if (pool.length) {
        pull.roleId = pool[Math.floor(rand() * pool.length)]!;
        owned.add(pull.roleId);
      } else if (p.ticket !== 'none' && p.count > 0) {
        pull.ticket = p.ticket;
        pull.count = p.count;
        await addTickets(tx, memberId, p.ticket, p.count);
      }
      if (p.coins > 0) await addCoins(tx, memberId, p.coins, 'gacha_prize', { tier });
      pulls.push(pull);
    }
    const total = (state?.total ?? 0) + times;
    await tx
      .insert(gachaState)
      .values({ memberId, sinceTop, total })
      .onConflictDoUpdate({ target: gachaState.memberId, set: { sinceTop, total, updatedAt: new Date() } });
    await tx
      .insert(gachaDraws)
      .values(
        pulls.map((p) => ({
          memberId,
          tier: p.tier,
          pity: p.pity,
          price: g.price,
          roleId: p.roleId ?? null,
          ticket: p.ticket ?? null,
          ticketCount: p.count,
          coins: p.coins,
        })),
      );
    return { status: 'ok' as const, pulls, balance: (await walletOf(tx, memberId)).balance, sinceTop, total, tickets: await ticketsOf(tx, memberId) };
  });
}

/** 自分の回数（天井まであと何回） */
export async function gachaStateOf(db: Db, memberId: string): Promise<{ sinceTop: number; total: number }> {
  const [row] = await db.select().from(gachaState).where(eq(gachaState.memberId, memberId));
  return { sinceTop: row?.sinceTop ?? 0, total: row?.total ?? 0 };
}

/** 天井まであと何回（天井なしは undefined） */
export const untilPity = (g: Pick<GachaConfig, 'pity'>, sinceTop: number) => (g.pity > 0 ? Math.max(1, g.pity - sinceTop) : undefined);

/** 管理画面: 運勢ごとの回数と、使われた花びら */
export async function gachaStats(db: Db): Promise<{ total: number; spent: number; byTier: Record<GachaTier, number>; players: number }> {
  const rows = await db
    .select({ tier: gachaDraws.tier, n: count(), spent: sql<number>`coalesce(sum(${gachaDraws.price}), 0)::int` })
    .from(gachaDraws)
    .groupBy(gachaDraws.tier);
  const byTier = Object.fromEntries(GACHA_TIERS.map((t) => [t, rows.find((r) => r.tier === t)?.n ?? 0])) as Record<GachaTier, number>;
  const [players] = await db.select({ n: count() }).from(gachaState);
  return { total: rows.reduce((n, r) => n + r.n, 0), spent: rows.reduce((n, r) => n + r.spent, 0), byTier, players: players?.n ?? 0 };
}

/** 最近の大吉（管理画面） */
export async function recentTopDraws(db: Db, limit = 20) {
  return db.select().from(gachaDraws).where(eq(gachaDraws.tier, 'daikichi')).orderBy(desc(gachaDraws.createdAt)).limit(limit);
}
