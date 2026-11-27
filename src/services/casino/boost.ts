import { casinoRoleLimit } from '../perkGate.js';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { CasinoConfig, GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { memberBuffs, members, shopPurchases } from '../../db/schema.js';
import { spendWithin, walletOf } from '../economy.js';
import { isYakudoshi } from '../yakuGate.js';
import { jstDate } from '../activity.js';
import { useTicket } from '../tickets.js';

/**
 * 🎰 大勝負の札: 使うと、その日（日本時間の 0 時まで。設定 boostHours で「○ 時間」にもできる）だけ、カジノの上限が上がる。
 * 上がるのは「1 回の最高」（ルーレットの 1 か所の最高も）と「1 日の合計」（倍率は設定の boostMult。上限ごとに別の倍率にもできる）。
 * 1 日（日本時間）に使えるのは 1 枚だけ（重ねて使えない。設定 boostPerDay は前の名残で、見ない）。
 * 卓の参加費・ブラインド（みんなが同じだけ払うもの）は上げない（札のない人も同じだけ払うため）
 */

const DAY = 86_400_000;

/** 次の日本時間の 0 時 */
export const nextJstMidnight = (now: Date) => new Date(new Date(`${jstDate(now)}T00:00:00+09:00`).getTime() + DAY);

/** 札が効いていれば、終わる時と重ねた枚数（効いていなければ undefined） */
export async function casinoBoostOf(db: Db, memberId: string, now = new Date()): Promise<{ until: Date; level: number; ex: boolean } | undefined> {
  const [row] = await db
    .select({ until: memberBuffs.until, level: memberBuffs.remaining, ex: memberBuffs.ex })
    .from(memberBuffs)
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino'), gt(memberBuffs.until, now)));
  return row?.until ? { until: row.until, level: Math.max(1, row.level), ex: row.ex } : undefined;
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
export function boostCasino(c: CasinoConfig, level = 1, ex = false): CasinoConfig {
  if (c.boostBase) return c;
  const cap = (n: number, rate: number, max: number) => Math.min(n * rate, max);
  // 極の札は、どの上限も boostExMult 倍
  const rate = (base: number | undefined) => (ex ? Math.max(2, c.boostExMult ?? 10) : boostRate(base ?? 0, c.boostMult, level));
  return {
    ...c,
    boostBase: { maxBet: c.maxBet, rouletteMaxBet: c.rouletteMaxBet, dailyBetLimit: c.dailyBetLimit },
    maxBet: cap(c.maxBet, rate(c.boostMaxBetMult), 1_000_000),
    rouletteMaxBet: cap(c.rouletteMaxBet, rate(c.boostRouletteMult), 10_000_000),
    // 0 は「上限なし」のまま
    dailyBetLimit: cap(c.dailyBetLimit, rate(c.boostDailyMult), 100_000_000),
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
  // 👹 厄のあいだは、1日の合計を決まった数（500）までにする。札でも上がらない
  if (cfg.roles.yakudoshi) {
    const [m] = await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, memberId));
    if (m && isYakudoshi(cfg, m.roleIds)) {
      const limit = base.casino.yakuDailyBetLimit;
      return { ...base, casino: { ...base.casino, dailyBetLimit: limit, maxBet: Math.max(base.casino.minBet, Math.min(base.casino.maxBet, limit)) } };
    }
  }
  // 🔥 荒魂・⛩ 参拝者（元氏子も）：新制度では1日の合計が決まった数まで。札でも上がらない
  {
    const [m] = await db.select({ roleIds: members.roleIds }).from(members).where(eq(members.id, memberId));
    const r = m ? await casinoRoleLimit(db, cfg, m.roleIds) : null;
    if (r) {
      // ⛩ 参拝者専用の大勝負の札が効いていれば、1日の合計を上げる（参拝者・元氏子だけ。荒魂は上がらない）
      const limit = r.who === 'sanpaisha' && (await sanpaiBoostUntil(db, memberId, now)) ? Math.max(r.limit, base.casino.sanpaishaBoostDailyBetLimit) : r.limit;
      return { ...base, casino: { ...base.casino, dailyBetLimit: limit, maxBet: Math.max(base.casino.minBet, Math.min(base.casino.maxBet, limit)) } };
    }
  }
  const b = await casinoBoostOf(db, memberId, now);
  return b ? { ...base, casino: boostCasino(base.casino, b.level, b.ex) } : base;
}


export type BoostUse =
  | { status: 'ok'; until: Date; level: number; ex?: boolean; upgraded?: boolean }
  | { status: 'no_ticket' }
  | { status: 'active'; until: Date; level: number; ex?: boolean }
  /** 今日はもう使える枚数まで使った（効いていない） */
  | { status: 'limit' };

/**
 * 札を使う。1 日に使える枚数（boostPerDay）まで。効いている間にもう 1 枚使うと重ねる（1 枚までなら、使わずに active）。
 * 効く長さは、boostHours が 0 なら日本時間の 0 時まで、ほかは使ったときから ○ 時間（重ねても延びない）
 */
export async function useCasinoBoost(db: Db, memberId: string, now = new Date(), c: Partial<Pick<CasinoConfig, 'boostHours' | 'boostPerDay'>> = {}, ex = false): Promise<BoostUse> {
  // 1 日 1 枚だけ（運営の決まり。boostPerDay の設定があっても見ない）
  const perDay = 1;
  void c.boostPerDay;
  const hours = c.boostHours ?? 0;
  return db.transaction(async (tx) => {
    // 同時に押しても、札は 1 枚だけ使う
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`casino_boost:${memberId}`}))`);
    const [row] = await tx.select().from(memberBuffs).where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino')));
    const active = Boolean(row?.until && row.until > now);
    const level = active ? Math.max(1, row!.remaining) : 0;
    const today = jstDate(now);
    const usesToday = row?.day === today ? row.uses : 0;
    // 極の札は、今日ふつうの札しか使っていなければ、上から使える（効いていれば極に上書き。終わる時はそのまま）
    const exToday = row?.day === today && row.ex;
    if (ex && !exToday && usesToday >= 1) {
      if (!(await useTicket(tx, memberId, 'casino_boost_ex'))) return { status: 'no_ticket' as const };
      const until = active ? row!.until! : hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : nextJstMidnight(now);
      const next = { until, remaining: 1, day: today, uses: usesToday + 1, ex: true };
      await tx.update(memberBuffs).set(next).where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino')));
      return { status: 'ok' as const, until, level: 1, ex: true, upgraded: true };
    }
    // それ以外は、ふつうの札と極の札をあわせて 1 日 1 枚
    if (usesToday >= perDay || (active && level >= perDay)) return active ? { status: 'active' as const, until: row!.until!, level, ...(row!.ex ? { ex: true } : {}) } : { status: 'limit' as const };
    if (!(await useTicket(tx, memberId, ex ? 'casino_boost_ex' : 'casino_boost'))) return { status: 'no_ticket' as const };
    const until = active ? row!.until! : hours > 0 ? new Date(now.getTime() + hours * 3_600_000) : nextJstMidnight(now);
    const next = { until, remaining: level + 1, day: today, uses: usesToday + 1, ex };
    await tx
      .insert(memberBuffs)
      .values({ memberId, kind: 'casino', ...next })
      .onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: next });
    return { status: 'ok' as const, until, level: level + 1, ...(ex ? { ex: true } : {}) };
  });
}

// ───────── ⛩ 参拝者専用の大勝負の札（新制度） ─────────

/** 参拝者専用の札が効いていれば、終わる時（効いていなければ undefined） */
export async function sanpaiBoostUntil(db: Db, memberId: string, now = new Date()): Promise<Date | undefined> {
  const [row] = await db.select({ until: memberBuffs.until }).from(memberBuffs)
    .where(and(eq(memberBuffs.memberId, memberId), eq(memberBuffs.kind, 'casino_sanpai'), gt(memberBuffs.until, now)));
  return row?.until ?? undefined;
}

export type SanpaiBoostBuy =
  | { status: 'ok'; until: Date; balance: number; price: number }
  | { status: 'active'; until: Date }
  | { status: 'insufficient'; price: number; balance: number };

/**
 * 参拝者専用の大勝負の札を買う。買ったその場で効きはじめ、日本時間の 0 時まで（1日1枚・持ち物には入らない）。
 * 払うのと効かせるのを同じトランザクションで行う。買える人（参拝者・元氏子）かどうかは呼ぶ側で確かめる。
 */
export async function buySanpaiBoost(db: Db, item: { id: number; name: string; kind: string; price: number }, memberId: string, now = new Date()): Promise<SanpaiBoostBuy> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`casino_boost:${memberId}`}))`);
    const active = await sanpaiBoostUntil(tx as Db, memberId, now);
    if (active) return { status: 'active', until: active } as const;
    if (item.price > 0 && !(await spendWithin(tx as Db, memberId, item.price, 'shop', { itemId: item.id, name: item.name }))) {
      return { status: 'insufficient', price: item.price, balance: (await walletOf(tx as Db, memberId)).balance } as const;
    }
    const until = nextJstMidnight(now);
    const next = { until, remaining: 1, day: jstDate(now), uses: 1, ex: false };
    await tx.insert(memberBuffs).values({ memberId, kind: 'casino_sanpai', ...next }).onConflictDoUpdate({ target: [memberBuffs.memberId, memberBuffs.kind], set: next });
    await tx.insert(shopPurchases).values({ memberId, itemId: item.id, kind: item.kind, price: item.price, expiresAt: until });
    return { status: 'ok', until, balance: (await walletOf(tx as Db, memberId)).balance, price: item.price } as const;
  });
}
