import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { casinoGames } from '../../db/schema.js';
import { jstDate } from '../activity.js';

/**
 * 運営の画面で使う、カジノの日ごとの数字とスロットの設定ごとの結果。
 * 日付は日本時間（created_at に 9 時間足した日）
 */

export type CasinoDay = { date: string; plays: number; wagered: number; paid: number; players: number };

/** 日ごとの回数・賭けた・戻した・遊んだ人（days 日分。遊ばれていない日も 0 で入れる） */
export async function casinoDaily(db: Db, days: number, now = new Date()): Promise<CasinoDay[]> {
  const first = new Date(`${jstDate(new Date(now.getTime() - (days - 1) * 86_400_000))}T00:00:00+09:00`);
  const day = sql<string>`to_char(${casinoGames.createdAt} + interval '9 hours', 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      date: day,
      plays: sql<number>`count(*)::int`,
      wagered: sql<number>`coalesce(sum(${casinoGames.bet}), 0)::bigint`,
      paid: sql<number>`coalesce(sum(${casinoGames.payout}), 0)::bigint`,
      players: sql<number>`count(distinct ${casinoGames.memberId})::int`,
    })
    .from(casinoGames)
    .where(and(eq(casinoGames.status, 'done'), gte(casinoGames.createdAt, first)))
    .groupBy(day);
  const by = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = jstDate(new Date(first.getTime() + i * 86_400_000 + 12 * 3_600_000));
    const r = by.get(date);
    return { date, plays: r?.plays ?? 0, wagered: Number(r?.wagered ?? 0), paid: Number(r?.paid ?? 0), players: r?.players ?? 0 };
  });
}

export type SettingStat = { setting: number; plays: number; wagered: number; paid: number; big: number; reg: number };

/** スロットの設定ごとの結果（since から。設定を記録する前の回は入れない） */
export async function slotSettingStats(db: Db, since: Date): Promise<SettingStat[]> {
  const setting = sql<string | null>`${casinoGames.state}->>'setting'`;
  const role = sql`${casinoGames.state}->>'role'`;
  const rows = await db
    .select({
      setting,
      plays: sql<number>`count(*)::int`,
      wagered: sql<number>`coalesce(sum(${casinoGames.bet}), 0)::bigint`,
      paid: sql<number>`coalesce(sum(${casinoGames.payout}), 0)::bigint`,
      big: sql<number>`count(*) filter (where ${role} = 'big')::int`,
      reg: sql<number>`count(*) filter (where ${role} = 'reg')::int`,
    })
    .from(casinoGames)
    .where(and(eq(casinoGames.game, 'slots'), eq(casinoGames.status, 'done'), gte(casinoGames.createdAt, since)))
    .groupBy(setting);
  return rows
    .filter((r) => r.setting !== null)
    .map((r) => ({ setting: Number(r.setting), plays: r.plays, wagered: Number(r.wagered), paid: Number(r.paid), big: r.big, reg: r.reg }))
    .sort((a, b) => a.setting - b.setting);
}
