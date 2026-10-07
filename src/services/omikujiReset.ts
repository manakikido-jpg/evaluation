import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { OmikujiStreakConfig, TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, omikuji, settings } from '../db/schema.js';
import { spendWithin, walletOf } from './economy.js';
import { streakHits, streakOf } from './omikuji.js';
import { useTicket } from './tickets.js';

/**
 * 🔄 その日（日本時間）のおみくじを、引いた全員ぶん引く前に戻す（宮司・社務所Web から。荒らし対策などで変になったとき）。
 * - 引いた記録（その日と「もう 1 回」）を消す → その日にもう一度引ける
 * - その日のおみくじ・続けたおまけで入った銭を取り戻す（もう使っていたら、残っている分まで。マイナスにはしない）
 * - 続けたおまけの券も取り戻す（持っている分まで）。おまけの称号ロールはそのまま（引き直してももう一度は付かない）
 * 銭の出入りは「運営が減らした」（中身に「今日のおみくじのリセット」）。全部を 1 つのトランザクションで行う
 * リセットのあとに引き直して、もう一度リセットしても、前のリセットで数えた銭はもう数えない（銭の出入りの番号で覚えておく）
 */

const COIN_REASONS = ['omikuji', 'omikuji_streak'] as const;
const resetKey = (date: string) => `omikuji_reset:${date}`;

/** その日の前のリセットのときの、銭の出入りのいちばん新しい番号（これより後だけ数える） */
async function lastResetTxId(db: Db, date: string): Promise<number> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, resetKey(date)));
  const n = Number((row?.value as { afterTxId?: unknown } | undefined)?.afterTxId ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type OmikujiResetMember = {
  memberId: string;
  /** 消す記録の数（ふつう 1。「もう 1 回」も引いていれば 2） */
  draws: number;
  /** その日のおみくじで入った銭 */
  coins: number;
  /** 取り戻せる銭（残高まで） */
  take: number;
  /** 取り戻す券（続けたおまけ） */
  tickets: { kind: TicketKind; count: number }[];
};
export type OmikujiResetPlan = { date: string; members: OmikujiResetMember[]; draws: number; coins: number; take: number };

/** 何をするか（まだ何も変えない） */
export async function planOmikujiReset(db: Db, date: string, streak?: OmikujiStreakConfig): Promise<OmikujiResetPlan> {
  const keys = [date, `${date}#2`];
  const rows = await db.select({ memberId: omikuji.memberId, date: omikuji.date }).from(omikuji).where(inArray(omikuji.date, keys));
  const ids = [...new Set(rows.map((r) => r.memberId))].sort();
  const after = await lastResetTxId(db, date);
  const members: OmikujiResetMember[] = [];
  for (const memberId of ids) {
    const [got] = await db
      .select({ n: sql<number>`coalesce(sum(${coinTx.amount}), 0)::int` })
      .from(coinTx)
      .where(and(eq(coinTx.memberId, memberId), gt(coinTx.id, after), inArray(coinTx.reason, [...COIN_REASONS]), inArray(sql`${coinTx.detail}->>'date'`, keys)));
    const coins = Math.max(0, Number(got?.n ?? 0));
    const balance = (await walletOf(db, memberId)).balance;
    // 続けたおまけの券: その日の（もう 1 回でない）記録の連続日数から、もらったおまけを出し直す
    const tickets: { kind: TicketKind; count: number }[] = [];
    if (streak && rows.some((r) => r.memberId === memberId && r.date === date)) {
      const dates = (await db.select({ date: omikuji.date }).from(omikuji).where(eq(omikuji.memberId, memberId))).map((r) => r.date).filter((d) => !d.includes('#') && d <= date);
      for (const b of streakHits(streak, streakOf(dates, date))) if (b.ticket !== 'none' && b.tickets > 0) tickets.push({ kind: b.ticket, count: b.tickets });
    }
    members.push({ memberId, draws: rows.filter((r) => r.memberId === memberId).length, coins, take: Math.min(coins, Math.max(0, balance)), tickets });
  }
  return { date, members, draws: rows.length, coins: members.reduce((n, m) => n + m.coins, 0), take: members.reduce((n, m) => n + m.take, 0) };
}

/** リセットする。もう一度押しても、記録がなければ何もしない（同時に押しても 1 回だけ） */
export async function resetOmikujiDay(db: Db, date: string, streak: OmikujiStreakConfig | undefined, by: string): Promise<OmikujiResetPlan> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`omikuji_reset:${date}`}))`);
    const plan = await planOmikujiReset(tx, date, streak);
    for (const m of plan.members) {
      if (m.take > 0) await spendWithin(tx, m.memberId, m.take, 'admin_take', { note: '今日のおみくじのリセット', date, by });
      for (const t of m.tickets) for (let i = 0; i < t.count; i++) if (!(await useTicket(tx, m.memberId, t.kind))) break;
    }
    if (plan.members.length) {
      await tx.delete(omikuji).where(inArray(omikuji.date, [date, `${date}#2`]));
      const [top] = await tx.select({ id: sql<number>`coalesce(max(${coinTx.id}), 0)::bigint` }).from(coinTx);
      const value = { afterTxId: Number(top?.id ?? 0) };
      await tx.insert(settings).values({ key: resetKey(date), value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    }
    return plan;
  });
}
