import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { coinTx, economyAlerts, gachaDraws, marketOrders, members, shopItems, wallets, type EconomyAlert } from '../db/schema.js';
import type { DiscordActions } from '../lib/discordRest.js';
import { logger } from '../lib/logger.js';
import { jstDate } from './activity.js';
import { COIN_REASON_LABEL, deductUpTo } from './economy.js';
import { activeEvents, eventEffect } from './economyEvents.js';
import { balanceDistribution, currentSupply, flowOf, flowSummary } from './economyStats.js';
import { gachaUnitPrice } from './gacha.js';
import { namesOf } from './members.js';
import { ROOM_KIND_LABEL } from './tickets.js';

/**
 * 経済の見守り: サブアカウントの疑い・1 人ずつの収支・値段の目安・物御籤の収支・警告・週ごとのお知らせ・お賽銭。
 * 銭は鯖の中だけのもので、本物のお金とは関係ない。
 */

const DAY = 86_400_000;
const fmt = (n: number) => n.toLocaleString('ja-JP');

export type WatchCtx = { db: Db; cfg: GuildConfig; discord: DiscordActions };

// ───────── サブアカウントの疑い ─────────

export type SuspectPair = {
  kind: 'gift' | 'market';
  fromId: string;
  toId: string;
  count: number;
  total: number;
  /** 受け取った人が入ってから、最初に受け取るまでの日数 */
  toJoinedDaysBefore?: number;
  reasons: string[];
};

/**
 * 同じ相手とのやり取りが多い組（贈り物・市場）。
 * 受け取った人が入ったばかり・何度も・たくさん、のどれかに当てはまるものを、当てはまる数の多い順に
 */
export async function suspectPairs(db: Db, cfg: GuildConfig, since: Date, limit = 20): Promise<SuspectPair[]> {
  const gifts = await db
    .select({ memberId: coinTx.memberId, amount: coinTx.amount, detail: coinTx.detail, at: coinTx.at })
    .from(coinTx)
    .where(and(eq(coinTx.reason, 'gift_send'), gte(coinTx.at, since)));
  const orders = await db
    .select({ buyerId: marketOrders.buyerId, sellerId: marketOrders.sellerId, price: marketOrders.price, at: marketOrders.createdAt, status: marketOrders.status })
    .from(marketOrders)
    .where(gte(marketOrders.createdAt, since));
  const pairs = new Map<string, SuspectPair & { firstAt: Date }>();
  const add = (kind: SuspectPair['kind'], fromId: string, toId: string, amount: number, at: Date) => {
    const k = `${kind}\n${fromId}\n${toId}`;
    const p = pairs.get(k) ?? { kind, fromId, toId, count: 0, total: 0, reasons: [], firstAt: at };
    p.count++;
    p.total += amount;
    if (at < p.firstAt) p.firstAt = at;
    pairs.set(k, p);
  };
  for (const g of gifts) {
    const to = typeof g.detail.to === 'string' ? g.detail.to : undefined;
    if (to) add('gift', g.memberId, to, -g.amount, g.at);
  }
  // お年玉袋・掲示板の報酬: 置いた人・募集した人 → 受け取った人（贈り物と同じに数える）
  const bags = await db
    .select({ memberId: coinTx.memberId, amount: coinTx.amount, detail: coinTx.detail, at: coinTx.at })
    .from(coinTx)
    .where(and(inArray(coinTx.reason, ['otoshidama_get', 'board_reward']), gte(coinTx.at, since)));
  for (const g of bags) {
    const from = typeof g.detail.from === 'string' ? g.detail.from : undefined;
    if (from) add('gift', from, g.memberId, g.amount, g.at);
  }
  // 市場は、買った人 → 売った人（{通貨}が動く向き）
  for (const o of orders.filter((x) => x.status !== 'refunded')) add('market', o.buyerId, o.sellerId, o.price, o.at);

  const ids = [...new Set([...pairs.values()].map((p) => p.toId))];
  const joined = new Map(
    ids.length
      ? (await db.select({ id: members.id, joinedAt: members.joinedAt }).from(members).where(inArray(members.id, ids))).map((m) => [m.id, m.joinedAt])
      : [],
  );
  const bigTotal = cfg.economy.giftDailyLimit * 3;
  const out: SuspectPair[] = [];
  for (const p of pairs.values()) {
    const j = joined.get(p.toId);
    const days = j ? Math.floor((p.firstAt.getTime() - j.getTime()) / DAY) : undefined;
    const reasons = [
      ...(days !== undefined && days >= 0 && days < 7 ? [`入って ${days} 日で受け取った`] : []),
      ...(p.count >= 3 ? [`${p.count} 回`] : []),
      ...(p.total >= bigTotal ? [`合計 ${fmt(p.total)} 枚`] : []),
    ];
    if (!reasons.length) continue;
    const { firstAt: _f, ...rest } = p;
    out.push({ ...rest, ...(days !== undefined ? { toJoinedDaysBefore: days } : {}), reasons });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || b.total - a.total).slice(0, limit);
}

// ───────── 1 人ずつの収支 ─────────

export type MemberLedger = {
  balance: number;
  lifetimeEarned: number;
  earned: number;
  spent: number;
  earnedBy: { reason: string; label: string; amount: number; count: number }[];
  spentBy: { reason: string; label: string; amount: number; count: number }[];
  /** 日ごと（古い順。日本時間） */
  days: { date: string; earned: number; spent: number }[];
  /** 贈り物・市場でよくやり取りした相手 */
  partners: { memberId: string; sent: number; received: number }[];
};

export async function memberLedger(db: Db, memberId: string, since: Date, now: Date): Promise<MemberLedger> {
  const [w] = await db.select().from(wallets).where(eq(wallets.memberId, memberId));
  const rows = await db
    .select({ reason: coinTx.reason, amount: coinTx.amount, at: coinTx.at, detail: coinTx.detail })
    .from(coinTx)
    .where(and(eq(coinTx.memberId, memberId), gte(coinTx.at, since)));
  const group = (sign: 1 | -1) => {
    const m = new Map<string, { reason: string; label: string; amount: number; count: number }>();
    for (const r of rows.filter((x) => Math.sign(x.amount) === sign)) {
      const g = m.get(r.reason) ?? { reason: r.reason, label: COIN_REASON_LABEL[r.reason] ?? r.reason, amount: 0, count: 0 };
      g.amount += Math.abs(r.amount);
      g.count++;
      m.set(r.reason, g);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  const earnedBy = group(1);
  const spentBy = group(-1);
  const days: MemberLedger['days'] = [];
  for (let t = since.getTime(); t <= now.getTime(); t += DAY) days.push({ date: jstDate(new Date(t)), earned: 0, spent: 0 });
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const r of rows) {
    const d = byDate.get(jstDate(r.at));
    if (!d) continue;
    if (r.amount > 0) d.earned += r.amount;
    else d.spent -= r.amount;
  }
  const partners = new Map<string, { memberId: string; sent: number; received: number }>();
  const partner = (id: unknown) => {
    if (typeof id !== 'string') return undefined;
    const p = partners.get(id) ?? { memberId: id, sent: 0, received: 0 };
    partners.set(id, p);
    return p;
  };
  for (const r of rows) {
    if (r.reason === 'gift_send') {
      const p = partner(r.detail.to);
      if (p) p.sent -= r.amount;
    } else if (r.reason === 'gift_receive' || r.reason === 'otoshidama_get') {
      const p = partner(r.detail.from);
      if (p) p.received += r.amount;
    }
  }
  const orders = await db
    .select()
    .from(marketOrders)
    .where(and(gte(marketOrders.createdAt, since), sql`(${marketOrders.buyerId} = ${memberId} or ${marketOrders.sellerId} = ${memberId})`));
  for (const o of orders.filter((x) => x.status !== 'refunded')) {
    if (o.buyerId === memberId) {
      const p = partner(o.sellerId);
      if (p) p.sent += o.price;
    } else {
      const p = partner(o.buyerId);
      if (p) p.received += o.price - o.fee;
    }
  }
  return {
    balance: w?.balance ?? 0,
    lifetimeEarned: w?.lifetimeEarned ?? 0,
    earned: earnedBy.reduce((n, g) => n + g.amount, 0),
    spent: spentBy.reduce((n, g) => n + g.amount, 0),
    earnedBy,
    spentBy,
    days,
    partners: [...partners.values()].sort((a, b) => b.sent + b.received - (a.sent + a.received)).slice(0, 10),
  };
}

// ───────── 値段の目安 ─────────

export type PriceGuide = {
  /** 稼いでいる人（4 週で 1 枚以上もらった人）の、1 週間にもらう量のまん中 */
  weeklyMedian: number;
  earners: number;
  items: { name: string; price: number; days: number | null; level: 'cheap' | 'fair' | 'high' | 'very_high' | 'unknown' }[];
};

export const PRICE_LEVEL: Record<PriceGuide['items'][number]['level'], string> = {
  cheap: '安い（1 日分より少ない）',
  fair: 'ちょうどいい（1〜7 日分）',
  high: '高め（1〜4 週分）',
  very_high: 'とても高い（4 週より多い）',
  unknown: '—',
};

/** 配った（鯖が出した）{通貨}だけで数える（贈り物・市場の売り上げ・運営の調整は入れない） */
export async function priceGuide(db: Db, cfg: GuildConfig, now: Date): Promise<PriceGuide> {
  const since = new Date(now.getTime() - 28 * DAY);
  const issueReasons = Object.keys(COIN_REASON_LABEL).filter((r) => flowOf(r) === 'issue' && r !== 'gacha_reset' && r !== 'shuin_revoke');
  const rows = await db
    .select({ memberId: coinTx.memberId, total: sql<number>`coalesce(sum(${coinTx.amount}), 0)::int` })
    .from(coinTx)
    .where(and(gte(coinTx.at, since), inArray(coinTx.reason, issueReasons), gt(coinTx.amount, 0)))
    .groupBy(coinTx.memberId);
  const weekly = rows.map((r) => Number(r.total) / 4).sort((a, b) => a - b);
  const n = weekly.length;
  const median = n === 0 ? 0 : Math.round(n % 2 ? weekly[(n - 1) / 2]! : (weekly[n / 2 - 1]! + weekly[n / 2]!) / 2);
  const perDay = median / 7;
  const level = (price: number): PriceGuide['items'][number]['level'] => {
    if (!perDay) return 'unknown';
    const d = price / perDay;
    return d < 1 ? 'cheap' : d <= 7 ? 'fair' : d <= 28 ? 'high' : 'very_high';
  };
  const item = (name: string, price: number) => ({ name, price, days: perDay ? Math.round((price / perDay) * 10) / 10 : null, level: level(price) });
  const shop = await db.select().from(shopItems).where(eq(shopItems.enabled, true));
  const e = cfg.economy;
  const items = [
    ...shop.filter((s) => s.kind !== 'gift').map((s) => item(`${s.emoji}${s.name}`, s.kind === 'menzaifu' ? e.menzaifuPrice : s.price)),
    ...(cfg.gacha.enabled ? [item('🎁 物御籤 1 回', gachaUnitPrice(cfg.gacha)), item('🎊 物御籤 10 連', gachaUnitPrice(cfg.gacha) * 10)] : []),
    ...(Object.keys(ROOM_KIND_LABEL) as (keyof typeof ROOM_KIND_LABEL)[]).flatMap((k) => [
      ...(cfg.rooms.once[k] > 0 ? [item(`${ROOM_KIND_LABEL[k]}の部屋（1 回）`, cfg.rooms.once[k])] : []),
      ...(cfg.rooms.hourly[k] > 0 ? [item(`${ROOM_KIND_LABEL[k]}の部屋（1 時間）`, cfg.rooms.hourly[k])] : []),
    ]),
  ].filter((x) => x.price > 0);
  return { weeklyMedian: median, earners: n, items: items.sort((a, b) => a.price - b.price) };
}

// ───────── 物御籤の収支 ─────────

export type GachaLedger = {
  draws: number;
  /** 使われた{通貨}（払い戻しを引く） */
  income: number;
  /** 当たりで出た{通貨}・おすそ分け */
  coinsOut: number;
  /** 当たりで出たショップの品の値段の合計 */
  shopValue: number;
  /** 出た券・ロール（{通貨}では数えられないもの）の数 */
  tickets: number;
  roles: number;
  net: number;
};

export async function gachaLedger(db: Db, from: Date, to: Date): Promise<GachaLedger> {
  const sums = await db
    .select({ reason: coinTx.reason, total: sql<number>`coalesce(sum(${coinTx.amount}), 0)::bigint` })
    .from(coinTx)
    .where(and(gte(coinTx.at, from), lt(coinTx.at, to), inArray(coinTx.reason, ['gacha', 'gacha_refund', 'gacha_prize', 'gacha_share'])))
    .groupBy(coinTx.reason);
  const sum = (r: string) => Number(sums.find((x) => x.reason === r)?.total ?? 0);
  const [d] = await db
    .select({
      n: sql<number>`count(*)::int`,
      tickets: sql<number>`coalesce(sum(case when ${gachaDraws.ticket} is not null or ${gachaDraws.customTicketId} is not null then ${gachaDraws.ticketCount} else 0 end), 0)::int`,
      roles: sql<number>`count(${gachaDraws.roleId})::int`,
      shopValue: sql<number>`coalesce(sum(${shopItems.price}), 0)::int`,
    })
    .from(gachaDraws)
    .leftJoin(shopItems, eq(shopItems.id, gachaDraws.shopItemId))
    .where(and(gte(gachaDraws.createdAt, from), lt(gachaDraws.createdAt, to)));
  const income = -(sum('gacha') + sum('gacha_refund'));
  const coinsOut = sum('gacha_prize') + sum('gacha_share');
  const shopValue = Number(d?.shopValue ?? 0);
  return { draws: d?.n ?? 0, income, coinsOut, shopValue, tickets: d?.tickets ?? 0, roles: d?.roles ?? 0, net: income - coinsOut - shopValue };
}

// ───────── 警告 ─────────

/** 同じものを 2 回知らせないよう、印を付ける。はじめて付けたら true */
async function mark(db: Db, key: string, kind: string, memberId: string | null, amount: number, detail: Record<string, unknown> = {}): Promise<boolean> {
  const rows = await db.insert(economyAlerts).values({ key, kind, memberId, amount, detail }).onConflictDoNothing({ target: economyAlerts.key }).returning();
  return rows.length > 0;
}

export async function recentAlerts(db: Db, limit = 30): Promise<EconomyAlert[]> {
  return db
    .select()
    .from(economyAlerts)
    .where(inArray(economyAlerts.kind, ['earn', 'spend', 'saisen']))
    .orderBy(desc(economyAlerts.createdAt), desc(economyAlerts.id))
    .limit(limit);
}

/** 知らせる先（設定 → #記録） */
const watchChannel = (cfg: GuildConfig) => cfg.economyOps.channelId ?? cfg.channels.log;

/**
 * 24 時間で稼いだ・使った量が多い人を知らせる（1 人 1 日 1 回）。
 * 稼いだ量には贈り物・市場の売り上げも入れる（サブアカウントからの集めも見つけるため）。運営の調整は入れない
 */
export async function checkAlerts(ctx: WatchCtx, now = new Date()): Promise<EconomyAlert[]> {
  const o = ctx.cfg.economyOps;
  if (!o.alertsEnabled) return [];
  const since = new Date(now.getTime() - DAY);
  const rows = await ctx.db
    .select({
      memberId: coinTx.memberId,
      earned: sql<number>`coalesce(sum(case when ${coinTx.amount} > 0 then ${coinTx.amount} else 0 end), 0)::int`,
      spent: sql<number>`coalesce(sum(case when ${coinTx.amount} < 0 then -${coinTx.amount} else 0 end), 0)::int`,
    })
    .from(coinTx)
    .where(and(gte(coinTx.at, since), sql`${coinTx.reason} not in ('admin_grant', 'admin_take', 'adjust', 'saisen')`))
    .groupBy(coinTx.memberId);
  const date = jstDate(now);
  const fresh: EconomyAlert[] = [];
  for (const r of rows) {
    for (const [kind, amount, limit] of [
      ['earn', Number(r.earned), o.alertEarn24h],
      ['spend', Number(r.spent), o.alertSpend24h],
    ] as const) {
      if (limit <= 0 || amount < limit) continue;
      if (await mark(ctx.db, `${kind}:${r.memberId}:${date}`, kind, r.memberId, amount)) {
        fresh.push({ id: 0, key: '', kind, memberId: r.memberId, amount, detail: {}, createdAt: now });
      }
    }
  }
  const channel = watchChannel(ctx.cfg);
  if (fresh.length && channel) {
    const coin = `${ctx.cfg.economy.currencyEmoji}${ctx.cfg.economy.currencyName}`;
    const lines = fresh.map((a) => `- <@${a.memberId}> … 24 時間で ${fmt(a.amount)} 枚を${a.kind === 'earn' ? 'もらった' : '使った'}`);
    await ctx.discord
      .sendMessage(channel, {
        embeds: [
          {
            title: `⚠ ${coin}の動きが多い人`,
            description: [...lines, '', '-# 不正・バグ・サブアカウントでないか、社務所Web の「経済」→ その人の収支で確かめてください'].join('\n').slice(0, 4000),
            color: 0xe08a00,
          },
        ],
      })
      .catch((err: unknown) => logger.warn({ err }, 'economy alert post failed'));
  }
  return fresh;
}

// ───────── お賽銭（持ちすぎた分） ─────────

/** 持っている量が決めた量を超えた人から、超えた分の % を納めてもらう（週に 1 回・止めていれば何もしない） */
export async function collectSaisen(ctx: WatchCtx, now = new Date()): Promise<{ members: number; total: number }> {
  const o = ctx.cfg.economyOps;
  if (!o.saisenEnabled || o.saisenThreshold <= 0) return { members: 0, total: 0 };
  const rich = await ctx.db
    .select({ memberId: wallets.memberId, balance: wallets.balance })
    .from(wallets)
    .innerJoin(members, eq(members.id, wallets.memberId))
    .where(and(isNull(members.leftAt), eq(members.isBot, false), gt(wallets.balance, o.saisenThreshold)));
  const date = jstDate(now);
  const coin = `${ctx.cfg.economy.currencyEmoji}${ctx.cfg.economy.currencyName}`;
  let total = 0;
  let count = 0;
  for (const r of rich) {
    const amount = Math.floor(((r.balance - o.saisenThreshold) * o.saisenPercent) / 100);
    if (amount <= 0) continue;
    if (!(await mark(ctx.db, `saisen:${r.memberId}:${date}`, 'saisen', r.memberId, amount))) continue;
    const taken = await deductUpTo(ctx.db, r.memberId, amount, 'saisen', { threshold: o.saisenThreshold, percent: o.saisenPercent });
    if (taken <= 0) continue;
    total += taken;
    count++;
    await ctx.discord
      .sendDm(
        r.memberId,
        `⛩ 咲楽ノ宮より\n${coin}をたくさん貯めてくださり、ありがとうございます。${fmt(o.saisenThreshold)} 枚を超えた分の ${o.saisenPercent}%（${fmt(taken)} 枚）を、今週のお賽銭として納めていただきました。\n-# 鯖の中の${ctx.cfg.economy.currencyName}が増えすぎないようにするためのものです`,
      )
      .catch(() => false);
  }
  return { members: count, total };
}

// ───────── 週ごとのお知らせ ─────────

/** 週ごとのお知らせの文面（直近 7 日） */
export async function weeklyReport(ctx: WatchCtx, now = new Date()): Promise<{ title: string; description: string }> {
  const { db, cfg } = ctx;
  const e = cfg.economy;
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const from = new Date(now.getTime() - 7 * DAY);
  const prevFrom = new Date(now.getTime() - 14 * DAY);
  const [f, prev, supply, dist, g, suspects, events] = await Promise.all([
    flowSummary(db, from, now),
    flowSummary(db, prevFrom, from),
    currentSupply(db),
    balanceDistribution(db, 3),
    gachaLedger(db, from, now),
    suspectPairs(db, cfg, from, 3),
    activeEvents(db, now),
  ]);
  const back = f.issued ? Math.round((f.income / f.issued) * 100) : 0;
  const diff = (a: number, b: number) => (b ? ` （先週 ${fmt(b)}）` : '');
  const names = await namesOf(db, [...dist.top.map((t) => t.memberId), ...suspects.flatMap((s) => [s.fromId, s.toId])]);
  const nm = (id: string) => names.get(id) ?? id;
  const top3 = (lines: { label: string; amount: number }[]) =>
    lines
      .slice(0, 3)
      .map((l) => `${l.label} ${fmt(l.amount)}`)
      .join('・') || 'なし';
  const warn = [
    ...(f.issued > 0 && back < 50 ? [`⚠ 配った量のうち収入として戻ったのが ${back}%。${e.currencyName}が余り気味です（インフレ）`] : []),
    ...(dist.gini >= 0.6 ? [`⚠ 持っている量のかたより（ジニ係数）が ${dist.gini}。一部の人に集まっています`] : []),
    ...(suspects.length ? [`🕵 同じ相手とのやり取りが多い組が ${suspects.length} 組あります（${suspects.map((s) => `${nm(s.fromId)} → ${nm(s.toId)}`).join('、')}）`] : []),
  ];
  const lines = [
    `いま出回っている${coin}: **${fmt(supply)}** 枚`,
    '',
    `🎁 配った: **${fmt(f.issued)}** 枚${diff(f.issued, prev.issued)}`,
    `-# ${top3(f.issueLines)}`,
    `💴 鯖の収入: **${fmt(f.income)}** 枚${diff(f.income, prev.income)}（配った量の ${back}%）`,
    `-# ${top3(f.incomeLines)}`,
    ...(f.admin ? [`🛠 運営の調整: ${f.admin > 0 ? '+' : ''}${fmt(f.admin)} 枚`] : []),
    `🤝 贈り物 ${fmt(f.giftVolume)} 枚 ／ 市場の売り上げ ${fmt(f.marketVolume)} 枚`,
    `🎁 物御籤: ${fmt(g.draws)} 回・収入 ${fmt(g.income)} 枚・当たりで出た${e.currencyName}と品 ${fmt(g.coinsOut + g.shopValue)} 枚（差し引き ${g.net >= 0 ? '+' : ''}${fmt(g.net)}）`,
    `👛 持っている人 ${fmt(dist.holders)} 人・中央値 ${fmt(dist.median)} 枚・上位 10% が ${Math.round(dist.top10Share * 100)}%`,
    ...(events.length ? ['', `🎉 開催中: ${events.map((x) => `${x.title}（${eventEffect(x, e.currencyName)}）`).join('、')}`] : []),
    ...(warn.length ? ['', ...warn] : []),
    '',
    '-# くわしくは社務所Web の「経済」で',
  ];
  return { title: `📊 今週の${e.currencyName}の流れ`, description: lines.join('\n').slice(0, 4000) };
}

/** 決めた曜日・時（日本時間）なら、週ごとのお知らせとお賽銭（週に 1 回だけ） */
export async function weeklyTick(ctx: WatchCtx, now = new Date()): Promise<'sent' | 'not_time' | 'already' | 'off'> {
  const o = ctx.cfg.economyOps;
  if (!o.reportEnabled && !o.saisenEnabled) return 'off';
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  if (jst.getUTCDay() !== o.reportWeekday || jst.getUTCHours() !== o.reportHour) return 'not_time';
  if (!(await mark(ctx.db, `report:${jstDate(now)}`, 'report', null, 0))) return 'already';
  const saisen = await collectSaisen(ctx, now);
  const channel = watchChannel(ctx.cfg);
  if (o.reportEnabled && channel) {
    const r = await weeklyReport(ctx, now);
    const extra = saisen.members ? `\n🪙 今週のお賽銭: ${saisen.members} 人から ${fmt(saisen.total)} 枚` : '';
    await ctx.discord
      .sendMessage(channel, { embeds: [{ title: r.title, description: (r.description + extra).slice(0, 4096), color: 0xd4a017 }] })
      .catch((err: unknown) => logger.warn({ err }, 'weekly report post failed'));
  }
  return 'sent';
}
