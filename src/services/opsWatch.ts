import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, applications, bells, meetingTodos, memberEvents, members, omairi, opsNotices, soudan } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { jstDate } from './activity.js';
import { namesOf } from './members.js';

/**
 * 🧭 運営の見守り。
 * - 対応待ち（入鯖・宵参り申請・相談・お参り判定・呼び鈴）が決めた時間そのままなら、運営のチャンネルで知らせる（夜は待つ）。
 *   同じものは 1 回だけ。まだそのままなら 1 日ごと（呼び鈴は 3 時間ごと）にもう一度
 * - 週に 1 回、メンバーの出入り・にぎわい・静かになった人・対応の数をまとめて流す
 */

export type OpsCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions; baseUrl?: string };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 知らせる先（設定 → #記録） */
export const opsChannel = (cfg: GuildConfig) => cfg.opsWatch.channelId ?? cfg.channels.log;

/** 印を付ける（はじめて付けたものだけ返す） */
async function markNew(db: Db, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await db
    .insert(opsNotices)
    .values(keys.map((key) => ({ key })))
    .onConflictDoNothing({ target: opsNotices.key })
    .returning({ key: opsNotices.key });
  return new Set(rows.map((r) => r.key));
}

/** 夜（日本時間 quietStart〜quietEnd 時）か */
export function isQuiet(cfg: GuildConfig, now: Date): boolean {
  const { quietStart: a, quietEnd: b } = cfg.opsWatch;
  if (a === b) return false;
  const h = new Date(now.getTime() + 9 * HOUR).getUTCHours();
  return a < b ? h >= a && h < b : h >= a || h < b;
}

// ───────── 対応待ちのお知らせ ─────────

export type StaleKind = 'join' | 'yoimairi' | 'soudan' | 'omairi' | 'bell';
export type StaleItem = { kind: StaleKind; id: string; memberId: string | null; since: Date };

export const STALE_LABEL: Record<StaleKind, { emoji: string; name: string; path: string }> = {
  join: { emoji: '📝', name: '入鯖申請', path: '/applications' },
  yoimairi: { emoji: '🏮', name: '宵参り申請', path: '/applications' },
  soudan: { emoji: '💬', name: '相談（未対応）', path: '/soudan' },
  omairi: { emoji: '⛩', name: 'お参り期間が終わった人の判定', path: '/omairi' },
  bell: { emoji: '🔔', name: '呼び鈴（だれも対応していない）', path: '/' },
};
const STALE_ORDER: StaleKind[] = ['bell', 'join', 'yoimairi', 'soudan', 'omairi'];

/** 決めた時間そのままの対応待ち（古い順） */
export async function staleItems(db: Db, cfg: GuildConfig, now = new Date()): Promise<StaleItem[]> {
  const o = cfg.opsWatch;
  const before = (h: number) => new Date(now.getTime() - h * HOUR);
  const out: StaleItem[] = [];
  if (o.applicationHours > 0) {
    const rows = await db
      .select({ id: applications.id, kind: applications.kind, memberId: applications.memberId, at: applications.createdAt })
      .from(applications)
      .where(and(eq(applications.status, 'pending'), lte(applications.createdAt, before(o.applicationHours))));
    for (const r of rows) out.push({ kind: r.kind === 'yoimairi' ? 'yoimairi' : 'join', id: String(r.id), memberId: r.memberId, since: r.at });
  }
  if (o.soudanHours > 0) {
    // 相談した人はだれにも出さない（匿名）
    const rows = await db
      .select({ id: soudan.id, at: soudan.createdAt })
      .from(soudan)
      .where(and(eq(soudan.status, 'open'), lte(soudan.createdAt, before(o.soudanHours))));
    for (const r of rows) out.push({ kind: 'soudan', id: String(r.id), memberId: null, since: r.at });
  }
  if (o.omairiHours > 0) {
    const rows = await db
      .select({ memberId: omairi.memberId, at: omairi.endsAt })
      .from(omairi)
      .where(and(eq(omairi.status, 'review'), lte(omairi.endsAt, before(o.omairiHours))));
    for (const r of rows) out.push({ kind: 'omairi', id: r.memberId, memberId: r.memberId, since: r.at });
  }
  if (o.bellMinutes > 0) {
    const rows = await db
      .select({ id: bells.id, memberId: bells.memberId, at: bells.createdAt })
      .from(bells)
      .where(and(eq(bells.status, 'open'), lte(bells.createdAt, new Date(now.getTime() - o.bellMinutes * 60_000))));
    for (const r of rows) out.push({ kind: 'bell', id: String(r.id), memberId: r.memberId, since: r.at });
  }
  return out.sort((a, b) => a.since.getTime() - b.since.getTime());
}

/** 同じものをもう一度知らせるまで（呼び鈴は 3 時間・ほかは 1 日） */
const repeatMs = (k: StaleKind) => (k === 'bell' ? 3 * HOUR : DAY);
const staleKey = (it: StaleItem, now: Date) => `stale:${it.kind}:${it.id}:${Math.floor((now.getTime() - it.since.getTime()) / repeatMs(it.kind))}`;

/** どのくらい前か（「45 分前」「14 時間前」「3 日前」） */
export function ago(since: Date, now: Date): string {
  const m = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (m < 60) return `${m} 分前`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} 時間前`;
  return `${Math.floor(m / 1440)} 日前`;
}

/** お知らせの文（種類ごとに 1 行） */
export function staleText(items: StaleItem[], fresh: Set<StaleItem>, names: Map<string, string>, now: Date, baseUrl?: string): string {
  const lines: string[] = [];
  for (const k of STALE_ORDER) {
    const list = items.filter((x) => x.kind === k);
    if (!list.length) continue;
    const L = STALE_LABEL[k];
    const oldest = list[0]!;
    const who = oldest.memberId ? `: ${names.get(oldest.memberId) ?? '（抜けた人）'}` : '';
    const isNew = list.some((x) => fresh.has(x));
    lines.push(`${L.emoji} **${L.name}** ${list.length} 件（いちばん古いのは ${ago(oldest.since, now)}${who}）${isNew ? '' : ' …まだそのままです'}`);
  }
  const link = baseUrl ? `\n-# 社務所Web: ${baseUrl}/` : '';
  return `⏰ **対応待ちがそのままになっています**\n${lines.join('\n')}${link}`;
}

/** 10 分ごと: 新しくそのままになったものがあれば知らせる（夜は待つ・同じものは 1 日 1 回） */
export async function staleTick(ctx: OpsCtx, now = new Date()): Promise<'sent' | 'none' | 'quiet' | 'off'> {
  const { db, cfg } = ctx;
  const o = cfg.opsWatch;
  const channel = opsChannel(cfg);
  if (!o.remindEnabled || !channel) return 'off';
  if (isQuiet(cfg, now)) return 'quiet';
  const items = await staleItems(db, cfg, now);
  if (!items.length) return 'none';
  const keys = items.map((it) => staleKey(it, now));
  const added = await markNew(db, keys);
  const fresh = new Set(items.filter((_, i) => added.has(keys[i]!)));
  if (!fresh.size) return 'none';
  const names = await namesOf(db, items.flatMap((x) => (x.memberId ? [x.memberId] : [])));
  const roles = o.mention ? [...new Set([...(cfg.admin?.shinshokuRoleIds ?? []), ...(cfg.admin?.gujiRoleIds ?? [])])] : [];
  const content = `${roles.map((r) => `<@&${r}>`).join(' ')}${roles.length ? '\n' : ''}${staleText(items, fresh, names, now, ctx.baseUrl)}`;
  try {
    await ctx.discord.sendMessage(channel, { content: content.slice(0, 2000), allowed_mentions: { parse: [], roles } });
  } catch (err) {
    // 送れなかったら、次にもう一度送れるよう印を消す
    await db.delete(opsNotices).where(inArray(opsNotices.key, [...added]));
    logger.warn({ err }, 'ops stale notice failed');
    return 'none';
  }
  return 'sent';
}

// ───────── 週ごとのまとめ ─────────

export type OpsWeekly = {
  members: number;
  joins: number;
  rejoins: number;
  leaves: number;
  promotions: number;
  messages: number;
  prevMessages: number;
  vcMinutes: number;
  prevVcMinutes: number;
  activeMembers: number;
  prevActiveMembers: number;
  /** 先週は来ていたのに、この 1 週間は来ていない人（先週よく来ていた順） */
  quiet: { memberId: string; name: string; prevMinutes: number; prevMessages: number }[];
  /** この 1 週間によく来た人（通話の長い順） */
  top: { memberId: string; name: string; minutes: number; messages: number }[];
  apps: { handled: number; pending: number; oldest: Date | null };
  soudan: { created: number; open: number };
  bells: { rung: number; avgTakeMinutes: number | null; open: number };
  todos: { open: number; overdue: number };
};

/** 直近 7 日（きのうまで）とその前の 7 日 */
export async function opsWeekly(db: Db, now = new Date()): Promise<OpsWeekly> {
  const from = new Date(now.getTime() - 7 * DAY);
  const days = (back: number) => jstDate(new Date(now.getTime() - back * DAY));
  // activity_daily は日本時間の日付（きのうまでの 7 日・その前の 7 日）
  const [d1, d7, d8, d14] = [days(1), days(7), days(8), days(14)];
  const perMember = async (a: string, b: string) =>
    db
      .select({ memberId: activityDaily.memberId, messages: sql<number>`sum(${activityDaily.messageCount})::int`, minutes: sql<number>`sum(${activityDaily.vcMinutes})::int` })
      .from(activityDaily)
      .innerJoin(members, eq(members.id, activityDaily.memberId))
      .where(and(gte(activityDaily.date, a), lte(activityDaily.date, b), eq(members.isBot, false)))
      .groupBy(activityDaily.memberId);
  const [now7, prev7, events, [memberCount], appsHandled, appsPending, soudanCreated, soudanOpen, bellRows, bellOpen, todoRows] = await Promise.all([
    perMember(d7, d1),
    perMember(d14, d8),
    db.select({ kind: memberEvents.kind, n: sql<number>`count(*)::int` }).from(memberEvents).where(gte(memberEvents.at, from)).groupBy(memberEvents.kind),
    db.select({ n: sql<number>`count(*)::int` }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false))),
    db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(isNotNull(applications.reviewedAt), gte(applications.reviewedAt, from))),
    db.select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${applications.createdAt})` }).from(applications).where(eq(applications.status, 'pending')),
    db.select({ n: sql<number>`count(*)::int` }).from(soudan).where(gte(soudan.createdAt, from)),
    db.select({ n: sql<number>`count(*)::int` }).from(soudan).where(eq(soudan.status, 'open')),
    db.select({ createdAt: bells.createdAt, takenAt: bells.takenAt }).from(bells).where(gte(bells.createdAt, from)),
    db.select({ n: sql<number>`count(*)::int` }).from(bells).where(eq(bells.status, 'open')),
    db.select({ due: meetingTodos.due }).from(meetingTodos).where(isNull(meetingTodos.doneAt)),
  ]);
  const ev = (k: string) => events.find((e) => e.kind === k)?.n ?? 0;
  const active = <T extends { messages: number; minutes: number }>(rows: T[]) => rows.filter((r) => r.messages > 0 || r.minutes > 0);
  const nowActive = new Set(active(now7).map((r) => r.memberId));
  const quietRows = active(prev7)
    .filter((r) => !nowActive.has(r.memberId))
    .sort((a, b) => b.minutes + b.messages * 2 - (a.minutes + a.messages * 2))
    .slice(0, 10);
  const topRows = [...active(now7)].sort((a, b) => b.minutes - a.minutes || b.messages - a.messages).slice(0, 5);
  // 抜けた人は静かになった人に入れない
  const present = new Set(
    quietRows.length
      ? (
          await db
            .select({ id: members.id })
            .from(members)
            .where(and(inArray(members.id, quietRows.map((r) => r.memberId)), isNull(members.leftAt)))
        ).map((r) => r.id)
      : [],
  );
  const names = await namesOf(db, [...quietRows.map((r) => r.memberId), ...topRows.map((r) => r.memberId)]);
  const sum = (rows: { messages: number; minutes: number }[], k: 'messages' | 'minutes') => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const taken = bellRows.filter((b) => b.takenAt);
  const today = jstDate(now);
  const pendingRow = appsPending[0];
  const oldest = pendingRow?.oldest ? new Date(pendingRow.oldest) : null;
  return {
    members: memberCount?.n ?? 0,
    joins: ev('join'),
    rejoins: ev('rejoin'),
    leaves: ev('leave'),
    promotions: ev('promote'),
    messages: sum(now7, 'messages'),
    prevMessages: sum(prev7, 'messages'),
    vcMinutes: sum(now7, 'minutes'),
    prevVcMinutes: sum(prev7, 'minutes'),
    activeMembers: nowActive.size,
    prevActiveMembers: active(prev7).length,
    quiet: quietRows.filter((r) => present.has(r.memberId)).map((r) => ({ memberId: r.memberId, name: names.get(r.memberId) ?? r.memberId, prevMinutes: r.minutes, prevMessages: r.messages })),
    top: topRows.map((r) => ({ memberId: r.memberId, name: names.get(r.memberId) ?? r.memberId, minutes: r.minutes, messages: r.messages })),
    apps: { handled: appsHandled[0]?.n ?? 0, pending: pendingRow?.n ?? 0, oldest },
    soudan: { created: soudanCreated[0]?.n ?? 0, open: soudanOpen[0]?.n ?? 0 },
    bells: {
      rung: bellRows.length,
      avgTakeMinutes: taken.length ? Math.round(taken.reduce((a, b) => a + (b.takenAt!.getTime() - b.createdAt.getTime()), 0) / taken.length / 60_000) : null,
      open: bellOpen[0]?.n ?? 0,
    },
    todos: { open: todoRows.length, overdue: todoRows.filter((t) => t.due && t.due < today).length },
  };
}

/** 先週との比べ（+12%・-5%・先週 0 なら出さない） */
const vs = (a: number, b: number) => (b > 0 ? `（先週比 ${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%）` : '');
const hours = (min: number) => (min >= 60 ? `${fmt(Math.round((min / 60) * 10) / 10)} 時間` : `${fmt(min)} 分`);

export function opsWeeklyText(w: OpsWeekly, now: Date, baseUrl?: string): { title: string; description: string } {
  const net = w.joins + w.rejoins - w.leaves;
  const lines = [
    `👥 **メンバー** いま ${fmt(w.members)} 人（この 1 週間で ${net >= 0 ? '+' : ''}${net}）`,
    `-# 入った ${w.joins} 人${w.rejoins ? `・戻ってきた ${w.rejoins} 人` : ''}・抜けた ${w.leaves} 人・昇格 ${w.promotions} 人`,
    `💬 **にぎわい** 来た人 ${fmt(w.activeMembers)} 人${vs(w.activeMembers, w.prevActiveMembers)}`,
    `-# 発言 ${fmt(w.messages)} 件${vs(w.messages, w.prevMessages)}・通話 ${hours(w.vcMinutes)}${vs(w.vcMinutes, w.prevVcMinutes)}`,
    ...(w.top.length ? [`⭐ **よく来た人** ${w.top.map((t) => `${t.name}（${hours(t.minutes)}）`).join('・')}`] : []),
    ...(w.quiet.length
      ? [`🌙 **静かになった人**（先週は来ていて、この 1 週間は来ていない）`, `-# ${w.quiet.map((q) => q.name).join('・')}`, '-# 声をかけてみるきっかけに']
      : []),
    '',
    `🧾 **対応**`,
    `- 申請: この 1 週間で ${w.apps.handled} 件 対応・いま ${w.apps.pending} 件 待ち${w.apps.oldest ? `（いちばん古いのは ${ago(w.apps.oldest, now)}）` : ''}`,
    `- 相談: 新しく ${w.soudan.created} 件・未対応 ${w.soudan.open} 件`,
    `- 呼び鈴: ${w.bells.rung} 回${w.bells.avgTakeMinutes !== null ? `・対応までの平均 ${w.bells.avgTakeMinutes} 分` : ''}${w.bells.open ? `・まだ ${w.bells.open} 件` : ''}`,
    `- 議事録のやること: 残り ${w.todos.open} 件${w.todos.overdue ? `（期限切れ ${w.todos.overdue} 件）` : ''}`,
    '',
    `-# 銭の流れは「今週の銭の流れ」で。${baseUrl ? `社務所Web: ${baseUrl}/` : ''}`,
  ];
  return { title: '🗓 今週の咲楽ノ宮', description: lines.join('\n').slice(0, 4000) };
}

/** 決めた曜日・時（日本時間）に週ごとのまとめ（週に 1 回だけ） */
export async function opsWeeklyTick(ctx: OpsCtx, now = new Date()): Promise<'sent' | 'not_time' | 'already' | 'off'> {
  const o = ctx.cfg.opsWatch;
  const channel = opsChannel(ctx.cfg);
  if (!o.reportEnabled || !channel) return 'off';
  const jst = new Date(now.getTime() + 9 * HOUR);
  if (jst.getUTCDay() !== o.reportWeekday || jst.getUTCHours() !== o.reportHour) return 'not_time';
  const key = `weekly:${jstDate(now)}`;
  if (!(await markNew(ctx.db, [key])).size) return 'already';
  const r = opsWeeklyText(await opsWeekly(ctx.db, now), now, ctx.baseUrl);
  try {
    await ctx.discord.sendMessage(channel, { embeds: [{ title: r.title, description: r.description, color: 0xe58fa8 }], allowed_mentions: { parse: [] } });
  } catch (err) {
    await ctx.db.delete(opsNotices).where(eq(opsNotices.key, key));
    logger.warn({ err }, 'ops weekly post failed');
    return 'already';
  }
  return 'sent';
}

/** ホームに出す: 呼び鈴でまだだれも対応していないもの */
export async function openBells(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(bells).where(eq(bells.status, 'open'));
  return r?.n ?? 0;
}

/** 古い印を消す（30 日より前） */
export async function pruneOpsNotices(db: Db, now = new Date()): Promise<void> {
  await db.delete(opsNotices).where(lt(opsNotices.at, new Date(now.getTime() - 30 * DAY)));
}
