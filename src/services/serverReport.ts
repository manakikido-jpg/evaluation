import { and, eq, gte, inArray, isNull, lt, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  activityDaily,
  activityHourly,
  casinoGames,
  castSessions,
  coinTx,
  gachaDraws,
  guideReceptions,
  invites,
  memberEvents,
  members,
  messageArchive,
  omikuji,
  shopPurchases,
  shuin,
  specialGoen,
  supportTickets,
  voiceChannels,
  voiceUsage,
  wallets,
} from '../db/schema.js';
import { autoRanks, highestRank } from '../domain/ranks.js';
import { genderOfRoles } from './admission.js';
import { COIN_REASON_LABEL } from './economy.js';
import { binsText, hourBins, messageBins, quantile, type Bin } from './shuinReport.js';
import { engawaChannelIds } from './ujikoEvaluation.js';

/**
 * 📊 サーバーのようすの集計（読むだけ。DB・Discord・設定は何も変えない）。
 * 名前・ID は出さない。人数・合計・中央値・分布だけ（チャンネルの名前は出す）。
 * serverReportData が数字をまとめ、buildServerReport が文にする（VPS の src/scripts/server-report.ts）。社務所Web の「📋 レポート」は同じ数字をグラフにする
 */

const DAY = 86_400_000;
const jstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const startOf = (date: string) => new Date(`${date}T00:00:00+09:00`);
const addDay = (date: string, n: number) => jstDate(new Date(startOf(date).getTime() + n * DAY));
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '―');
const one = (v: number | undefined) => (v === undefined ? '―' : Number.isInteger(v) ? fmt(v) : v.toFixed(1));
const hours = (m: number | undefined) => (m === undefined ? '―' : `${(m / 60).toFixed(1)} 時間`);
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
/** 日付（YYYY-MM-DD）の曜日（0 = 月曜） */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
const DAY_BINS = [[1, 1, '1 日'], [2, 3, '2〜3 日'], [4, 7, '4〜7 日'], [8, 14, '8〜14 日'], [15, 29, '15〜29 日'], [30, Infinity, '30 日〜']] as const;
const dayBins = (v: number[]): Bin[] => DAY_BINS.map(([a, b, label]) => ({ label, count: v.filter((n) => n >= a && n <= b).length }));

export type ServerReportOptions = { now?: Date; /** 何日分を見るか（はじめは 30・365 まで） */ days?: number; /** 週ごとの推移の週の数（はじめは 8・26 まで） */ weeks?: number };

export type Sex = { male: number; female: number; unknown: number };
export type ServerReportData = {
  at: Date;
  today: string;
  from: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  weeks: number;
  people: {
    members: number; gender: Sex; adult: number; minor: number; ageUnknown: number;
    ranks: { name: string; count: number }[];
    joins: number; joinsPrev: number; joinedPeople: number; rejoined: number; joinedGender: Sex; stayed: number;
    leaves: number; leavesPrev: number;
  };
  active: {
    people: number; peoplePrev: number; msgPeople: number; vcPeople: number; gender: Sex;
    dau: number; dauPrev: number; peakDay: number; activeMembers: number; daysMedian: number | undefined; daysBins: Bin[];
    weekday: { day: string; avg: number }[];
  };
  hourly: { days: number; rows: { hour: number; active: number; voice: number; talk: number }[] };
  voice: {
    minutes: number; minutesPrev: number; people: number;
    gender: { male: { people: number; minutes: number }; female: { people: number; minutes: number }; unknown: { people: number; minutes: number } };
    median: number | undefined; bins: Bin[]; engawaMinutes: number; engawaPeople: number;
    channels: { name: string; minutes: number; people: number; engawa: boolean }[];
  };
  messages: { total: number; totalPrev: number; people: number; gender: Sex; median: number | undefined; bins: Bin[]; channels: { name: string; count: number; people: number }[] };
  shuin: { stamps: number; stampsPrev: number; givers: number; receivers: number; revoked: number; specialCount: number; specialTotal: number; promotions: { name: string; people: number }[] };
  coin: {
    plus: number; minus: number; balanceTotal: number; balanceMedian: number | undefined; balanceP90: number | undefined; balanceMax: number;
    in: { reason: string; label: string; amount: number; people: number }[];
    out: { reason: string; label: string; amount: number; people: number }[];
  };
  casino: { plays: number; players: number; bet: number; paid: number; games: { game: string; plays: number; players: number; bet: number; paid: number }[] };
  shop: { count: number; people: number; total: number; kinds: { kind: string; count: number }[] };
  gacha: { count: number; people: number; total: number };
  omikuji: { count: number; people: number; fortunes: { fortune: string; count: number }[] };
  guide: { count: number; done: number; left: number; waiting: number; guides: number; medianMinutes: number | undefined };
  invites: { count: number; sources: { source: string; count: number }[] };
  cast: { requests: number; done: number; customers: number; casts: number; total: number; statuses: { status: string; count: number }[] };
  tickets: { count: number; types: { type: string; count: number }[] };
  weekly: { from: string; to: string; active: number; talked: number; voiced: number; voiceMinutes: number; engawaMinutes: number; messages: number; stamps: number; joined: number; left: number }[];
};

const tally = <K extends string>(keys: K[]) => {
  const m = new Map<K, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

/** 集計の数字（読むだけ） */
export async function serverReportData(db: Db, cfg: GuildConfig, opts: ServerReportOptions = {}): Promise<ServerReportData> {
  const now = opts.now ?? new Date();
  const days = Math.min(365, Math.max(1, opts.days ?? 30));
  const weeks = Math.min(26, Math.max(1, opts.weeks ?? 8));
  const today = jstDate(now);
  const from = addDay(today, -(days - 1));
  const fromAt = startOf(from);
  const prevFrom = addDay(from, -days);
  const prevAt = startOf(prevFrom);

  const all = await db.select({ id: members.id, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt, ageGroup: members.ageGroup }).from(members);
  const botIds = all.filter((m) => m.isBot).map((m) => m.id);
  const bots = new Set(botIds);
  const people = all.filter((m) => !m.isBot && !m.leftAt);
  const here = new Set(people.map((p) => p.id));
  const genderOf = new Map(all.map((m) => [m.id, genderOfRoles(cfg, m.roleIds)]));
  const human = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !bots.has(r.id));
  const notBot = (col: Parameters<typeof notInArray>[0]): SQL | undefined => (botIds.length ? notInArray(col, botIds) : undefined);
  const sexOf = (id: string): keyof Sex => (genderOf.get(id) === 'male' ? 'male' : genderOf.get(id) === 'female' ? 'female' : 'unknown');
  const sex = (ids: Iterable<string>): Sex => {
    const s: Sex = { male: 0, female: 0, unknown: 0 };
    for (const id of ids) s[sexOf(id)]++;
    return s;
  };

  // ── 人数
  const ev = human(await db.select({ id: memberEvents.memberId, kind: memberEvents.kind, at: memberEvents.at }).from(memberEvents).where(and(inArray(memberEvents.kind, ['join', 'rejoin', 'leave']), gte(memberEvents.at, prevAt))));
  const joined = ev.filter((e) => e.kind !== 'leave' && e.at >= fromAt);
  const joinedIds = [...new Set(joined.map((e) => e.id))];
  const rankCount = new Map<string, number>();
  for (const p of people) {
    const k = highestRank(cfg.ranks, p.roleIds)?.name ?? '役職なし';
    rankCount.set(k, (rankCount.get(k) ?? 0) + 1);
  }
  const ageCount = (g: string) => people.filter((p) => p.ageGroup === g).length;

  // ── 浮上
  const daily = human(await db.select({ id: activityDaily.memberId, date: activityDaily.date, msg: activityDaily.messageCount }).from(activityDaily).where(and(gte(activityDaily.date, prevFrom), lte(activityDaily.date, today))));
  const vcRows = human(await db.select({ id: voiceUsage.memberId, date: voiceUsage.date, ch: voiceUsage.channelId, min: voiceUsage.minutes }).from(voiceUsage).where(and(gte(voiceUsage.date, prevFrom), lte(voiceUsage.date, today))));
  const cur = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= from);
  const prev = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date < from);
  const activeDays = (msgRows: typeof daily, voice: typeof vcRows) => {
    const byDay = new Map<string, Set<string>>();
    const add = (date: string, id: string) => (byDay.get(date) ?? byDay.set(date, new Set()).get(date)!).add(id);
    for (const r of msgRows) if (r.msg > 0) add(r.date, r.id);
    for (const r of voice) if (r.min > 0) add(r.date, r.id);
    return byDay;
  };
  const byDay = activeDays(cur(daily), cur(vcRows));
  const byDayPrev = activeDays(prev(daily), prev(vcRows));
  const activeIds = new Set([...byDay.values()].flatMap((s) => [...s]));
  const activePrev = new Set([...byDayPrev.values()].flatMap((s) => [...s]));
  const dau = (m: Map<string, Set<string>>) => [...m.values()].reduce((a, s) => a + s.size, 0) / days;
  const daysActive = [...activeIds].map((id) => [...byDay.values()].filter((s) => s.has(id)).length);
  const dayList = Array.from({ length: days }, (_, i) => addDay(from, i));

  // ── 時間帯
  const hourly = human(await db.select({ id: activityHourly.memberId, date: activityHourly.date, hour: activityHourly.hour, msg: activityHourly.messages, min: activityHourly.vcMinutes }).from(activityHourly).where(and(gte(activityHourly.date, from), lte(activityHourly.date, today))));
  const recorded = new Set(hourly.map((r) => r.date)).size;
  const atHour = (h: number, f: (r: (typeof hourly)[number]) => boolean) => (recorded ? new Set(hourly.filter((r) => r.hour === h && f(r)).map((r) => `${r.date}:${r.id}`)).size / recorded : 0);

  // ── 通話
  const vcCur = cur(vcRows);
  const vcPer = new Map<string, number>();
  for (const r of vcCur) vcPer.set(r.id, (vcPer.get(r.id) ?? 0) + r.min);
  const engawa = new Set(await engawaChannelIds(db, today));
  const chNames = new Map((await db.select({ id: voiceChannels.channelId, name: voiceChannels.name, cat: voiceChannels.categoryName }).from(voiceChannels)).map((c) => [c.id, `${c.cat ? `${c.cat} / ` : ''}${c.name}`]));
  const byCh = new Map<string, { min: number; ids: Set<string> }>();
  for (const r of vcCur) {
    const c = byCh.get(r.ch) ?? byCh.set(r.ch, { min: 0, ids: new Set() }).get(r.ch)!;
    c.min += r.min;
    c.ids.add(r.id);
  }
  const vcGender = (g: keyof Sex) => ({ people: [...vcPer.keys()].filter((id) => sexOf(id) === g).length, minutes: [...vcPer].filter(([id]) => sexOf(id) === g).reduce((a, [, m]) => a + m, 0) });

  // ── 発言
  const msgPer = new Map<string, number>();
  for (const r of cur(daily)) msgPer.set(r.id, (msgPer.get(r.id) ?? 0) + r.msg);
  const talkers = [...msgPer.values()].filter((n) => n > 0);
  const msgByGender = (g: keyof Sex) => [...msgPer].filter(([id]) => sexOf(id) === g).reduce((a, [, n]) => a + n, 0);
  const archive = await db
    .select({ ch: messageArchive.channelId, name: sql<string>`max(${messageArchive.channelName})`, n: sql<number>`count(*)::int`, people: sql<number>`count(distinct ${messageArchive.authorId})::int` })
    .from(messageArchive)
    .where(and(gte(messageArchive.createdAt, fromAt), notBot(messageArchive.authorId)))
    .groupBy(messageArchive.channelId);

  // ── 朱印
  const stamps = await db.select({ giver: shuin.giverId, receiver: shuin.receiverId, at: shuin.createdAt, revoked: shuin.revokedAt }).from(shuin).where(gte(shuin.createdAt, prevAt));
  const live = stamps.filter((s) => !s.revoked);
  const sc = live.filter((s) => s.at >= fromAt);
  const sp = await db.select({ amount: specialGoen.amount }).from(specialGoen).where(and(isNull(specialGoen.revokedAt), gte(specialGoen.createdAt, fromAt)));
  const promotes = human(await db.select({ id: memberEvents.memberId, detail: memberEvents.detail }).from(memberEvents).where(and(eq(memberEvents.kind, 'promote'), gte(memberEvents.at, fromAt))));

  // ── 銭（理由ごとにまとめて数える）
  const coinRows = await db
    .select({
      reason: coinTx.reason,
      plus: sql<number>`coalesce(sum(case when ${coinTx.amount} > 0 then ${coinTx.amount} else 0 end), 0)::bigint`,
      minus: sql<number>`coalesce(sum(case when ${coinTx.amount} < 0 then -${coinTx.amount} else 0 end), 0)::bigint`,
      inPeople: sql<number>`count(distinct case when ${coinTx.amount} > 0 then ${coinTx.memberId} end)::int`,
      outPeople: sql<number>`count(distinct case when ${coinTx.amount} < 0 then ${coinTx.memberId} end)::int`,
    })
    .from(coinTx)
    .where(and(gte(coinTx.at, fromAt), notBot(coinTx.memberId)))
    .groupBy(coinTx.reason);
  const balances = (await db.select({ id: wallets.memberId, balance: wallets.balance }).from(wallets)).filter((w) => here.has(w.id)).map((w) => w.balance);
  const coinList = (dir: 'in' | 'out') =>
    coinRows
      .map((r) => ({ reason: r.reason, label: COIN_REASON_LABEL[r.reason] ?? r.reason, amount: Number(dir === 'in' ? r.plus : r.minus), people: Number(dir === 'in' ? r.inPeople : r.outPeople) }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

  // ── カジノ（ゲームごとにまとめて数える）
  const gameRows = await db
    .select({ game: casinoGames.game, plays: sql<number>`count(*)::int`, players: sql<number>`count(distinct ${casinoGames.memberId})::int`, bet: sql<number>`coalesce(sum(${casinoGames.bet}), 0)::bigint`, paid: sql<number>`coalesce(sum(${casinoGames.payout}), 0)::bigint` })
    .from(casinoGames)
    .where(and(gte(casinoGames.createdAt, fromAt), eq(casinoGames.status, 'done'), notBot(casinoGames.memberId)))
    .groupBy(casinoGames.game);
  const [casinoAll] = await db
    .select({ players: sql<number>`count(distinct ${casinoGames.memberId})::int` })
    .from(casinoGames)
    .where(and(gte(casinoGames.createdAt, fromAt), eq(casinoGames.status, 'done'), notBot(casinoGames.memberId)));
  const games = gameRows.map((g) => ({ game: g.game, plays: Number(g.plays), players: Number(g.players), bet: Number(g.bet), paid: Number(g.paid) })).sort((a, b) => b.plays - a.plays);

  // ── 授与所・物御籤・おみくじ
  const buys = human(await db.select({ id: shopPurchases.memberId, kind: shopPurchases.kind, price: shopPurchases.price }).from(shopPurchases).where(gte(shopPurchases.createdAt, fromAt)));
  const draws = human(await db.select({ id: gachaDraws.memberId, price: gachaDraws.price }).from(gachaDraws).where(gte(gachaDraws.createdAt, fromAt)));
  const kuji = human(await db.select({ id: omikuji.memberId, fortune: omikuji.fortune }).from(omikuji).where(gte(omikuji.date, from)));

  // ── 案内・招待・キャスト・お問い合わせ
  const recs = await db.select({ status: guideReceptions.status, created: guideReceptions.createdAt, finished: guideReceptions.finishedAt, guide: guideReceptions.guideId }).from(guideReceptions).where(gte(guideReceptions.createdAt, fromAt));
  const doneRecs = recs.filter((r) => r.status === 'done' && r.finished);
  const inv = await db.select({ source: invites.source }).from(invites).where(gte(invites.createdAt, fromAt));
  const cast = await db.select({ status: castSessions.status, price: castSessions.price, customer: castSessions.customerId, cast: castSessions.castId }).from(castSessions).where(gte(castSessions.createdAt, fromAt));
  const castDone = cast.filter((c) => c.status === 'done');
  const tickets = await db.select({ type: supportTickets.typeKey }).from(supportTickets).where(gte(supportTickets.createdAt, fromAt));

  // ── 週ごと（月曜はじまり）
  const monday = addDay(today, -weekday(today));
  const first = addDay(monday, -7 * (weeks - 1));
  const firstAt = startOf(first);
  const wDaily = human(await db.select({ id: activityDaily.memberId, date: activityDaily.date, msg: activityDaily.messageCount }).from(activityDaily).where(and(gte(activityDaily.date, first), lte(activityDaily.date, today))));
  const wVoice = human(await db.select({ id: voiceUsage.memberId, date: voiceUsage.date, ch: voiceUsage.channelId, min: voiceUsage.minutes }).from(voiceUsage).where(and(gte(voiceUsage.date, first), lte(voiceUsage.date, today))));
  const wStamps = await db.select({ at: shuin.createdAt }).from(shuin).where(and(isNull(shuin.revokedAt), gte(shuin.createdAt, firstAt)));
  const wEvents = human(await db.select({ id: memberEvents.memberId, kind: memberEvents.kind, at: memberEvents.at }).from(memberEvents).where(and(inArray(memberEvents.kind, ['join', 'rejoin', 'leave']), gte(memberEvents.at, firstAt), lt(memberEvents.at, new Date(now.getTime() + DAY)))));
  const weekly = Array.from({ length: weeks }, (_, w) => {
    const a = addDay(first, 7 * w);
    const b = addDay(a, 6);
    const inWeek = (d: string) => d >= a && d <= b;
    const aAt = startOf(a).getTime();
    const bAt = aAt + 7 * DAY;
    const m = wDaily.filter((r) => inWeek(r.date) && r.msg > 0);
    const v = wVoice.filter((r) => inWeek(r.date) && r.min > 0);
    const msgIds = new Set(m.map((r) => r.id));
    const vcIds = new Set(v.map((r) => r.id));
    const e = wEvents.filter((x) => x.at.getTime() >= aAt && x.at.getTime() < bAt);
    return {
      from: a,
      to: b,
      active: new Set([...msgIds, ...vcIds]).size,
      talked: msgIds.size,
      voiced: vcIds.size,
      voiceMinutes: v.reduce((s, r) => s + r.min, 0),
      engawaMinutes: v.filter((r) => engawa.has(r.ch)).reduce((s, r) => s + r.min, 0),
      messages: m.reduce((s, r) => s + r.msg, 0),
      stamps: wStamps.filter((x) => x.at.getTime() >= aAt && x.at.getTime() < bAt).length,
      joined: e.filter((x) => x.kind !== 'leave').length,
      left: e.filter((x) => x.kind === 'leave').length,
    };
  });

  return {
    at: now,
    today,
    from,
    prevFrom,
    prevTo: addDay(from, -1),
    days,
    weeks,
    people: {
      members: people.length,
      gender: sex(people.map((p) => p.id)),
      adult: ageCount('adult'),
      minor: ageCount('minor'),
      ageUnknown: ageCount('unknown'),
      ranks: [...[...cfg.ranks].sort((a, b) => a.weight - b.weight).map((r) => ({ name: r.name, count: rankCount.get(r.name) ?? 0 })), { name: '役職なし', count: rankCount.get('役職なし') ?? 0 }],
      joins: joined.length,
      joinsPrev: ev.filter((e) => e.kind !== 'leave' && e.at < fromAt).length,
      joinedPeople: joinedIds.length,
      rejoined: new Set(joined.filter((e) => e.kind === 'rejoin').map((e) => e.id)).size,
      joinedGender: sex(joinedIds),
      stayed: joinedIds.filter((id) => here.has(id)).length,
      leaves: ev.filter((e) => e.kind === 'leave' && e.at >= fromAt).length,
      leavesPrev: ev.filter((e) => e.kind === 'leave' && e.at < fromAt).length,
    },
    active: {
      people: activeIds.size,
      peoplePrev: activePrev.size,
      msgPeople: new Set(cur(daily).filter((r) => r.msg > 0).map((r) => r.id)).size,
      vcPeople: new Set(vcCur.filter((r) => r.min > 0).map((r) => r.id)).size,
      gender: sex(activeIds),
      dau: dau(byDay),
      dauPrev: dau(byDayPrev),
      peakDay: Math.max(0, ...[...byDay.values()].map((s) => s.size)),
      activeMembers: [...activeIds].filter((id) => here.has(id)).length,
      daysMedian: quantile(daysActive, 0.5),
      daysBins: dayBins(daysActive),
      weekday: WEEKDAYS.map((day, w) => {
        const ds = dayList.filter((d) => weekday(d) === w);
        return { day, avg: ds.length ? ds.reduce((a, d) => a + (byDay.get(d)?.size ?? 0), 0) / ds.length : 0 };
      }),
    },
    hourly: { days: recorded, rows: Array.from({ length: 24 }, (_, h) => ({ hour: h, active: atHour(h, (r) => r.msg > 0 || r.min > 0), voice: atHour(h, (r) => r.min > 0), talk: atHour(h, (r) => r.msg > 0) })) },
    voice: {
      minutes: vcCur.reduce((a, r) => a + r.min, 0),
      minutesPrev: prev(vcRows).reduce((a, r) => a + r.min, 0),
      people: vcPer.size,
      gender: { male: vcGender('male'), female: vcGender('female'), unknown: vcGender('unknown') },
      median: quantile([...vcPer.values()], 0.5),
      bins: hourBins([...vcPer.values()]),
      engawaMinutes: vcCur.filter((r) => engawa.has(r.ch)).reduce((a, r) => a + r.min, 0),
      engawaPeople: new Set(vcCur.filter((r) => engawa.has(r.ch) && r.min > 0).map((r) => r.id)).size,
      channels: [...byCh].sort((a, b) => b[1].min - a[1].min).slice(0, 10).map(([id, c]) => ({ name: chNames.get(id) ?? '（消えた通話）', minutes: c.min, people: c.ids.size, engawa: engawa.has(id) })),
    },
    messages: {
      total: cur(daily).reduce((a, r) => a + r.msg, 0),
      totalPrev: prev(daily).reduce((a, r) => a + r.msg, 0),
      people: talkers.length,
      gender: { male: msgByGender('male'), female: msgByGender('female'), unknown: msgByGender('unknown') },
      median: quantile(talkers, 0.5),
      bins: messageBins(talkers),
      channels: archive.map((r) => ({ name: r.name || '（名前なし）', count: Number(r.n), people: Number(r.people) })).sort((a, b) => b.count - a.count).slice(0, 10),
    },
    shuin: {
      stamps: sc.length,
      stampsPrev: live.length - sc.length,
      givers: new Set(sc.map((s) => s.giver)).size,
      receivers: new Set(sc.map((s) => s.receiver)).size,
      revoked: stamps.filter((s) => s.revoked && s.at >= fromAt).length,
      specialCount: sp.length,
      specialTotal: sp.reduce((a, s) => a + s.amount, 0),
      promotions: autoRanks(cfg.ranks).slice(1).map((r) => ({ name: r.name, people: new Set(promotes.filter((p) => (p.detail as { to?: unknown }).to === r.key).map((p) => p.id)).size })),
    },
    coin: {
      plus: coinRows.reduce((a, r) => a + Number(r.plus), 0),
      minus: coinRows.reduce((a, r) => a + Number(r.minus), 0),
      balanceTotal: balances.reduce((a, b) => a + b, 0),
      balanceMedian: quantile(balances, 0.5),
      balanceP90: quantile(balances, 0.9),
      balanceMax: Math.max(0, ...balances),
      in: coinList('in'),
      out: coinList('out'),
    },
    casino: { plays: games.reduce((a, g) => a + g.plays, 0), players: Number(casinoAll?.players ?? 0), bet: games.reduce((a, g) => a + g.bet, 0), paid: games.reduce((a, g) => a + g.paid, 0), games },
    shop: { count: buys.length, people: new Set(buys.map((b) => b.id)).size, total: buys.reduce((a, b) => a + b.price, 0), kinds: tally(buys.map((b) => b.kind)).map(([kind, count]) => ({ kind, count })) },
    gacha: { count: draws.length, people: new Set(draws.map((d) => d.id)).size, total: draws.reduce((a, d) => a + d.price, 0) },
    omikuji: { count: kuji.length, people: new Set(kuji.map((k) => k.id)).size, fortunes: tally(kuji.map((k) => k.fortune)).map(([fortune, count]) => ({ fortune, count })) },
    guide: {
      count: recs.length,
      done: doneRecs.length,
      left: recs.filter((r) => r.status === 'left').length,
      waiting: recs.filter((r) => r.status === 'waiting' || r.status === 'assigned').length,
      guides: new Set(recs.map((r) => r.guide).filter(Boolean)).size,
      medianMinutes: quantile(doneRecs.map((r) => (r.finished!.getTime() - r.created.getTime()) / 60_000), 0.5),
    },
    invites: { count: inv.length, sources: tally(inv.map((i) => i.source)).map(([source, count]) => ({ source, count })) },
    cast: { requests: cast.length, done: castDone.length, customers: new Set(cast.map((c) => c.customer)).size, casts: new Set(castDone.map((c) => c.cast)).size, total: castDone.reduce((a, c) => a + c.price, 0), statuses: tally(cast.map((c) => c.status)).map(([status, count]) => ({ status, count })) },
    tickets: { count: tickets.length, types: tally(tickets.map((t) => t.type)).map(([type, count]) => ({ type, count })) },
    weekly,
  };
}

/** 集計を文にする（VPS で出して、チャットに貼る用） */
export async function buildServerReport(db: Db, cfg: GuildConfig, opts: ServerReportOptions = {}): Promise<string> {
  return serverReportText(await serverReportData(db, cfg, opts), cfg);
}

export function serverReportText(d: ServerReportData, cfg: GuildConfig): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const g = (s: Sex) => `男性 ${s.male}・女性 ${s.female}・不明 ${s.unknown}`;
  const p = d.people;
  const a = d.active;

  line('# サーバーのようすの集計（読むだけ・名前と ID は出さない）');
  line(`集計した時刻: ${d.at.toISOString()}（日本時間の日付 ${d.today}）・期間: ${d.from}〜${d.today}（${d.days} 日）。「前の期間」はすぐ前の同じ長さ（${d.prevFrom}〜${d.prevTo}）。`);
  line();

  line('## 1. 人数（BOT をのぞく）');
  line(`- 在籍: ${fmt(p.members)} 人（${g(p.gender)}）`);
  line(`- 年齢区分: 18 歳以上 ${p.adult}・18 歳未満 ${p.minor}・不明 ${p.ageUnknown}`);
  line(`- 役職（いちばん上で 1 人 1 回）: ${p.ranks.map((r) => `${r.name} ${r.count}`).join('・')}`);
  line(`- 入った: のべ ${p.joins} 回・${p.joinedPeople} 人（うち入り直し ${p.rejoined} 人）・前の期間 ${p.joinsPrev} 回 ／ ${g(p.joinedGender)}`);
  line(`- 抜けた: ${p.leaves} 回・前の期間 ${p.leavesPrev} 回`);
  line(`- 入った人のうち、今もいる: ${p.stayed} 人（${pct(p.stayed, p.joinedPeople)}）`);
  line();

  line('## 2. 浮上（その日に 1 回でも発言したか、通話にいた人。AFK・BOT はのぞく）');
  line(`- 期間に浮上した人: ${fmt(a.people)} 人（前の期間 ${fmt(a.peoplePrev)} 人）＝ 発言した ${a.msgPeople}・通話した ${a.vcPeople} ／ ${g(a.gender)}`);
  line(`- 1 日あたりの浮上: 平均 ${one(a.dau)} 人（前の期間 ${one(a.dauPrev)} 人）・いちばん多い日 ${a.peakDay} 人`);
  line(`- 在籍のうち浮上した: ${pct(a.activeMembers, p.members)}・浮上した人の、浮上した日数: 中央値 ${one(a.daysMedian)} 日 ／ 分布 ${binsText(a.daysBins)}`);
  line(`- 曜日ごとの浮上（1 日の平均）: ${a.weekday.map((w) => `${w.day} ${one(w.avg)}`).join('・')}`);
  line();

  line('## 3. 時間帯（日本時間。1 日あたりの平均の人数）');
  if (!d.hourly.days) line('- 時間帯の記録（activity_hourly）がまだありません。');
  else {
    line(`記録のある日: ${d.hourly.days} 日`);
    line('| 時 | 浮上 | 通話 | 発言 |');
    line('|---|---|---|---|');
    for (const r of d.hourly.rows) line(`| ${r.hour} 時 | ${one(r.active)} | ${one(r.voice)} | ${one(r.talk)} |`);
    const top = [...d.hourly.rows].sort((x, y) => y.active - x.active);
    line(`- いちばん多い時間: ${top.filter((r) => r.active > 0).slice(0, 3).map((r) => `${r.hour} 時（${one(r.active)} 人）`).join('・')} ／ 静かな時間: ${top.slice(-3).reverse().map((r) => `${r.hour} 時（${one(r.active)} 人）`).join('・')}`);
  }
  line();

  const v = d.voice;
  line('## 4. 通話（AFK などをのぞく。ミュートや 1 人の時間もふくむ）');
  line(`- 合計: ${hours(v.minutes)}（前の期間 ${hours(v.minutesPrev)}）・1 日あたり ${hours(v.minutes / d.days)}・通話した人 ${v.people} 人`);
  line(`- 男女: 男性 ${v.gender.male.people} 人 ${hours(v.gender.male.minutes)}・女性 ${v.gender.female.people} 人 ${hours(v.gender.female.minutes)}・不明 ${v.gender.unknown.people} 人 ${hours(v.gender.unknown.minutes)}`);
  line(`- 1 人あたり（通話した人）: 中央値 ${hours(v.median)} ／ 分布 ${binsText(v.bins)}`);
  line(`- 縁側: ${hours(v.engawaMinutes)}・${v.engawaPeople} 人`);
  line('- よく使われた通話（時間の多い順に 10）:');
  for (const c of v.channels) line(`  - ${c.name}: ${hours(c.minutes)}・${c.people} 人`);
  line();

  const m = d.messages;
  line('## 5. 発言（BOT が数えた数）');
  line(`- 合計: ${fmt(m.total)} 件（前の期間 ${fmt(m.totalPrev)} 件）・1 日あたり ${one(m.total / d.days)} 件・発言した人 ${m.people} 人`);
  line(`- 男女: 男性 ${fmt(m.gender.male)}・女性 ${fmt(m.gender.female)}・不明 ${fmt(m.gender.unknown)}`);
  line(`- 1 人あたり（発言した人）: 中央値 ${one(m.median)} 件 ／ 分布 ${binsText(m.bins)}`);
  if (m.channels.length) {
    line('- よく書かれたチャンネル（書き込みの記録から。多い順に 10）:');
    for (const c of m.channels) line(`  - #${c.name}: ${fmt(c.count)} 件・${c.people} 人`);
  }
  line();

  const s = d.shuin;
  line('## 6. 朱印・ご縁');
  line(`- 押された朱印: ${fmt(s.stamps)}（前の期間 ${fmt(s.stampsPrev)}）・押した人 ${s.givers} 人・押された人 ${s.receivers} 人・取り消し ${s.revoked}`);
  line(`- 特別ご縁: ${s.specialCount} 回・合計 ${fmt(s.specialTotal)}`);
  line(`- 自動で上がった: ${s.promotions.map((r) => `${r.name}へ ${r.people} 人`).join('・') || 'なし'}`);
  line();

  const c = d.coin;
  line(`## 7. ${cfg.economy.currencyName}（サーバーの通貨）`);
  line(`- 増えた合計 ${fmt(c.plus)}・減った合計 ${fmt(c.minus)}・差 ${c.plus - c.minus >= 0 ? '+' : ''}${fmt(c.plus - c.minus)}（カジノの賭けと払い戻しもふくむ）`);
  line(`- 今いる人の残高: 合計 ${fmt(c.balanceTotal)}・中央値 ${one(c.balanceMedian)}・上位 10% の人の境目 ${one(c.balanceP90)}・最大 ${fmt(c.balanceMax)}`);
  line('- 増えた理由（多い順に 12）:');
  for (const r of c.in.slice(0, 12)) line(`  - ${r.label}: +${fmt(r.amount)}・${r.people} 人`);
  line('- 減った理由（多い順に 12）:');
  for (const r of c.out.slice(0, 12)) line(`  - ${r.label}: −${fmt(r.amount)}・${r.people} 人`);
  line();

  const k = d.casino;
  line('## 8. カジノ（終わった回。胴元 = 賭けた − 戻った）');
  if (!k.games.length) line('- 遊んだ回はありません。');
  else {
    line(`- 全体: ${fmt(k.plays)} 回・遊んだ人 ${k.players} 人・賭けた ${fmt(k.bet)}・戻った ${fmt(k.paid)}・胴元 ${k.bet - k.paid >= 0 ? '+' : ''}${fmt(k.bet - k.paid)}・戻り率 ${pct(k.paid, k.bet)}`);
    line('| ゲーム | 回数 | 人 | 賭けた | 戻った | 胴元 | 戻り率 |');
    line('|---|---|---|---|---|---|---|');
    for (const x of k.games) line(`| ${x.game} | ${fmt(x.plays)} | ${x.players} | ${fmt(x.bet)} | ${fmt(x.paid)} | ${x.bet - x.paid >= 0 ? '+' : ''}${fmt(x.bet - x.paid)} | ${pct(x.paid, x.bet)} |`);
  }
  line();

  line('## 9. 授与所・物御籤・おみくじ');
  line(`- 授与所: ${fmt(d.shop.count)} 件・${d.shop.people} 人・合計 ${fmt(d.shop.total)}${d.shop.kinds.length ? ` ／ ${d.shop.kinds.slice(0, 10).map((x) => `${x.kind} ${x.count}`).join('・')}` : ''}`);
  line(`- 物御籤: ${fmt(d.gacha.count)} 回・${d.gacha.people} 人・合計 ${fmt(d.gacha.total)}`);
  line(`- おみくじ: ${fmt(d.omikuji.count)} 回・${d.omikuji.people} 人${d.omikuji.fortunes.length ? ` ／ ${d.omikuji.fortunes.map((x) => `${x.fortune} ${x.count}`).join('・')}` : ''}`);
  line();

  line('## 10. 案内・招待・キャスト・お問い合わせ');
  line(`- 案内: ${d.guide.count} 件（完了 ${d.guide.done}・途中で抜けた ${d.guide.left}・待ち/担当中 ${d.guide.waiting}）・案内した人 ${d.guide.guides} 人・受付から完了まで 中央値 ${one(d.guide.medianMinutes)} 分`);
  line(`- 招待で入った（記録）: ${d.invites.count} 人${d.invites.sources.length ? `（${d.invites.sources.map((x) => `${x.source} ${x.count}`).join('・')}）` : ''}`);
  line(`- キャスト: 申し込み ${d.cast.requests} 件・終わった ${d.cast.done} 件・指名した人 ${d.cast.customers} 人・指名されたキャスト ${d.cast.casts} 人・終わった分の合計 ${fmt(d.cast.total)}${d.cast.statuses.length ? ` ／ ${d.cast.statuses.map((x) => `${x.status} ${x.count}`).join('・')}` : ''}`);
  line(`- お問い合わせ（チケット）: ${d.tickets.count} 件${d.tickets.count ? ` ／ ${d.tickets.types.map((x) => `${x.type} ${x.count}`).join('・')}` : ''}`);
  line();

  line(`## 11. 週ごとの推移（月曜はじまり・日本時間・直近 ${d.weeks} 週。いちばん下の週は今日まで）`);
  line('浮上 = その週に発言か通話をした人（BOT をのぞく。退出した人もふくむ）。朱印は押された数（取り消し分をのぞく）。');
  line('| 週 | 浮上 | 発言した | 通話した | 通話の合計 | 縁側の合計 | 発言の数 | 朱印 | 入った | 抜けた |');
  line('|---|---|---|---|---|---|---|---|---|---|');
  for (const w of d.weekly) line(`| ${w.from.slice(5)}〜${w.to.slice(5)} | ${w.active} | ${w.talked} | ${w.voiced} | ${hours(w.voiceMinutes)} | ${hours(w.engawaMinutes)} | ${fmt(w.messages)} | ${w.stamps} | ${w.joined} | ${w.left} |`);
  return out.join('\n');
}
