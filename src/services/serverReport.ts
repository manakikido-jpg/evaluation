import { and, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
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
import { hourHistogram, messageHistogram, quantile } from './shuinReport.js';
import { engawaChannelIds } from './ujikoEvaluation.js';

/**
 * 📊 サーバーのようすの集計（読むだけ。DB・Discord・設定は何も変えない）。
 * 名前・ID は出さない。人数・合計・中央値・分布だけ（チャンネルの名前は出す）。VPS で src/scripts/server-report.ts から使う
 */

const DAY = 86_400_000;
const jstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const startOf = (date: string) => new Date(`${date}T00:00:00+09:00`);
const addDay = (date: string, n: number) => jstDate(new Date(startOf(date).getTime() + n * DAY));
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '―');
const one = (v: number | undefined) => (v === undefined ? '―' : Number.isInteger(v) ? fmt(v) : v.toFixed(1));
const hours = (m: number | undefined) => (m === undefined ? '―' : `${(m / 60).toFixed(1)} 時間`);
const median = (v: number[]) => one(quantile(v, 0.5));
/** 浮上した日数を段階に分けた人数 */
const dayHistogram = (v: number[]) => ([[1, 1, '1 日'], [2, 3, '2〜3 日'], [4, 7, '4〜7 日'], [8, 14, '8〜14 日'], [15, 29, '15〜29 日'], [30, Infinity, '30 日〜']] as const).map(([a, b, l]) => `${l}: ${v.filter((n) => n >= a && n <= b).length}`).join('  ');
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
/** 日付（YYYY-MM-DD）の曜日（0 = 月曜） */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export type ServerReportOptions = { now?: Date; /** 何日分を見るか（はじめは 30・365 まで） */ days?: number; /** 週ごとの推移の週の数（はじめは 8・26 まで） */ weeks?: number };

export async function buildServerReport(db: Db, cfg: GuildConfig, opts: ServerReportOptions = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const days = Math.min(365, Math.max(1, opts.days ?? 30));
  const weeks = Math.min(26, Math.max(1, opts.weeks ?? 8));
  const today = jstDate(now);
  const from = addDay(today, -(days - 1));
  const fromAt = startOf(from);
  const prevFrom = addDay(from, -days);
  const out: string[] = [];
  const line = (s = '') => out.push(s);

  const all = await db.select({ id: members.id, roleIds: members.roleIds, isBot: members.isBot, leftAt: members.leftAt, ageGroup: members.ageGroup }).from(members);
  const bots = new Set(all.filter((m) => m.isBot).map((m) => m.id));
  const people = all.filter((m) => !m.isBot && !m.leftAt);
  const here = new Set(people.map((p) => p.id));
  const genderOf = new Map(all.map((m) => [m.id, genderOfRoles(cfg, m.roleIds)]));
  const human = <T extends { id: string }>(rows: T[]) => rows.filter((r) => !bots.has(r.id));

  line('# サーバーのようすの集計（読むだけ・名前と ID は出さない）');
  line(`集計した時刻: ${now.toISOString()}（日本時間の日付 ${today}）・期間: ${from}〜${today}（${days} 日）。「前の期間」はすぐ前の同じ長さ（${prevFrom}〜${addDay(from, -1)}）。`);
  line();

  // ── 1. 人数
  const events = await db.select({ id: memberEvents.memberId, kind: memberEvents.kind, at: memberEvents.at }).from(memberEvents).where(and(inArray(memberEvents.kind, ['join', 'rejoin', 'leave']), gte(memberEvents.at, startOf(prevFrom))));
  const ev = human(events);
  const inSpan = (at: Date, a: string, b?: string) => at >= startOf(a) && (!b || at < startOf(b));
  const joined = ev.filter((e) => e.kind !== 'leave' && inSpan(e.at, from));
  const left = ev.filter((e) => e.kind === 'leave' && inSpan(e.at, from));
  const joinedPrev = ev.filter((e) => e.kind !== 'leave' && inSpan(e.at, prevFrom, from));
  const leftPrev = ev.filter((e) => e.kind === 'leave' && inSpan(e.at, prevFrom, from));
  const joinedIds = [...new Set(joined.map((e) => e.id))];
  const rejoined = new Set(joined.filter((e) => e.kind === 'rejoin').map((e) => e.id)).size;
  const count = <K extends string>(ids: string[], key: (id: string) => K) => {
    const m = new Map<K, number>();
    for (const id of ids) m.set(key(id), (m.get(key(id)) ?? 0) + 1);
    return m;
  };
  const genderLabel = (id: string) => (genderOf.get(id) === 'male' ? '男性' : genderOf.get(id) === 'female' ? '女性' : '不明');
  const genderLine = (ids: string[]) => {
    const g = count(ids, genderLabel);
    return `男性 ${g.get('男性') ?? 0}・女性 ${g.get('女性') ?? 0}・不明 ${g.get('不明') ?? 0}`;
  };
  line('## 1. 人数（BOT をのぞく）');
  line(`- 在籍: ${fmt(people.length)} 人（${genderLine(people.map((p) => p.id))}）`);
  const age = count(people.map((p) => p.id), (id) => all.find((m) => m.id === id)?.ageGroup ?? 'unknown');
  line(`- 年齢区分: 18 歳以上 ${age.get('adult') ?? 0}・18 歳未満 ${age.get('minor') ?? 0}・不明 ${age.get('unknown') ?? 0}`);
  const rankCount = count(people.map((p) => p.id), (id) => highestRank(cfg.ranks, all.find((m) => m.id === id)!.roleIds)?.name ?? '役職なし');
  line(`- 役職（いちばん上で 1 人 1 回）: ${[...cfg.ranks].sort((a, b) => a.weight - b.weight).map((r) => `${r.name} ${rankCount.get(r.name) ?? 0}`).join('・')}・役職なし ${rankCount.get('役職なし') ?? 0}`);
  line(`- 入った: のべ ${joined.length} 回・${joinedIds.length} 人（うち入り直し ${rejoined} 人）・前の期間 ${joinedPrev.length} 回 ／ ${genderLine(joinedIds)}`);
  line(`- 抜けた: ${left.length} 回・前の期間 ${leftPrev.length} 回`);
  line(`- 入った人のうち、今もいる: ${joinedIds.filter((id) => here.has(id)).length} 人（${pct(joinedIds.filter((id) => here.has(id)).length, joinedIds.length)}）`);
  line();

  // ── 2. 浮上
  const daily = human((await db.select({ id: activityDaily.memberId, date: activityDaily.date, msg: activityDaily.messageCount }).from(activityDaily).where(and(gte(activityDaily.date, prevFrom), lte(activityDaily.date, today)))));
  const vcRows = human((await db.select({ id: voiceUsage.memberId, date: voiceUsage.date, ch: voiceUsage.channelId, min: voiceUsage.minutes }).from(voiceUsage).where(and(gte(voiceUsage.date, prevFrom), lte(voiceUsage.date, today)))));
  const cur = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= from);
  const prev = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date < from);
  const activeDays = (msgRows: typeof daily, voice: typeof vcRows) => {
    const byDay = new Map<string, Set<string>>();
    for (const r of msgRows) if (r.msg > 0) (byDay.get(r.date) ?? byDay.set(r.date, new Set()).get(r.date)!).add(r.id);
    for (const r of voice) if (r.min > 0) (byDay.get(r.date) ?? byDay.set(r.date, new Set()).get(r.date)!).add(r.id);
    return byDay;
  };
  const byDay = activeDays(cur(daily), cur(vcRows));
  const byDayPrev = activeDays(prev(daily), prev(vcRows));
  const activeIds = new Set([...byDay.values()].flatMap((s) => [...s]));
  const activePrev = new Set([...byDayPrev.values()].flatMap((s) => [...s]));
  const dau = (m: Map<string, Set<string>>, n: number) => [...m.values()].reduce((a, s) => a + s.size, 0) / n;
  const msgIds = new Set(cur(daily).filter((r) => r.msg > 0).map((r) => r.id));
  const vcIds = new Set(cur(vcRows).filter((r) => r.min > 0).map((r) => r.id));
  const daysActive = [...activeIds].map((id) => [...byDay.values()].filter((s) => s.has(id)).length);
  line('## 2. 浮上（その日に 1 回でも発言したか、通話にいた人。AFK・BOT はのぞく）');
  line(`- 期間に浮上した人: ${fmt(activeIds.size)} 人（前の期間 ${fmt(activePrev.size)} 人）＝ 発言した ${msgIds.size}・通話した ${vcIds.size} ／ ${genderLine([...activeIds])}`);
  line(`- 1 日あたりの浮上: 平均 ${one(dau(byDay, days))} 人（前の期間 ${one(dau(byDayPrev, days))} 人）・いちばん多い日 ${Math.max(0, ...[...byDay.values()].map((s) => s.size))} 人`);
  line(`- 在籍のうち浮上した: ${pct([...activeIds].filter((id) => here.has(id)).length, people.length)}・浮上した人の、浮上した日数: 中央値 ${median(daysActive)} 日 ／ 分布 ${dayHistogram(daysActive)}`);
  const dayList = Array.from({ length: days }, (_, i) => addDay(from, i));
  const byWeekday = WEEKDAYS.map((_, w) => {
    const ds = dayList.filter((d) => weekday(d) === w);
    return ds.length ? ds.reduce((a, d) => a + (byDay.get(d)?.size ?? 0), 0) / ds.length : 0;
  });
  line(`- 曜日ごとの浮上（1 日の平均）: ${WEEKDAYS.map((w, i) => `${w} ${one(byWeekday[i])}`).join('・')}`);
  line();

  // ── 3. 時間帯
  const hourly = human((await db.select({ id: activityHourly.memberId, date: activityHourly.date, hour: activityHourly.hour, msg: activityHourly.messages, min: activityHourly.vcMinutes }).from(activityHourly).where(and(gte(activityHourly.date, from), lte(activityHourly.date, today)))));
  line('## 3. 時間帯（日本時間。1 日あたりの平均の人数）');
  if (!hourly.length) line('- 時間帯の記録（activity_hourly）がまだありません。');
  else {
    const recorded = new Set(hourly.map((r) => r.date)).size;
    const at = (h: number, f: (r: (typeof hourly)[number]) => boolean) => new Set(hourly.filter((r) => r.hour === h && f(r)).map((r) => `${r.date}:${r.id}`)).size / recorded;
    const rows = Array.from({ length: 24 }, (_, h) => ({ h, any: at(h, (r) => r.msg > 0 || r.min > 0), vc: at(h, (r) => r.min > 0), msg: at(h, (r) => r.msg > 0) }));
    line(`記録のある日: ${recorded} 日`);
    line('| 時 | 浮上 | 通話 | 発言 |');
    line('|---|---|---|---|');
    for (const r of rows) line(`| ${r.h} 時 | ${one(r.any)} | ${one(r.vc)} | ${one(r.msg)} |`);
    const top = [...rows].sort((a, b) => b.any - a.any);
    line(`- いちばん多い時間: ${top.filter((r) => r.any > 0).slice(0, 3).map((r) => `${r.h} 時（${one(r.any)} 人）`).join('・')} ／ 静かな時間: ${top.slice(-3).reverse().map((r) => `${r.h} 時（${one(r.any)} 人）`).join('・')}`);
  }
  line();

  // ── 4. 通話
  const vcCur = cur(vcRows);
  const vcPer = new Map<string, number>();
  for (const r of vcCur) vcPer.set(r.id, (vcPer.get(r.id) ?? 0) + r.min);
  const vcTotal = vcCur.reduce((a, r) => a + r.min, 0);
  const vcTotalPrev = prev(vcRows).reduce((a, r) => a + r.min, 0);
  const engawa = new Set(await engawaChannelIds(db, today));
  const chNames = new Map((await db.select({ id: voiceChannels.channelId, name: voiceChannels.name, cat: voiceChannels.categoryName }).from(voiceChannels)).map((c) => [c.id, `${c.cat ? `${c.cat} / ` : ''}${c.name}`]));
  const byCh = new Map<string, { min: number; ids: Set<string> }>();
  for (const r of vcCur) {
    const c = byCh.get(r.ch) ?? byCh.set(r.ch, { min: 0, ids: new Set() }).get(r.ch)!;
    c.min += r.min;
    c.ids.add(r.id);
  }
  const vcGender = count([...vcPer.keys()], genderLabel);
  const vcMinByGender = (g: string) => [...vcPer].filter(([id]) => genderLabel(id) === g).reduce((a, [, m]) => a + m, 0);
  line('## 4. 通話（AFK などをのぞく。ミュートや 1 人の時間もふくむ）');
  line(`- 合計: ${hours(vcTotal)}（前の期間 ${hours(vcTotalPrev)}）・1 日あたり ${hours(vcTotal / days)}・通話した人 ${vcPer.size} 人`);
  line(`- 男女: 男性 ${vcGender.get('男性') ?? 0} 人 ${hours(vcMinByGender('男性'))}・女性 ${vcGender.get('女性') ?? 0} 人 ${hours(vcMinByGender('女性'))}・不明 ${vcGender.get('不明') ?? 0} 人 ${hours(vcMinByGender('不明'))}`);
  line(`- 1 人あたり（通話した人）: 中央値 ${hours(quantile([...vcPer.values()], 0.5))} ／ 分布 ${hourHistogram([...vcPer.values()])}`);
  line(`- 縁側: ${hours(vcCur.filter((r) => engawa.has(r.ch)).reduce((a, r) => a + r.min, 0))}・${new Set(vcCur.filter((r) => engawa.has(r.ch) && r.min > 0).map((r) => r.id)).size} 人`);
  line('- よく使われた通話（時間の多い順に 10）:');
  for (const [id, c] of [...byCh].sort((a, b) => b[1].min - a[1].min).slice(0, 10)) line(`  - ${chNames.get(id) ?? '（消えた通話）'}: ${hours(c.min)}・${c.ids.size} 人`);
  line();

  // ── 5. 発言
  const msgCur = cur(daily);
  const msgPer = new Map<string, number>();
  for (const r of msgCur) msgPer.set(r.id, (msgPer.get(r.id) ?? 0) + r.msg);
  const msgTotal = msgCur.reduce((a, r) => a + r.msg, 0);
  const msgTotalPrev = prev(daily).reduce((a, r) => a + r.msg, 0);
  const talkers = [...msgPer.values()].filter((n) => n > 0);
  const msgByGender = (g: string) => [...msgPer].filter(([id]) => genderLabel(id) === g).reduce((a, [, n]) => a + n, 0);
  line('## 5. 発言（BOT が数えた数）');
  line(`- 合計: ${fmt(msgTotal)} 件（前の期間 ${fmt(msgTotalPrev)} 件）・1 日あたり ${one(msgTotal / days)} 件・発言した人 ${talkers.length} 人`);
  line(`- 男女: 男性 ${fmt(msgByGender('男性'))}・女性 ${fmt(msgByGender('女性'))}・不明 ${fmt(msgByGender('不明'))}`);
  line(`- 1 人あたり（発言した人）: 中央値 ${median(talkers)} 件 ／ 分布 ${messageHistogram(talkers)}`);
  const archive = (await db.select({ ch: messageArchive.channelId, name: messageArchive.channelName, author: messageArchive.authorId }).from(messageArchive).where(gte(messageArchive.createdAt, fromAt))).filter((r) => !bots.has(r.author));
  if (archive.length) {
    const byText = new Map<string, { name: string; n: number; ids: Set<string> }>();
    for (const r of archive) {
      const c = byText.get(r.ch) ?? byText.set(r.ch, { name: r.name ?? '', n: 0, ids: new Set() }).get(r.ch)!;
      c.n++;
      c.ids.add(r.author);
      if (r.name) c.name = r.name;
    }
    line('- よく書かれたチャンネル（書き込みの記録から。多い順に 10）:');
    for (const c of [...byText.values()].sort((a, b) => b.n - a.n).slice(0, 10)) line(`  - #${c.name || '（名前なし）'}: ${fmt(c.n)} 件・${c.ids.size} 人`);
  }
  line();

  // ── 6. 朱印・ご縁
  const stamps = await db.select({ giver: shuin.giverId, receiver: shuin.receiverId, at: shuin.createdAt, revoked: shuin.revokedAt }).from(shuin).where(gte(shuin.createdAt, startOf(prevFrom)));
  const live = stamps.filter((s) => !s.revoked);
  const sc = live.filter((s) => s.at >= fromAt);
  const sp = await db.select({ amount: specialGoen.amount }).from(specialGoen).where(and(isNull(specialGoen.revokedAt), gte(specialGoen.createdAt, fromAt)));
  line('## 6. 朱印・ご縁');
  line(`- 押された朱印: ${fmt(sc.length)}（前の期間 ${fmt(live.length - sc.length)}）・押した人 ${new Set(sc.map((s) => s.giver)).size} 人・押された人 ${new Set(sc.map((s) => s.receiver)).size} 人・取り消し ${stamps.filter((s) => s.revoked && s.at >= fromAt).length}`);
  line(`- 特別ご縁: ${sp.length} 回・合計 ${fmt(sp.reduce((a, s) => a + s.amount, 0))}`);
  const promotes = human((await db.select({ id: memberEvents.memberId, detail: memberEvents.detail }).from(memberEvents).where(and(eq(memberEvents.kind, 'promote'), gte(memberEvents.at, fromAt)))));
  const autos = autoRanks(cfg.ranks);
  line(`- 自動で上がった: ${autos.slice(1).map((r) => `${r.name}へ ${new Set(promotes.filter((p) => (p.detail as { to?: unknown }).to === r.key).map((p) => p.id)).size} 人`).join('・') || 'なし'}`);
  line();

  // ── 7. 銭
  const tx = human((await db.select({ id: coinTx.memberId, reason: coinTx.reason, amount: coinTx.amount }).from(coinTx).where(gte(coinTx.at, fromAt))));
  const byReason = new Map<string, { plus: number; minus: number; ids: Set<string> }>();
  for (const t of tx) {
    const r = byReason.get(t.reason) ?? byReason.set(t.reason, { plus: 0, minus: 0, ids: new Set() }).get(t.reason)!;
    if (t.amount > 0) r.plus += t.amount;
    else r.minus -= t.amount;
    r.ids.add(t.id);
  }
  const plus = tx.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const minus = -tx.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  const balances = (await db.select({ id: wallets.memberId, balance: wallets.balance }).from(wallets)).filter((w) => here.has(w.id)).map((w) => w.balance);
  const label = (k: string) => COIN_REASON_LABEL[k] ?? k;
  line(`## 7. ${cfg.economy.currencyName}（サーバーの通貨）`);
  line(`- 増えた合計 ${fmt(plus)}・減った合計 ${fmt(minus)}・差 ${plus - minus >= 0 ? '+' : ''}${fmt(plus - minus)}（カジノの賭けと払い戻しもふくむ）`);
  line(`- 今いる人の残高: 合計 ${fmt(balances.reduce((a, b) => a + b, 0))}・中央値 ${median(balances)}・上位 10% の人の境目 ${one(quantile(balances, 0.9))}・最大 ${fmt(Math.max(0, ...balances))}`);
  line('- 増えた理由（多い順に 12）:');
  for (const [k, r] of [...byReason].filter(([, r]) => r.plus > 0).sort((a, b) => b[1].plus - a[1].plus).slice(0, 12)) line(`  - ${label(k)}: +${fmt(r.plus)}・${r.ids.size} 人`);
  line('- 減った理由（多い順に 12）:');
  for (const [k, r] of [...byReason].filter(([, r]) => r.minus > 0).sort((a, b) => b[1].minus - a[1].minus).slice(0, 12)) line(`  - ${label(k)}: −${fmt(r.minus)}・${r.ids.size} 人`);
  line();

  // ── 8. カジノ
  const games = human((await db.select({ id: casinoGames.memberId, game: casinoGames.game, bet: casinoGames.bet, payout: casinoGames.payout }).from(casinoGames).where(and(gte(casinoGames.createdAt, fromAt), eq(casinoGames.status, 'done')))));
  line('## 8. カジノ（終わった回。胴元 = 賭けた − 戻った）');
  if (!games.length) line('- 遊んだ回はありません。');
  else {
    const g = new Map<string, { n: number; ids: Set<string>; bet: number; payout: number }>();
    for (const r of games) {
      const x = g.get(r.game) ?? g.set(r.game, { n: 0, ids: new Set(), bet: 0, payout: 0 }).get(r.game)!;
      x.n++;
      x.ids.add(r.id);
      x.bet += r.bet;
      x.payout += r.payout;
    }
    const bet = games.reduce((a, r) => a + r.bet, 0);
    const pay = games.reduce((a, r) => a + r.payout, 0);
    line(`- 全体: ${fmt(games.length)} 回・遊んだ人 ${new Set(games.map((r) => r.id)).size} 人・賭けた ${fmt(bet)}・戻った ${fmt(pay)}・胴元 ${bet - pay >= 0 ? '+' : ''}${fmt(bet - pay)}・戻り率 ${pct(pay, bet)}`);
    line('| ゲーム | 回数 | 人 | 賭けた | 戻った | 胴元 | 戻り率 |');
    line('|---|---|---|---|---|---|---|');
    for (const [k, x] of [...g].sort((a, b) => b[1].n - a[1].n)) line(`| ${k} | ${fmt(x.n)} | ${x.ids.size} | ${fmt(x.bet)} | ${fmt(x.payout)} | ${x.bet - x.payout >= 0 ? '+' : ''}${fmt(x.bet - x.payout)} | ${pct(x.payout, x.bet)} |`);
  }
  line();

  // ── 9. 授与所・物御籤・おみくじ
  const buys = human((await db.select({ id: shopPurchases.memberId, kind: shopPurchases.kind, price: shopPurchases.price }).from(shopPurchases).where(gte(shopPurchases.createdAt, fromAt))));
  const draws = human((await db.select({ id: gachaDraws.memberId, price: gachaDraws.price }).from(gachaDraws).where(gte(gachaDraws.createdAt, fromAt))));
  const kuji = human((await db.select({ id: omikuji.memberId, fortune: omikuji.fortune }).from(omikuji).where(gte(omikuji.date, from))));
  line('## 9. 授与所・物御籤・おみくじ');
  const bk = new Map<string, { n: number; price: number }>();
  for (const b of buys) {
    const x = bk.get(b.kind) ?? bk.set(b.kind, { n: 0, price: 0 }).get(b.kind)!;
    x.n++;
    x.price += b.price;
  }
  line(`- 授与所: ${fmt(buys.length)} 件・${new Set(buys.map((b) => b.id)).size} 人・合計 ${fmt(buys.reduce((a, b) => a + b.price, 0))}${bk.size ? ` ／ ${[...bk].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([k, x]) => `${k} ${x.n}`).join('・')}` : ''}`);
  line(`- 物御籤: ${fmt(draws.length)} 回・${new Set(draws.map((d) => d.id)).size} 人・合計 ${fmt(draws.reduce((a, d) => a + d.price, 0))}`);
  const fk = count(kuji.map((k) => k.fortune), (f) => f);
  line(`- おみくじ: ${fmt(kuji.length)} 回・${new Set(kuji.map((k) => k.id)).size} 人${fk.size ? ` ／ ${[...fk].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join('・')}` : ''}`);
  line();

  // ── 10. 案内・招待・キャスト・お問い合わせ
  const recs = await db.select({ status: guideReceptions.status, created: guideReceptions.createdAt, finished: guideReceptions.finishedAt, guide: guideReceptions.guideId }).from(guideReceptions).where(gte(guideReceptions.createdAt, fromAt));
  const doneRecs = recs.filter((r) => r.status === 'done' && r.finished);
  const inv = await db.select({ source: invites.source, at: invites.createdAt }).from(invites).where(gte(invites.createdAt, fromAt));
  const cast = await db.select({ status: castSessions.status, price: castSessions.price, customer: castSessions.customerId, cast: castSessions.castId }).from(castSessions).where(gte(castSessions.createdAt, fromAt));
  const tickets = await db.select({ type: supportTickets.typeKey }).from(supportTickets).where(gte(supportTickets.createdAt, fromAt));
  line('## 10. 案内・招待・キャスト・お問い合わせ');
  line(`- 案内: ${recs.length} 件（完了 ${doneRecs.length}・途中で抜けた ${recs.filter((r) => r.status === 'left').length}・待ち/担当中 ${recs.filter((r) => r.status === 'waiting' || r.status === 'assigned').length}）・案内した人 ${new Set(recs.map((r) => r.guide).filter(Boolean)).size} 人・受付から完了まで 中央値 ${one(quantile(doneRecs.map((r) => (r.finished!.getTime() - r.created.getTime()) / 60_000), 0.5))} 分`);
  const srcCount = count(inv.map((i) => i.source), (s) => s);
  line(`- 招待で入った（記録）: ${inv.length} 人${srcCount.size ? `（${[...srcCount].map(([s, n]) => `${s} ${n}`).join('・')}）` : ''}`);
  const castDone = cast.filter((c) => c.status === 'done');
  const castStatus = count(cast.map((c) => c.status), (s) => s);
  line(`- キャスト: 申し込み ${cast.length} 件・終わった ${castDone.length} 件・指名した人 ${new Set(cast.map((c) => c.customer)).size} 人・指名されたキャスト ${new Set(castDone.map((c) => c.cast)).size} 人・終わった分の合計 ${fmt(castDone.reduce((a, c) => a + c.price, 0))}${castStatus.size ? ` ／ ${[...castStatus].map(([s, n]) => `${s} ${n}`).join('・')}` : ''}`);
  line(`- お問い合わせ（チケット）: ${tickets.length} 件${tickets.length ? ` ／ ${[...count(tickets.map((t) => t.type), (s) => s)].map(([s, n]) => `${s} ${n}`).join('・')}` : ''}`);
  line();

  // ── 11. 週ごとの推移
  line(weeklyTrend({ today, weeks, daily: human((await db.select({ id: activityDaily.memberId, date: activityDaily.date, msg: activityDaily.messageCount }).from(activityDaily).where(and(gte(activityDaily.date, addDay(today, -7 * weeks - 7)), lte(activityDaily.date, today))))), voice: human((await db.select({ id: voiceUsage.memberId, date: voiceUsage.date, ch: voiceUsage.channelId, min: voiceUsage.minutes }).from(voiceUsage).where(and(gte(voiceUsage.date, addDay(today, -7 * weeks - 7)), lte(voiceUsage.date, today))))), engawa, stamps: (await db.select({ at: shuin.createdAt }).from(shuin).where(and(isNull(shuin.revokedAt), gte(shuin.createdAt, startOf(addDay(today, -7 * weeks - 7)))))), events: human((await db.select({ id: memberEvents.memberId, kind: memberEvents.kind, at: memberEvents.at }).from(memberEvents).where(and(inArray(memberEvents.kind, ['join', 'rejoin', 'leave']), gte(memberEvents.at, startOf(addDay(today, -7 * weeks - 7))), lt(memberEvents.at, new Date(now.getTime() + DAY)))))) }));
  return out.join('\n');
}

/** 週ごとの推移の表（月曜はじまり・日本時間。いちばん下の週は今日まで） */
function weeklyTrend(p: {
  today: string;
  weeks: number;
  daily: { id: string; date: string; msg: number }[];
  voice: { id: string; date: string; ch: string; min: number }[];
  engawa: ReadonlySet<string>;
  stamps: { at: Date }[];
  events: { id: string; kind: string; at: Date }[];
}): string {
  const monday = addDay(p.today, -weekday(p.today));
  const first = addDay(monday, -7 * (p.weeks - 1));
  const rows = [
    `## 11. 週ごとの推移（月曜はじまり・日本時間・直近 ${p.weeks} 週。いちばん下の週は今日まで）`,
    '浮上 = その週に発言か通話をした人（BOT をのぞく。退出した人もふくむ）。朱印は押された数（取り消し分をのぞく）。',
    '| 週 | 浮上 | 発言した | 通話した | 通話の合計 | 縁側の合計 | 発言の数 | 朱印 | 入った | 抜けた |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let w = 0; w < p.weeks; w++) {
    const a = addDay(first, 7 * w);
    const b = addDay(a, 6);
    const inWeek = (d: string) => d >= a && d <= b;
    const aAt = startOf(a).getTime();
    const bAt = aAt + 7 * DAY;
    const m = p.daily.filter((r) => inWeek(r.date) && r.msg > 0);
    const v = p.voice.filter((r) => inWeek(r.date) && r.min > 0);
    const msgIds = new Set(m.map((r) => r.id));
    const vcIds = new Set(v.map((r) => r.id));
    const ev = p.events.filter((e) => e.at.getTime() >= aAt && e.at.getTime() < bAt);
    rows.push(
      `| ${a.slice(5)}〜${b.slice(5)} | ${new Set([...msgIds, ...vcIds]).size} | ${msgIds.size} | ${vcIds.size} | ${hours(v.reduce((s, r) => s + r.min, 0))} | ${hours(v.filter((r) => p.engawa.has(r.ch)).reduce((s, r) => s + r.min, 0))} | ${fmt(m.reduce((s, r) => s + r.msg, 0))} | ${p.stamps.filter((x) => x.at.getTime() >= aAt && x.at.getTime() < bAt).length} | ${ev.filter((e) => e.kind !== 'leave').length} | ${ev.filter((e) => e.kind === 'leave').length} |`,
    );
  }
  return rows.join('\n');
}
