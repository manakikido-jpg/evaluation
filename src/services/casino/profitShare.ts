import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { adminLevelOf, type GuildConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { casinoGames, casinoProfitShares, members, type CasinoProfitShare } from '../../db/schema.js';
import { jstDate } from '../activity.js';
import { addCoins } from '../economy.js';

/**
 * 💰 カジノの収益の分け前: 日が変わったら（日本時間の 0 時）、前の日の胴元の収支（賭けた − 戻した）が黒字なら、
 * 宮司のロールの人それぞれに、その %（はじめは 25%）を渡す。赤字の日は 0（次の日に持ちこさない）。
 * 1 日に 1 回だけ（casino_profit_shares の行で決める）。この仕組みを入れた日より前の日は渡さない
 */

const DAY = 86_400_000;
const startOf = (date: string) => new Date(`${date}T00:00:00+09:00`);

/** その日（日本時間）の胴元の収支（社務所Web の「日ごとの胴元の収支」と同じ数え方） */
export async function houseProfitOn(db: Db, date: string): Promise<number> {
  const from = startOf(date);
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${casinoGames.bet} - ${casinoGames.payout}), 0)::bigint` })
    .from(casinoGames)
    .where(and(eq(casinoGames.status, 'done'), gte(casinoGames.createdAt, from), lt(casinoGames.createdAt, new Date(from.getTime() + DAY))));
  return Number(row?.n ?? 0);
}

/** 受け取る人: いる人（抜けていない・BOT でない）で、宮司のロールがある人 */
export async function shareRecipients(db: Db, cfg: GuildConfig): Promise<string[]> {
  const rows = await db
    .select({ id: members.id, roleIds: members.roleIds })
    .from(members)
    .where(and(isNull(members.leftAt), eq(members.isBot, false)));
  return rows.filter((m) => adminLevelOf(cfg, m.roleIds) === 'guji').map((m) => m.id).sort();
}

/** 1 人あたり（合計が収支を超えるときは山分け。端数は切り捨て） */
export function shareEach(profit: number, percent: number, people: number): number {
  if (profit <= 0 || percent <= 0 || people <= 0) return 0;
  return Math.min(Math.floor((profit * percent) / 100), Math.floor(profit / people));
}

/**
 * 前の日の分を渡す（まだなら）。新しく決めた行を返す（もう決めてあれば undefined）。
 * はじめて動いたときは、前の日を「始めた日」として渡さずに印を付ける
 */
export async function settleProfitShare(db: Db, cfg: GuildConfig, now = new Date()): Promise<CasinoProfitShare | undefined> {
  const date = jstDate(new Date(now.getTime() - DAY));
  return db.transaction(async (tx) => {
    // 同時に動いても 1 回だけ
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('casino_profit_share'))`);
    const [done] = await tx.select({ date: casinoProfitShares.date }).from(casinoProfitShares).where(eq(casinoProfitShares.date, date));
    if (done) return undefined;
    const [any] = await tx.select({ date: casinoProfitShares.date }).from(casinoProfitShares).limit(1);
    const percent = cfg.casino.profitSharePercent;
    const profit = await houseProfitOn(tx, date);
    const save = async (v: Omit<typeof casinoProfitShares.$inferInsert, 'date' | 'profit' | 'percent'>) => {
      const [row] = await tx.insert(casinoProfitShares).values({ date, profit, percent, ...v }).returning();
      return row!;
    };
    if (!any) return save({ note: 'start' });
    if (percent <= 0) return save({ note: 'off' });
    if (profit <= 0) return save({ note: 'loss' });
    const ids = await shareRecipients(tx, cfg);
    if (!ids.length) return save({ note: 'no_one' });
    const each = shareEach(profit, percent, ids.length);
    if (each <= 0) return save({ note: 'loss' });
    for (const id of ids) await addCoins(tx, id, each, 'casino_share', { date, profit, percent });
    return save({ paid: each * ids.length, recipients: ids.map((memberId) => ({ memberId, amount: each })) });
  });
}

/** 最近の分（新しい順） */
export async function recentProfitShares(db: Db, limit = 60): Promise<CasinoProfitShare[]> {
  return db.select().from(casinoProfitShares).orderBy(desc(casinoProfitShares.date)).limit(limit);
}

const fmt = (n: number) => n.toLocaleString('ja-JP');
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 受け取った人への DM */
export function profitShareDm(row: CasinoProfitShare, amount: number, coin: string): string {
  return `💰 ${md(row.date)} のカジノの収益（胴元の収支 +${fmt(row.profit)} 枚）の ${row.percent}%、${coin} **${fmt(amount)} 枚**が入りました（咲楽ノ宮）。`;
}

/** #記録 に残す文（始めた日・止めているときは出さない） */
export function profitShareLog(row: CasinoProfitShare, coin: string): string | undefined {
  const head = `💰 ${md(row.date)} のカジノの胴元の収支: ${row.profit >= 0 ? '+' : ''}${fmt(row.profit)} 枚`;
  if (row.note === 'start' || row.note === 'off') return undefined;
  if (row.note === 'loss') return `${head}（黒字ではないので、収益の分け前はありません）`;
  if (row.note === 'no_one') return `${head}（宮司のロールの人がいないので、収益の分け前はありません）`;
  return `${head} → 宮司に ${row.percent}% ずつ: ${row.recipients.map((r) => `<@${r.memberId}> ${coin} ${fmt(r.amount)} 枚`).join('・')}`;
}
