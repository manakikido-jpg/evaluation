import { and, eq, gt, sql } from 'drizzle-orm';
import type { CasinoConfig, GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { memberBuffs } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { useTicket } from '../tickets.js';

/**
 * 🎰 大勝負の札: 使うと、その日（日本時間の 0 時まで。設定 boostHours で「○ 時間」にもできる）だけ、カジノの上限が上がる。
 * 上がるのは「1 回の最高」（ルーレットの 1 か所の最高も）と「1 日の合計」（倍率は設定の boostMult。上限ごとに別の倍率にもできる）。
 * 1 日に使える枚数（boostPerDay）が 2 以上なら、効いている間に重ねて使うと倍率が足される（5 倍 → 10 倍 → 15 倍。効く長さは延びない）。
 * 卓の参加費・ブラインド（みんなが同じだけ払うもの）は上げない（札のない人も同じだけ払うため）
 */

const DAY = 86_400_000;

/** 次の日本時間の 0 時 */
export const nextJstMidnight = (now: Date) => new Date(new Date(`${jstDate(now)}T00:00:00+09:00`).getTime() + DAY);

/** 札が効いていれば、終わる時と重ねた枚数（効いていなければ undefined） */
export async function casinoBoostOf(db: Db, memberId: string, now = new Date()): Promise<{ until: Date; level: number } | undefined> {
  const [row] = await db
    .select({ until: memberBuffs.until, level: memberBuffs.remaining })
    .from(memberBuffs)
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino'), gt(memberBuffs.until, now)));
  return row?.until ? { until: row.until, level: Math.max(1, row.level) } : undefined;
}

/** 札が効いていれば、終わる時（効いていなければ undefined） */
export async function casinoBoostUntil(db: Db, memberId: string, now = new Date()): Promise<Date | undefined> {
  return (await casinoBoostOf(db, memberId, now))?.until;
}

/** 上限ごとの倍率（0 なら boostMult。1 なら上げない）。重ねた枚数ぶん足す */
export const boostRate = (base: number, mult: number, level: number) => {
  const m = base > 0 ? base : mult;
  return m <= 1 ? 1 : m * Math.max(1, level);
};

/** 札を効かせた上限（もう効かせてあれば、そのまま）。level は重ねた枚数 */
export function boostCasino(c: CasinoConfig, level = 1): CasinoConfig {
  if (c.boostBase) return c;
  const cap = (n: number, rate: number, max: number) => Math.min(n * rate, max);
  return {
    ...c,
    boostBase: { maxBet: c.maxBet, rouletteMaxBet: c.rouletteMaxBet, dailyBetLimit: c.dailyBetLimit },
    maxBet: cap(c.maxBet, boostRate(c.boostMaxBetMult ?? 0, c.boostMult, level), 1_000_000),
    rouletteMaxBet: cap(c.rouletteMaxBet, boostRate(c.boostRouletteMult ?? 0, c.boostMult, level), 10_000_000),
    // 0 は「上限なし」のまま
    dailyBetLimit: cap(c.dailyBetLimit, boostRate(c.boostDailyMult ?? 0, c.boostMult, level), 100_000_000),
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
  const b = await casinoBoostOf(db, memberId, now);
  return b ? { ...base, casino: boostCasino(base.casino, b.level) } : base;
}


export type BoostUse =
  | { status: 'ok'; until: Date; level: number }
  | { status: 'no_ticket' }
  | { status: 'active'; until: Date; level: number }
  /** 今日はもう使える枚数まで使った（効いていない） */
  | { status: 'limit' };

/**
 * 札を使う。1 日に使える枚数（boostPerDay）まで。効いている間にもう 1 枚使うと重ねる（1 枚までなら、使わずに active）。
 * 効く長さは、boostHours が 0 なら日本時間の 0 時まで、ほかは使ったときから ○ 時間（重ねても延びない）
 */
export async function useCasinoBoost(db: Db, memberId: string, now = new Date(), c: Partial<Pick<CasinoConfig, 'boostHours' | 'boostPerDay'>> = {}): Promise<BoostUse> {
  const perDay = c.boostPerDay ?? 1;
  const hours = c.boostHours ?? 0;
  return db.transaction(async (tx) => {
    // 同時に押しても、札は 1 枚だけ使う
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`casino_boost:${memberId}`}))`);
    const [row] = await tx.select().from(memberBuffs).where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino')));
    const active = Boolean(row?.until && row.until > now);
    const level = active ? Math.max(1, row!.remaining) : 0;
    const today = jstDate(now);
    const usesToday = row?.day === today ? row.uses : 0;
    if (usesToday >= perDay || (active && level >= perDay)) return active ? { status: 'active' as const, until: row!.until!, level } : { status: 'limit' as const };
    if (!(await useTicket(tx, memberId, 'casino_boost'))) return { status: 'no_ticket' as const };
    const until = active ? row!.until! : hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : nextJstMidnight(now);
    const next = { until, remaining: level + 1, day: today, uses: usesToday + 1 };
    await tx
      .insert(memberBuffs)
      .values({ memberId, kind: 'casino', ...next })
      .onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: next });
    return { status: 'ok' as const, until, level: level + 1 };
  });
}
