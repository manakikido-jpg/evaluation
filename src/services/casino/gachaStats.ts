import { desc, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { casinoStyleDraws } from '../../db/schema.js';

/**
 * 🎴 勝負の御籤の記録（社務所Web の「勝負の御籤」のタブ）: 期間ごとの回数・売上・引いた人、品ごとの出た数、最近の引いた記録
 */

export const GACHA_RANGES = { '1d': { label: '24 時間', days: 1 }, '7d': { label: '7 日', days: 7 }, '30d': { label: '30 日', days: 30 } } as const;
export type GachaRange = keyof typeof GACHA_RANGES;

export type GachaSummary = { range: GachaRange; draws: number; pulls: number; sales: number; players: number };

/** 期間ごとのまとめ（押した回数・引いた数＝10 連は 10・売上・引いた人） */
export async function gachaSummaries(db: Db, now: Date): Promise<GachaSummary[]> {
  const out: GachaSummary[] = [];
  for (const range of Object.keys(GACHA_RANGES) as GachaRange[]) {
    const since = new Date(now.getTime() - GACHA_RANGES[range].days * 86_400_000);
    const [r] = await db
      .select({
        draws: sql<number>`count(*)::int`,
        pulls: sql<number>`coalesce(sum(jsonb_array_length(${casinoStyleDraws.results})), 0)::int`,
        sales: sql<number>`coalesce(sum(${casinoStyleDraws.cost}), 0)::int`,
        players: sql<number>`count(distinct ${casinoStyleDraws.memberId})::int`,
      })
      .from(casinoStyleDraws)
      .where(gte(casinoStyleDraws.at, since));
    out.push({ range, draws: Number(r?.draws ?? 0), pulls: Number(r?.pulls ?? 0), sales: Number(r?.sales ?? 0), players: Number(r?.players ?? 0) });
  }
  return out;
}

/** 品ごとに出た数（その期間） */
export async function gachaItemCounts(db: Db, since: Date): Promise<Map<string, number>> {
  const rows = await db.select({ results: casinoStyleDraws.results }).from(casinoStyleDraws).where(gte(casinoStyleDraws.at, since));
  const out = new Map<string, number>();
  for (const r of rows) for (const key of r.results) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

/** 最近の引いた記録（新しい順） */
export async function recentGachaDraws(db: Db, limit = 50) {
  return db.select().from(casinoStyleDraws).orderBy(desc(casinoStyleDraws.at)).limit(limit);
}
