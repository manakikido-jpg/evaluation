import { desc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { coinTx, marketOrders, members, shopItems } from '../src/db/schema.js';
import type { DiscordActions, MessageBody } from '../src/lib/discordRest.js';
import { voiceTick } from '../src/services/activity.js';
import { addCoins, spendWithin, walletOf } from '../src/services/economy.js';
import { activeEvents, announceEvents, applyEvents, cancelEvent, createEvent, eventEffect, eventState, salePrice, voiceTicketDm, voiceTicketTick } from '../src/services/economyEvents.js';
import { ticketsOf } from '../src/services/tickets.js';
import { recordPresence } from '../src/services/voiceUsage.js';
import { checkAlerts, collectSaisen, gachaLedger, memberLedger, priceGuide, suspectPairs, weeklyReport, weeklyTick } from '../src/services/economyWatch.js';
import { gachaUnitPrice } from '../src/services/gacha.js';
import { recordJoin } from '../src/services/members.js';
import { ConfigStore } from '../src/services/settings.js';
import { priceOf } from '../src/services/shop.js';
import { cfg, makeDb } from './helpers.js';

const A = '880000000000000001';
const B = '880000000000000002';
const NEW = '880000000000000003';
const GUJI = '880000000000000009';
const LOG = '990000000000000001';
const NOW = new Date('2026-09-28T09:05:00+09:00'); // 月曜 9 時
const DAY = 86_400_000;
const snap = (id: string, joinedAt: Date | null = null) => ({ id, username: id, displayName: `n${id.slice(-1)}`, avatarUrl: null, roleIds: [], isBot: false, joinedAt });
const watchCfg = { ...cfg, channels: { ...cfg.channels, log: LOG } };

let db: Db;
let close: () => Promise<void>;
let sent: { channel: string; body: MessageBody }[];
let dms: { to: string; text: string }[];
const discord = {
  sendMessage: async (channel: string, body: MessageBody) => (sent.push({ channel, body }), { id: 'm' }),
  sendDm: async (to: string, text: string) => (dms.push({ to, text }), true),
} as unknown as DiscordActions;

beforeEach(async () => {
  ({ db, close } = await makeDb());
  sent = [];
  dms = [];
  await recordJoin(db, snap(A, new Date(NOW.getTime() - 100 * DAY)));
  await recordJoin(db, snap(B, new Date(NOW.getTime() - 100 * DAY)));
  await recordJoin(db, snap(NEW, new Date(NOW.getTime() - 2 * DAY)));
});
afterEach(async () => {
  await close();
});

/** 出入りを入れて、日時を合わせる */
async function tx(memberId: string, amount: number, reason: string, at: Date, detail: Record<string, unknown> = {}) {
  if (amount > 0) await addCoins(db, memberId, amount, reason as never, detail);
  else await spendWithin(db, memberId, -amount, reason as never, detail);
  const [last] = await db.select().from(coinTx).where(eq(coinTx.memberId, memberId)).orderBy(desc(coinTx.id)).limit(1);
  await db.update(coinTx).set({ at }).where(eq(coinTx.id, last!.id));
}

describe('🎉 期間限定イベント', () => {
  it('期間の間だけ設定に入る。同じ種類はいちばん大きいもの。やめたら効かない', async () => {
    const t = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    await createEvent(db, { kind: 'voice', value: 200, title: '通話 2 倍', startsAt: t(-1), endsAt: t(24) }, GUJI);
    await createEvent(db, { kind: 'shop', value: 20, title: 'セール', startsAt: t(-1), endsAt: t(24) }, GUJI);
    await createEvent(db, { kind: 'shop', value: 30, title: 'もっとセール', startsAt: t(-1), endsAt: t(24) }, GUJI);
    const later = await createEvent(db, { kind: 'gacha', value: 50, title: '物御籤半額', startsAt: t(10), endsAt: t(20) }, GUJI);
    const now = await activeEvents(db, NOW);
    expect(now.map((e) => e.title)).toEqual(['通話 2 倍', 'セール', 'もっとセール']);
    const c = applyEvents(cfg, now);
    expect(c.economy).toMatchObject({ voiceEventPercent: 200, shopSalePercent: 30, gachaSalePercent: 0 });
    expect(applyEvents(cfg, [])).toBe(cfg);
    expect(eventState(later, NOW)).toBe('upcoming');
    await cancelEvent(db, later.id, GUJI, NOW);
    expect(await activeEvents(db, t(15))).toHaveLength(3);
    expect(eventEffect({ kind: 'voice', value: 150 }, '銭')).toBe('通話でもらえる銭が 150%');
    expect(eventEffect({ kind: 'shop', value: 30 }, '銭')).toBe('授与品が 30% 引き');
  });

  it('🎫 通話で券: その日の通話が決めた分数になった人に 1 日 1 回、券を配る（位のない人・抜けた人・除外した通話はのぞく）', async () => {
    const RANK = cfg.ranks[0]!.roleId;
    const C = '880000000000000004';
    await recordJoin(db, snap(C, new Date(NOW.getTime() - 100 * DAY)));
    await db.update(members).set({ roleIds: [RANK] });
    await db.update(members).set({ roleIds: [] }).where(eq(members.id, NEW));
    await db.update(members).set({ leftAt: NOW }).where(eq(members.id, C));
    const AFK = '770000000000000009';
    const ch = (id: string, ids: string[]) => ({ id, name: id, categoryId: null, categoryName: null, memberIds: ids });
    const minute = (i: number) => new Date(NOW.getTime() - (20 - i) * 60_000);
    // まず全員 10 分（NEW は位なし・C は抜けた）。そのあと A は除外した通話に 5 分（数えない）、A・B が 1 分
    for (let i = 0; i < 10; i++) await recordPresence(db, [ch('770000000000000001', [A, B, NEW, C])], minute(i));
    const tcfg = { ...cfg, economy: { ...cfg.economy, excludedVoiceChannelIds: [AFK] } };
    const ev = await createEvent(db, { kind: 'voice_ticket', value: 11, title: '通話で券の日', startsAt: new Date(NOW.getTime() - 3_600_000), endsAt: new Date(NOW.getTime() + 3_600_000), ticket: 'gacha_free', ticketCount: 2 }, GUJI);
    expect(ev).toMatchObject({ ticket: 'gacha_free', ticketCount: 2 });
    expect(await voiceTicketTick(db, tcfg, NOW)).toEqual([]);
    for (let i = 10; i < 15; i++) await recordPresence(db, [ch(AFK, [A])], minute(i));
    expect(await voiceTicketTick(db, tcfg, NOW)).toEqual([]);
    await recordPresence(db, [ch('770000000000000001', [A, B])], minute(16));
    const got = await voiceTicketTick(db, tcfg, NOW);
    expect(got.map((g) => [g.memberId, g.minutes]).sort()).toEqual([
      [A, 11],
      [B, 11],
    ]);
    expect((await ticketsOf(db, A)).gacha_free).toBe(2);
    expect((await ticketsOf(db, NEW)).gacha_free).toBe(0);
    expect((await ticketsOf(db, C)).gacha_free).toBe(0);
    expect(voiceTicketDm(got[0]!)).toContain('🎁物御籤の無料券 ×2');
    // 同じ日は 2 回目なし。次の日はまた配る
    await recordPresence(db, [ch('770000000000000001', [A])], minute(17));
    expect(await voiceTicketTick(db, tcfg, NOW)).toEqual([]);
    const tomorrow = new Date(NOW.getTime() + 20 * 60_000 + DAY);
    // 終わったイベントでは配らない
    for (let i = 0; i < 12; i++) await recordPresence(db, [ch('770000000000000001', [A])], new Date(tomorrow.getTime() + i * 60_000));
    expect(await voiceTicketTick(db, tcfg, tomorrow)).toEqual([]);
    expect(eventEffect(ev, '銭')).toBe('その日の通話が 11 分になると 🎁物御籤の無料券 ×2（1 日 1 回）');
    // ほかの設定には入らない
    expect(applyEvents(cfg, [ev]).economy).toMatchObject({ voiceEventPercent: cfg.economy.voiceEventPercent, shopSalePercent: 0, gachaSalePercent: 0 });
  });

  it('🎫 通話で券: 何日も続くイベントは、日ごとに配る', async () => {
    await db.update(members).set({ roleIds: [cfg.ranks[0]!.roleId] });
    const ch = (ids: string[]) => [{ id: '770000000000000001', name: 'v', categoryId: null, categoryName: null, memberIds: ids }];
    await createEvent(db, { kind: 'voice_ticket', value: 1, title: '週間', startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + 7 * DAY) }, GUJI);
    await recordPresence(db, ch([A]), NOW);
    expect((await voiceTicketTick(db, cfg, NOW)).map((g) => g.memberId)).toEqual([A]);
    const next = new Date(NOW.getTime() + DAY);
    expect(await voiceTicketTick(db, cfg, next)).toEqual([]);
    await recordPresence(db, ch([A]), next);
    expect((await voiceTicketTick(db, cfg, next)).map((g) => g.memberId)).toEqual([A]);
    expect((await ticketsOf(db, A)).gacha_free).toBe(2);
  });

  it('設定の読み直しで入る（BOT・管理画面とも）', async () => {
    await createEvent(db, { kind: 'gacha', value: 50, title: '半額', startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + DAY) }, GUJI);
    const store = new ConfigStore(db, cfg);
    await store.refresh();
    expect(store.current.economy.gachaSalePercent).toBe(50);
  });

  it('セールの値段: 授与品（免罪符・贈り物はのぞく）・奉納割引と重ねる・物御籤', async () => {
    const e = { ...cfg.economy, shopSalePercent: 30, boostDiscountPercent: 10 };
    const item = (kind: string, price: number) => ({ id: 1, kind, name: 'x', emoji: '', description: '', price, roleId: null, roleGroup: null, durationDays: null, enabled: true, position: 0, boosterOnly: false, updatedAt: new Date() }) as never;
    expect(salePrice(1000, 30)).toBe(700);
    expect(salePrice(999, 0)).toBe(999);
    expect(priceOf(item('role', 1000), e)).toBe(700);
    expect(priceOf(item('role', 1000), e, true)).toBe(630);
    expect(priceOf(item('menzaifu', 0), e)).toBe(cfg.economy.menzaifuPrice);
    expect(gachaUnitPrice({ price: 500 }, 50)).toBe(250);
  });

  it('通話ボーナス: ふつうの分の % だけ増える（上限に数えない）', async () => {
    const e = { ...cfg.economy, voiceEventPercent: 200 };
    let got: { memberId: string; amount: number }[] = [];
    for (let m = 0; m < 10; m++) got = await voiceTick(db, e, [A], new Date(NOW.getTime() + m * 60_000));
    expect(got).toEqual([{ memberId: A, amount: cfg.economy.voicePer10Min * 2 }]);
  });

  it('始まり・終わりを知らせる（1 回だけ）', async () => {
    const e = await createEvent(
      db,
      { kind: 'voice', value: 200, title: '通話 2 倍週間', startsAt: new Date(NOW.getTime() - 60_000), endsAt: new Date(NOW.getTime() + DAY), announceChannelId: LOG },
      GUJI,
    );
    const ctx = { db, cfg, discord };
    expect(await announceEvents(ctx, NOW)).toBe(1);
    expect(await announceEvents(ctx, NOW)).toBe(0);
    expect(JSON.stringify(sent[0]!.body)).toContain('通話 2 倍週間');
    expect(JSON.stringify(sent[0]!.body)).toContain('2 倍');
    expect(await announceEvents(ctx, new Date(e.endsAt.getTime() + 1))).toBe(1);
    expect(JSON.stringify(sent[1]!.body)).toContain('終わりました');
  });
});

describe('🕵 サブアカウントの疑い', () => {
  it('入ったばかりの人に贈った・何度も・たくさん、の組。市場も', async () => {
    const since = new Date(NOW.getTime() - 30 * DAY);
    await addCoins(db, A, 100000, 'adjust');
    await addCoins(db, B, 1000, 'adjust');
    await tx(A, -500, 'gift_send', new Date(NOW.getTime() - DAY), { to: NEW });
    await tx(NEW, 500, 'gift_receive', new Date(NOW.getTime() - DAY), { from: A });
    for (let i = 0; i < 3; i++) await tx(A, -100, 'gift_send', new Date(NOW.getTime() - (i + 2) * DAY), { to: B });
    await tx(B, -50, 'gift_send', new Date(NOW.getTime() - DAY), { to: A }); // 1 回だけ・少し → 出ない
    for (let i = 0; i < 3; i++) await db.insert(marketOrders).values({ listingId: i + 1, buyerId: B, sellerId: A, price: 300, fee: 30, autoReleaseAt: NOW, createdAt: NOW } as never);
    const s = await suspectPairs(db, cfg, since);
    expect(s.map((p) => [p.kind, p.fromId, p.toId, p.count, p.total])).toEqual([
      ['market', B, A, 3, 900],
      ['gift', A, NEW, 1, 500],
      ['gift', A, B, 3, 300],
    ]);
    expect(s.find((p) => p.toId === NEW)!.reasons).toEqual(['入って 1 日で受け取った']);
  });
});

describe('📒 1 人ずつの収支', () => {
  it('もらった・使った理由ごと、日ごと、よくやり取りした相手', async () => {
    await tx(A, 3000, 'join_bonus', new Date(NOW.getTime() - 5 * DAY));
    await tx(A, 100, 'voice', new Date(NOW.getTime() - 2 * DAY));
    await tx(A, -500, 'gacha', new Date(NOW.getTime() - DAY));
    await tx(A, -200, 'gift_send', new Date(NOW.getTime() - DAY), { to: B });
    const l = await memberLedger(db, A, new Date(NOW.getTime() - 6 * DAY), NOW);
    expect(l).toMatchObject({ balance: 2400, earned: 3100, spent: 700 });
    expect(l.earnedBy.map((g) => [g.label, g.amount])).toEqual([
      ['初期配布', 3000],
      ['通話', 100],
    ]);
    expect(l.spentBy.map((g) => g.label)).toEqual(['物御籤', '贈り物を贈った']);
    expect(l.days).toHaveLength(7);
    expect(l.days.reduce((n, d) => n + d.earned, 0)).toBe(3100);
    expect(l.partners).toEqual([{ memberId: B, sent: 200, received: 0 }]);
  });
});

describe('🎯 値段の目安・🎁 物御籤の収支', () => {
  it('1 週間にもらう量のまん中から、何日分かを出す', async () => {
    // A: 4 週で 2800（週 700）・B: 1400（週 350）→ まん中 525、1 日 75
    await tx(A, 2800, 'voice', new Date(NOW.getTime() - 3 * DAY));
    await tx(B, 1400, 'voice', new Date(NOW.getTime() - 3 * DAY));
    await tx(B, 99999, 'admin_grant', new Date(NOW.getTime() - 3 * DAY)); // 調整は入れない
    await db.insert(shopItems).values([
      { kind: 'role', name: '安い', emoji: '', price: 50 },
      { kind: 'role', name: '高い', emoji: '', price: 3000 },
    ]);
    const g = await priceGuide(db, cfg, NOW);
    expect(g).toMatchObject({ weeklyMedian: 525, earners: 2 });
    expect(g.items.find((i) => i.name === '安い')).toMatchObject({ days: 0.7, level: 'cheap' });
    expect(g.items.find((i) => i.name === '高い')).toMatchObject({ days: 40, level: 'very_high' });
    expect(g.items.find((i) => i.name === '🎁 物御籤 1 回')).toMatchObject({ price: cfg.gacha.price });
  });

  it('物御籤: 使われた銭 − 当たりで出た銭（払い戻しは引く）', async () => {
    await tx(A, 10000, 'adjust', new Date(NOW.getTime() - 3 * DAY));
    await tx(A, -5000, 'gacha', new Date(NOW.getTime() - DAY));
    await tx(A, 500, 'gacha_refund', new Date(NOW.getTime() - DAY));
    await tx(A, 1200, 'gacha_prize', new Date(NOW.getTime() - DAY));
    const l = await gachaLedger(db, new Date(NOW.getTime() - 7 * DAY), NOW);
    expect(l).toMatchObject({ income: 4500, coinsOut: 1200, net: 3300 });
  });
});

describe('⚠ 警告・🪙 お賽銭・📊 週ごとのお知らせ', () => {
  it('24 時間で多くもらった・使った人を 1 日 1 回知らせる（運営の調整は数えない）', async () => {
    const ctx = { db, cfg: { ...watchCfg, economyOps: { ...cfg.economyOps, alertEarn24h: 1000, alertSpend24h: 500 } }, discord };
    await tx(A, 1500, 'voice', new Date(NOW.getTime() - 3_600_000));
    await tx(A, -600, 'gacha', new Date(NOW.getTime() - 3_600_000));
    await tx(B, 50000, 'admin_grant', new Date(NOW.getTime() - 3_600_000));
    const a = await checkAlerts(ctx, NOW);
    expect(a.map((x) => [x.kind, x.memberId, x.amount])).toEqual([
      ['earn', A, 1500],
      ['spend', A, 600],
    ]);
    expect(sent[0]!.channel).toBe(LOG);
    expect(await checkAlerts(ctx, NOW)).toEqual([]);
    expect(await checkAlerts({ ...ctx, cfg: { ...ctx.cfg, economyOps: { ...ctx.cfg.economyOps, alertsEnabled: false } } }, NOW)).toEqual([]);
  });

  it('お賽銭: 止めていれば何もしない。超えた分の % を納めてもらい DM', async () => {
    await addCoins(db, A, 60000, 'adjust');
    await addCoins(db, B, 10000, 'adjust');
    expect(await collectSaisen({ db, cfg, discord }, NOW)).toEqual({ members: 0, total: 0 });
    const on = { ...cfg, economyOps: { ...cfg.economyOps, saisenEnabled: true, saisenThreshold: 50000, saisenPercent: 10 } };
    expect(await collectSaisen({ db, cfg: on, discord }, NOW)).toEqual({ members: 1, total: 1000 });
    expect((await walletOf(db, A)).balance).toBe(59000);
    expect(dms[0]!.to).toBe(A);
    // 同じ日は 2 回目なし
    expect(await collectSaisen({ db, cfg: on, discord }, NOW)).toEqual({ members: 0, total: 0 });
  });

  it('週ごとのお知らせ: 決めた曜日・時に 1 回だけ（#記録 へ）', async () => {
    await tx(A, 3000, 'join_bonus', new Date(NOW.getTime() - DAY));
    await tx(A, -500, 'gacha', new Date(NOW.getTime() - DAY));
    const ctx = { db, cfg: watchCfg, discord };
    const r = await weeklyReport(ctx, NOW);
    expect(r.description).toContain('配った: **3,000** 枚');
    expect(r.description).toContain('鯖の収入: **500** 枚');
    expect(await weeklyTick(ctx, new Date(NOW.getTime() - 3_600_000))).toBe('not_time');
    expect(await weeklyTick(ctx, NOW)).toBe('sent');
    expect(await weeklyTick(ctx, NOW)).toBe('already');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.channel).toBe(LOG);
  });
});
