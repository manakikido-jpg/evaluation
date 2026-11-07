import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { invites, members, omairi, settings, shofukuAchievements, shofukuEntries, voiceUsage } from '../db/schema.js';
import { autoRanks } from '../domain/ranks.js';
import { extendOmairi } from './applications.js';
import { audit } from './audit.js';
import { addCoins } from './economy.js';
import { returningMemberIds } from './members.js';
import type { DiscordActions } from '../lib/discordRest.js';

/**
 * 🎍 招福詣（招待イベント）。
 * - 期間中に「自分専用の招待リンク」で初めて入った人が対象（出戻りの人はのぞく）
 * - 招かれた人: 🔰参拝者になったら『招福』ロールを付け、お参り期間を延ばす（1回だけ）
 * - 招いた人: 招かれた人が「浮上 minMinutes 分以上」「入ってから stayDays 日いる」を満たすと、男性・女性ごとのポイント
 * - 銭・達成報酬は、運営が社務所Web で確かめてから渡す（自動では渡さない）
 */
const KEY = 'event.shofuku';
const DAY = 86_400_000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const shofukuConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** 日本時間の日付。start の 0:00 から end の 23:59 まで */
  start: date.default('2026-11-02'),
  end: date.default('2026-11-20'),
  malePoints: z.number().int().min(0).max(1000).default(1),
  femalePoints: z.number().int().min(0).max(1000).default(2),
  targetPoints: z.number().int().min(1).max(100000).default(75),
  minMinutes: z.number().int().min(0).max(100000).default(240),
  stayDays: z.number().int().min(0).max(365).default(5),
  reward: z.number().int().min(0).max(1_000_000).default(300),
  extendDays: z.number().int().min(0).max(30).default(3),
  roleId: z.string().regex(/^(\d{17,20})?$/).default(''),
});
export type ShofukuConfig = z.infer<typeof shofukuConfigSchema>;

export async function shofukuConfig(db: Db): Promise<ShofukuConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const r = shofukuConfigSchema.safeParse(row?.value ?? {});
  return r.success ? r.data : shofukuConfigSchema.parse({});
}
export async function saveShofukuConfig(db: Db, input: unknown, by: string): Promise<ShofukuConfig> {
  const value = shofukuConfigSchema.parse(input);
  if (value.start > value.end) throw new Error('期間の始まりが終わりより後です');
  await db.transaction(async tx => {
    await tx.insert(settings).values({ key: KEY, value, updatedBy: by }).onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
    await audit(tx as Db, { actorId: by, action: 'shofuku.config', detail: value, via: 'web' });
  });
  return value;
}
const period = (c: ShofukuConfig) => ({ from: new Date(`${c.start}T00:00:00+09:00`), to: new Date(new Date(`${c.end}T00:00:00+09:00`).getTime() + DAY) });
const jst = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export type ShofukuRow = {
  memberId: string; inviterId: string; name: string; inviterName: string; joinedAt: Date; leftAt: Date | null;
  gender: 'male' | 'female' | null; minutes: number; stayDays: number; sanpaisha: boolean;
  returner: boolean; excluded: boolean; note: string; rewardedAt: Date | null; reward: number; omairiExtendedAt: Date | null;
  /** 条件を満たしたか・足りないもの */
  qualified: boolean; missing: string[]; points: number;
};

/** 期間中に招待リンクで入った人と、条件の判定（新しい順） */
export async function shofukuRows(db: Db, cfg: GuildConfig, c: ShofukuConfig, now = new Date()): Promise<ShofukuRow[]> {
  const { from, to } = period(c);
  const rows = await db.select({ memberId: invites.memberId, inviterId: invites.inviterId, createdAt: invites.createdAt, joinedAt: members.joinedAt, leftAt: members.leftAt, roleIds: members.roleIds, name: members.displayName, isBot: members.isBot })
    .from(invites).innerJoin(members, eq(members.id, invites.memberId))
    .where(and(eq(invites.source, 'link'), gte(invites.createdAt, from), lt(invites.createdAt, to)));
  const list = rows.filter(r => !r.isBot);
  if (!list.length) return [];
  const ids = list.map(r => r.memberId);
  const [entries, back, inviterNames, usage] = await Promise.all([
    db.select().from(shofukuEntries).where(inArray(shofukuEntries.memberId, ids)),
    returningMemberIds(db, ids),
    db.select({ id: members.id, name: members.displayName }).from(members).where(inArray(members.id, [...new Set(list.map(r => r.inviterId))])),
    db.select({ memberId: voiceUsage.memberId, date: voiceUsage.date, minutes: sql<number>`sum(${voiceUsage.minutes})::int` }).from(voiceUsage)
      .where(and(inArray(voiceUsage.memberId, ids), gte(voiceUsage.date, jst(from)))).groupBy(voiceUsage.memberId, voiceUsage.date),
  ]);
  const entryOf = new Map(entries.map(e => [e.memberId, e]));
  const nameOf = new Map(inviterNames.map(n => [n.id, n.name]));
  const first = autoRanks(cfg.ranks)[0]?.roleId;
  return list.map(r => {
    const joinedAt = r.joinedAt ?? r.createdAt;
    const e = entryOf.get(r.memberId);
    // 浮上は、入った日（日本時間）からの通話の時間（AFKをのぞく）
    const minutes = usage.filter(u => u.memberId === r.memberId && u.date >= jst(joinedAt)).reduce((a, u) => a + Number(u.minutes), 0);
    const gender: ShofukuRow['gender'] = cfg.roles.male && r.roleIds.includes(cfg.roles.male) ? 'male' : cfg.roles.female && r.roleIds.includes(cfg.roles.female) ? 'female' : null;
    const stayDays = Math.floor(((r.leftAt ?? now).getTime() - joinedAt.getTime()) / DAY);
    const returner = back.has(r.memberId);
    const missing = [
      ...(returner ? ['出戻り'] : []),
      ...(r.leftAt ? ['退出した'] : stayDays < c.stayDays ? [`滞在 ${stayDays}/${c.stayDays}日`] : []),
      ...(minutes < c.minMinutes ? [`浮上 ${Math.floor(minutes / 60)}時間${minutes % 60}分/${Math.floor(c.minMinutes / 60)}時間`] : []),
      ...(gender ? [] : ['性別のロールなし']),
      ...(e?.excluded ? ['運営が対象外にした'] : []),
    ];
    const qualified = missing.length === 0;
    return {
      memberId: r.memberId, inviterId: r.inviterId, name: r.name, inviterName: nameOf.get(r.inviterId) ?? r.inviterId, joinedAt, leftAt: r.leftAt,
      gender, minutes, stayDays, sanpaisha: Boolean(first && r.roleIds.includes(first)), returner,
      excluded: e?.excluded ?? false, note: e?.note ?? '', rewardedAt: e?.rewardedAt ?? null, reward: e?.reward ?? 0, omairiExtendedAt: e?.omairiExtendedAt ?? null,
      qualified, missing, points: qualified ? (gender === 'male' ? c.malePoints : c.femalePoints) : 0,
    };
  }).sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
}

export type ShofukuRank = { inviterId: string; name: string; points: number; qualified: number; pending: number; achievedAt: Date | null };
/** 招いた人のランキング（条件を満たした人のポイントの合計） */
export async function shofukuRanking(db: Db, rows: ShofukuRow[]): Promise<ShofukuRank[]> {
  const map = new Map<string, ShofukuRank>();
  for (const r of rows) {
    const x = map.get(r.inviterId) ?? { inviterId: r.inviterId, name: r.inviterName, points: 0, qualified: 0, pending: 0, achievedAt: null };
    if (r.qualified) { x.points += r.points; x.qualified++; } else if (!r.returner && !r.excluded && !r.leftAt) x.pending++;
    map.set(r.inviterId, x);
  }
  const done = map.size ? await db.select().from(shofukuAchievements).where(inArray(shofukuAchievements.inviterId, [...map.keys()])) : [];
  for (const d of done) { const x = map.get(d.inviterId); if (x) x.achievedAt = d.awardedAt; }
  return [...map.values()].sort((a, b) => b.points - a.points || b.qualified - a.qualified || a.name.localeCompare(b.name, 'ja'));
}

/**
 * 招かれた人へのお祝い（毎分の確認から）: 🔰参拝者になっていて、お参り期間をまだ延ばしていない人の期間を延ばす。
 * 同時に呼ばれても 1 回だけ。『招福』ロールを付けるべき人（期間中に招待リンクで入った・出戻りでない・在籍中）を返す
 */
export async function shofukuPerks(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ roleTargets: string[]; extended: string[] }> {
  const c = await shofukuConfig(db);
  if (!c.enabled) return { roleTargets: [], extended: [] };
  const rows = (await shofukuRows(db, cfg, c, now)).filter(r => !r.returner && !r.leftAt && !r.excluded);
  const extended: string[] = [];
  for (const r of rows.filter(x => x.sanpaisha && !x.omairiExtendedAt)) {
    const ok = await db.transaction(async tx => {
      await tx.insert(shofukuEntries).values({ memberId: r.memberId, inviterId: r.inviterId }).onConflictDoNothing();
      const [claimed] = await tx.update(shofukuEntries).set({ omairiExtendedAt: now }).where(and(eq(shofukuEntries.memberId, r.memberId), isNull(shofukuEntries.omairiExtendedAt))).returning();
      if (!claimed) return false;
      const [o] = await tx.select().from(omairi).where(eq(omairi.memberId, r.memberId));
      if (o && c.extendDays > 0) await extendOmairi(tx as Db, r.memberId, c.extendDays, now);
      await audit(tx as Db, { actorId: 'system', targetId: r.memberId, action: 'shofuku.omairi_extend', detail: { days: c.extendDays, inviterId: r.inviterId, omairi: Boolean(o) }, via: 'system' });
      return true;
    });
    if (ok) extended.push(r.memberId);
  }
  return { roleTargets: c.roleId ? rows.filter(x => x.sanpaisha).map(x => x.memberId) : [], extended };
}

/** 招いた人に銭を渡す（条件を満たした人ごとに 1 回だけ） */
export async function rewardShofuku(db: Db, cfg: GuildConfig, memberId: string, by: string, now = new Date()): Promise<'ok' | 'not_qualified' | 'done'> {
  const c = await shofukuConfig(db);
  const row = (await shofukuRows(db, cfg, c, now)).find(r => r.memberId === memberId);
  if (!row?.qualified) return 'not_qualified';
  return db.transaction(async tx => {
    await tx.insert(shofukuEntries).values({ memberId, inviterId: row.inviterId }).onConflictDoNothing();
    const [claimed] = await tx.update(shofukuEntries).set({ rewardedAt: now, reward: c.reward, decidedBy: by }).where(and(eq(shofukuEntries.memberId, memberId), isNull(shofukuEntries.rewardedAt), eq(shofukuEntries.excluded, false))).returning();
    if (!claimed) return 'done' as const;
    if (c.reward > 0) await addCoins(tx, row.inviterId, c.reward, 'shofuku_reward', { memberId, by });
    await audit(tx as Db, { actorId: by, targetId: row.inviterId, action: 'shofuku.reward', detail: { memberId, amount: c.reward }, via: 'web' });
    return 'ok' as const;
  });
}

/** 運営が対象外にする・戻す（銭を渡したあとは変えない） */
export async function excludeShofuku(db: Db, memberId: string, inviterId: string, excluded: boolean, note: string, by: string): Promise<boolean> {
  return db.transaction(async tx => {
    await tx.insert(shofukuEntries).values({ memberId, inviterId }).onConflictDoNothing();
    const [row] = await tx.update(shofukuEntries).set({ excluded, note: note.slice(0, 200), decidedBy: by }).where(and(eq(shofukuEntries.memberId, memberId), isNull(shofukuEntries.rewardedAt))).returning();
    if (row) await audit(tx as Db, { actorId: by, targetId: memberId, action: excluded ? 'shofuku.exclude' : 'shofuku.include', detail: { note }, via: 'web' });
    return Boolean(row);
  });
}

/** 達成報酬（アイコンフレームなど）を渡した印を付ける（1 人 1 回） */
export async function markShofukuAchievement(db: Db, inviterId: string, points: number, by: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [row] = await tx.insert(shofukuAchievements).values({ inviterId, points, awardedBy: by }).onConflictDoNothing().returning();
    if (row) await audit(tx as Db, { actorId: by, targetId: inviterId, action: 'shofuku.achievement', detail: { points }, via: 'web' });
    return Boolean(row);
  });
}

// ───────── 指定の日から入った人に、まとめて『招福』ロールを付ける ─────────

const GRANT_LIMIT = 300;
const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00+09:00`));

/** 指定の日（日本時間 0:00）から入った、在籍中の人（BOT のぞく）で、まだ『招福』ロールがない人 */
export async function shofukuGrantTargets(db: Db, since: string): Promise<{ roleId: string; ids: string[] } | undefined> {
  if (!validDay(since)) return undefined;
  const { roleId } = await shofukuConfig(db);
  if (!roleId) return { roleId: '', ids: [] };
  const rows = await db.select({ id: members.id, roleIds: members.roleIds }).from(members)
    .where(and(eq(members.isBot, false), isNull(members.leftAt), gte(members.joinedAt, new Date(`${since}T00:00:00+09:00`))));
  return { roleId, ids: rows.filter((r) => !r.roleIds.includes(roleId)).map((r) => r.id).sort() };
}

/** まとめて付ける（1 回に 300 人まで。もう付いている人はとばすので、残りは、もう一度押せば続きから） */
export async function grantShofukuSince(db: Db, discord: Pick<DiscordActions, 'addRole'>, guildId: string, since: string, by: string):
  Promise<{ status: 'ok'; targets: number; granted: number; failed: number; remaining: number } | { status: 'invalid' | 'no_role' }> {
  const t = await shofukuGrantTargets(db, since);
  if (!t) return { status: 'invalid' };
  if (!t.roleId) return { status: 'no_role' };
  const batch = t.ids.slice(0, GRANT_LIMIT);
  let granted = 0, failed = 0;
  for (const id of batch) {
    try { await discord.addRole(guildId, id, t.roleId, `招福ロールをまとめて付与（${since} から入った人）`); granted++; }
    catch { failed++; }
  }
  await audit(db, { actorId: by, action: 'shofuku.grant_since', detail: { since, roleId: t.roleId, targets: t.ids.length, granted, failed }, via: 'web' });
  return { status: 'ok', targets: t.ids.length, granted, failed, remaining: Math.max(0, t.ids.length - batch.length) };
}

