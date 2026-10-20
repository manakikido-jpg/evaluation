import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { CoreTimeConfig, GuildConfig } from '../config.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { guildChannelsCached } from './notices.js';
import type { Db } from '../db/client.js';
import { coreTimeAttendance } from '../db/schema.js';
import { activeCoreTime, jstParts } from './coreTime.js';
import { addCoins } from './economy.js';

/**
 * ⏰ コアタイムに通話に上がった人の記録。
 * - 毎分（BOT の 1 分ごとの仕事）、コアタイム中なら、通話にいる人（花びらがもらえる人と同じ: AFK・BOT などはのぞく）に 1 分ずつ足す
 * - 枠（日付と始まりの時刻）ごとに 1 人 1 行。はじめて来た時刻・最後にいた時刻も残す
 */

/** いまコアタイムなら、ids の人に 1 分ずつ足す。足した枠を返す */
export async function recordCoreTime(db: Db, ct: CoreTimeConfig, ids: readonly string[], now: Date): Promise<{ day: string; slot: string } | undefined> {
  const slot = activeCoreTime(ct, now);
  if (!slot || !ids.length) return undefined;
  const day = jstParts(now).date;
  const rows = [...new Set(ids)].map((memberId) => ({ day, slot: slot.start, memberId, minutes: 1, firstAt: now, lastAt: now }));
  await db
    .insert(coreTimeAttendance)
    .values(rows)
    .onConflictDoUpdate({
      target: [coreTimeAttendance.day, coreTimeAttendance.slot, coreTimeAttendance.memberId],
      set: { minutes: sql`${coreTimeAttendance.minutes} + 1`, lastAt: now },
    });
  return { day, slot: slot.start };
}

/** 最近のコアタイム（新しい順）: 来た人の数・合計の分 */
export async function coreTimeSessions(db: Db, sinceDay: string) {
  return db
    .select({ day: coreTimeAttendance.day, slot: coreTimeAttendance.slot, people: sql<number>`count(*)::int`, minutes: sql<number>`coalesce(sum(${coreTimeAttendance.minutes}), 0)::int` })
    .from(coreTimeAttendance)
    .where(gte(coreTimeAttendance.day, sinceDay))
    .groupBy(coreTimeAttendance.day, coreTimeAttendance.slot)
    .orderBy(desc(coreTimeAttendance.day), desc(coreTimeAttendance.slot));
}

/** 1 回のコアタイムに来た人（長くいた順） */
export async function coreTimeMembers(db: Db, day: string, slot: string) {
  return db
    .select()
    .from(coreTimeAttendance)
    .where(and(eq(coreTimeAttendance.day, day), eq(coreTimeAttendance.slot, slot)))
    .orderBy(desc(coreTimeAttendance.minutes), coreTimeAttendance.firstAt);
}

/** よく来る人（その日から）: 来た回数・合計の分・最後に来た日。minMinutes 分より短い回は数えない */
export async function coreTimeRegulars(db: Db, sinceDay: string, minMinutes = 1) {
  return db
    .select({
      memberId: coreTimeAttendance.memberId,
      times: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${coreTimeAttendance.minutes}), 0)::int`,
      lastDay: sql<string>`max(${coreTimeAttendance.day})`,
    })
    .from(coreTimeAttendance)
    .where(and(gte(coreTimeAttendance.day, sinceDay), gte(coreTimeAttendance.minutes, minMinutes)))
    .groupBy(coreTimeAttendance.memberId)
    .orderBy(desc(sql`count(*)`), desc(sql`sum(${coreTimeAttendance.minutes})`));
}

// ───────── 🎁 ボーナス ─────────

const JST_MS = 9 * 3_600_000;
/** 終わってからこの時間までにわたす（BOT が止まっていても。設定を変えたときに、昔の分までわたさない） */
const BONUS_LATE_MS = 6 * 3_600_000;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** その日（日本時間）の HH:MM */
const jstAt = (day: string, hhmm: string) => new Date(Date.parse(`${day}T00:00:00Z`) - JST_MS + toMin(hhmm) * 60_000);

export type CoreTimeBonusPaid = { day: string; slot: string; amount: number; memberIds: string[] };

/**
 * 終わったコアタイムに、bonusMinMinutes 分以上いた人へ bonusCoins の銭をわたす（1 回のコアタイムに 1 人 1 回だけ）。
 * 銭は「わたした」の目印と同じトランザクションでわたすので、同時に呼ばれても二重にならない
 */
export async function payCoreTimeBonus(db: Db, ct: CoreTimeConfig, now: Date): Promise<CoreTimeBonusPaid[]> {
  if (ct.bonusCoins <= 0) return [];
  const since = jstParts(new Date(now.getTime() - BONUS_LATE_MS - 86_400_000)).date;
  const rows = await db
    .select()
    .from(coreTimeAttendance)
    .where(and(gte(coreTimeAttendance.day, since), isNull(coreTimeAttendance.bonusAt), gte(coreTimeAttendance.minutes, ct.bonusMinMinutes)));
  const out = new Map<string, CoreTimeBonusPaid>();
  for (const r of rows) {
    // その日の曜日と始まりの時刻から、いまの設定の枠を見つけて、終わりの時刻を出す（枠を消していればわたさない）
    const dow = new Date(`${r.day}T00:00:00Z`).getUTCDay();
    const slot = ct.slots.find((s) => s.day === dow && s.start === r.slot);
    if (!slot) continue;
    const end = jstAt(r.day, slot.end).getTime();
    if (now.getTime() < end || now.getTime() - end > BONUS_LATE_MS) continue;
    const paid = await db.transaction(async (tx) => {
      const [mark] = await tx
        .update(coreTimeAttendance)
        .set({ bonus: ct.bonusCoins, bonusAt: now })
        .where(and(eq(coreTimeAttendance.day, r.day), eq(coreTimeAttendance.slot, r.slot), eq(coreTimeAttendance.memberId, r.memberId), isNull(coreTimeAttendance.bonusAt)))
        .returning();
      if (!mark) return false;
      await addCoins(tx, r.memberId, ct.bonusCoins, 'core_time_bonus', { day: r.day, slot: r.slot, minutes: r.minutes });
      return true;
    });
    if (!paid) continue;
    const key = `${r.day} ${r.slot}`;
    const g = out.get(key) ?? { day: r.day, slot: r.slot, amount: ct.bonusCoins, memberIds: [] };
    g.memberIds.push(r.memberId);
    out.set(key, g);
  }
  return [...out.values()];
}

/** 1 分ごとに呼ぶ: 終わったコアタイムのボーナスをわたして、#境内 に知らせる（通知は飛ばさない） */
export async function processCoreTimeBonus(ctx: { db: Db; cfg: GuildConfig; discord: DiscordActions }, now = new Date()): Promise<number> {
  const paid = await payCoreTimeBonus(ctx.db, ctx.cfg.coreTime, now);
  if (!paid.length) return 0;
  const e = ctx.cfg.economy;
  const channelId = ctx.cfg.channels.keidai ?? (await guildChannelsCached(ctx.discord, ctx.cfg.guildId).catch(() => [])).find((c) => c.type === 0 && c.name === '境内')?.id;
  for (const p of paid) {
    if (!channelId) break;
    const names = p.memberIds.map((id) => `<@${id}>`).join(' ');
    const content = [
      `⏰ **コアタイム、おつかれさまでした！**`,
      `${ctx.cfg.coreTime.bonusMinMinutes} 分以上いてくれた ${p.memberIds.length} 人に、ボーナス ${e.currencyEmoji}${e.currencyName} ${p.amount.toLocaleString('ja-JP')} 枚をおくりました。`,
      names.length <= 1800 ? names : '',
    ].filter(Boolean).join('\n');
    await ctx.discord.sendMessage(channelId, { content, allowed_mentions: { parse: [] } }).catch((err: unknown) => logger.warn({ err }, 'core time bonus notice failed'));
  }
  return paid.reduce((n, p) => n + p.memberIds.length, 0);
}
