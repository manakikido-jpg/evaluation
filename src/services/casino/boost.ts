import { and, eq, gt, sql } from 'drizzle-orm';
import type { CasinoConfig, GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { memberBuffs } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { useTicket } from '../tickets.js';

/**
 * 🎰 大勝負の札: 使うと、その日（日本時間の 0 時まで）だけ、カジノの上限が上がる。
 * 上がるのは「1 回の最高」（ルーレットの 1 か所の最高も）と「1 日の合計」（倍率は設定の boostMult）。
 * 卓の参加費・ブラインド（みんなが同じだけ払うもの）は上げない（札のない人も同じだけ払うため）
 */

const DAY = 86_400_000;

/** 次の日本時間の 0 時 */
export const nextJstMidnight = (now: Date) => new Date(new Date(`${jstDate(now)}T00:00:00+09:00`).getTime() + DAY);

/** 札が効いていれば、終わる時（効いていなければ undefined） */
export async function casinoBoostUntil(db: Db, memberId: string, now = new Date()): Promise<Date | undefined> {
  const [row] = await db
    .select({ until: memberBuffs.until })
    .from(memberBuffs)
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino'), gt(memberBuffs.until, now)));
  return row?.until ?? undefined;
}

/** 札を効かせた上限（もう効かせてあれば、そのまま） */
export function boostCasino(c: CasinoConfig): CasinoConfig {
  if (c.boostBase) return c;
  const m = c.boostMult;
  const cap = (n: number, max: number) => Math.min(n * m, max);
  return {
    ...c,
    boostBase: { maxBet: c.maxBet, rouletteMaxBet: c.rouletteMaxBet, dailyBetLimit: c.dailyBetLimit },
    maxBet: cap(c.maxBet, 1_000_000),
    rouletteMaxBet: cap(c.rouletteMaxBet, 10_000_000),
    // 0 は「上限なし」のまま
    dailyBetLimit: cap(c.dailyBetLimit, 100_000_000),
  };
}

/** 札を効かせる前の上限 */
export function baseCasino(c: CasinoConfig): CasinoConfig {
  if (!c.boostBase) return c;
  const { boostBase, ...rest } = c;
  return { ...rest, ...boostBase };
}

/** その人に使う設定（札が効いていれば上限を上げる。ほかの人の札で上がった設定を渡されても、その人の分で決め直す） */
export async function casinoCfgFor(db: Db, cfg: GuildConfig, memberId: string, now = new Date()): Promise<GuildConfig> {
  const base = cfg.casino.boostBase ? { ...cfg, casino: baseCasino(cfg.casino) } : cfg;
  return (await casinoBoostUntil(db, memberId, now)) ? { ...base, casino: boostCasino(base.casino) } : base;
}


export type BoostUse = { status: 'ok'; until: Date } | { status: 'no_ticket' } | { status: 'active'; until: Date };

/** 札を使う。今日もう効いていれば、使わない（札は減らない） */
export async function useCasinoBoost(db: Db, memberId: string, now = new Date()): Promise<BoostUse> {
  return db.transaction(async (tx) => {
    // 同時に押しても、札は 1 枚だけ使う
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`casino_boost:${memberId}`}))`);
    const [row] = await tx
      .select({ until: memberBuffs.until })
      .from(memberBuffs)
      .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino')));
    if (row?.until && row.until > now) return { status: 'active' as const, until: row.until };
    if (!(await useTicket(tx, memberId, 'casino_boost'))) return { status: 'no_ticket' as const };
    const until = nextJstMidnight(now);
    await tx
      .insert(memberBuffs)
      .values({ memberId, kind: 'casino', until })
      .onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: { until } });
    return { status: 'ok' as const, until };
  });
}
