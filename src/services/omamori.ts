import { newSystemFloor } from './newSystemFloor.js';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { omamoriHoldings, shopPurchases, type ShopItem } from '../db/schema.js';
import { jstWeekStart } from '../domain/ema.js';
import { spendWithin, walletOf } from './economy.js';
import { engawaMinutesBetween } from './sewayakuElection.js';

/**
 * 🧿 お守り（新制度・本人の決定 2026-11-27）。
 * - 授与所で買う（30,000銭＝品物の値段）。1週間（月〜日・日本時間）に縁側で40時間すごした週に1個。今週か先週の分を買える。
 * - 持てるのは3個まで。氏子のキープの判定で足りないとき、自動で1個使って降格を防ぐ（2回つづけては防げない＝ujikoKeep 側）。
 */

const DAY = 86_400_000;
const dayOf = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(new Date(ymd + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);

/** 持っている（まだ使っていない）お守りの数 */
export async function omamoriCount(db: Db, memberId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(omamoriHoldings).where(and(eq(omamoriHoldings.memberId, memberId), isNull(omamoriHoldings.usedAt)));
  return Number(row?.n ?? 0);
}

export type OmamoriStatus = {
  count: number;
  max: number;
  /** 今週の縁側（分）と、要る分 */
  minutes: number;
  need: number;
  /** いま買える週（月曜の日付）。なければ null */
  week: string | null;
  reason?: 'full' | 'time' | 'bought';
};

/** いま買えるか（今週か先週に縁側の時間がそろい、その週の分をまだ買っていない・持てる数に空きがある） */
export async function omamoriStatus(db: Db, cfg: GuildConfig, memberId: string, now = new Date()): Promise<OmamoriStatus> {
  const th = cfg.emaThresholds;
  const thisWeek = jstWeekStart(now);
  const lastWeek = addDays(thisWeek, -7);
  // 縁側の時間は、新制度が始まった日からの分だけ数える
  const floor = (await newSystemFloor(db)).date;
  const from = (d: string) => (d > floor ? d : floor);
  const [held, minutes, lastMinutes, bought] = await Promise.all([
    omamoriCount(db, memberId),
    engawaMinutesBetween(db, memberId, from(thisWeek), dayOf(now)),
    engawaMinutesBetween(db, memberId, from(lastWeek), addDays(thisWeek, -1)),
    db.select({ week: omamoriHoldings.week }).from(omamoriHoldings).where(eq(omamoriHoldings.memberId, memberId)),
  ]);
  const base = { count: held, max: th.omamoriMax, minutes, need: th.omamoriWeekMinutes };
  if (held >= th.omamoriMax) return { ...base, week: null, reason: 'full' };
  const has = new Set(bought.map((b) => b.week));
  const okWeeks = [minutes >= th.omamoriWeekMinutes ? thisWeek : null, lastMinutes >= th.omamoriWeekMinutes ? lastWeek : null].filter((w): w is string => Boolean(w));
  if (!okWeeks.length) return { ...base, week: null, reason: 'time' };
  const week = okWeeks.find((w) => !has.has(w)) ?? null;
  return week ? { ...base, week } : { ...base, week: null, reason: 'bought' };
}

export type OmamoriBuy =
  | { status: 'ok'; count: number; balance: number; price: number }
  | { status: 'insufficient'; price: number; balance: number }
  | { status: 'denied'; s: OmamoriStatus };

/** お守りを買う（払うのと渡すのを同じトランザクションで。同じ週の分は1個だけ） */
export async function buyOmamori(db: Db, cfg: GuildConfig, item: ShopItem, memberId: string, now = new Date()): Promise<OmamoriBuy> {
  const s = await omamoriStatus(db, cfg, memberId, now);
  if (!s.week) return { status: 'denied', s };
  const week = s.week;
  const price = item.price;
  return db.transaction(async (tx) => {
    const got = await tx.insert(omamoriHoldings).values({ memberId, week, boughtAt: now }).onConflictDoNothing().returning({ id: omamoriHoldings.id });
    if (!got.length) return { status: 'denied', s: { ...s, week: null, reason: 'bought' } } as OmamoriBuy;
    if ((await omamoriCount(tx as Db, memberId)) > s.max) throw new Error('omamori over max');
    if (price > 0 && !(await spendWithin(tx as Db, memberId, price, 'shop', { itemId: item.id, name: item.name }))) {
      // 払えなかったら、渡したお守りも戻す
      await tx.delete(omamoriHoldings).where(eq(omamoriHoldings.id, got[0]!.id));
      return { status: 'insufficient', price, balance: (await walletOf(tx as Db, memberId)).balance } as OmamoriBuy;
    }
    await tx.insert(shopPurchases).values({ memberId, itemId: item.id, kind: item.kind, price, expiresAt: null });
    return { status: 'ok', count: await omamoriCount(tx as Db, memberId), balance: (await walletOf(tx as Db, memberId)).balance, price } as OmamoriBuy;
  });
}

/** お守りを1個使う（いちばん古いものから）。持っていなければ false */
export async function consumeOmamori(db: Db, memberId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: omamoriHoldings.id }).from(omamoriHoldings)
      .where(and(eq(omamoriHoldings.memberId, memberId), isNull(omamoriHoldings.usedAt))).orderBy(asc(omamoriHoldings.boughtAt), asc(omamoriHoldings.id)).limit(1).for('update');
    if (!row) return false;
    await tx.update(omamoriHoldings).set({ usedAt: now }).where(eq(omamoriHoldings.id, row.id));
    return true;
  });
}
