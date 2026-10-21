import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { GuildConfig, Rank } from '../config.js';
import type { Db } from '../db/client.js';
import { activityDaily, memberEvents, members, shuin, specialGoen, voiceUsage } from '../db/schema.js';
import { autoRanks, highestRank } from '../domain/ranks.js';
import { resetState } from './evalReset.js';

/**
 * 📊 御朱印の昇格条件を考えるための集計（読むだけ。DB・Discord は何も変えない）。
 * 名前・ID は出さない。人数・中央値・分布だけ。VPS で src/scripts/shuin-report.ts から使う
 */

const DAY = 86_400_000;
/** 日本時間の日付（YYYY-MM-DD） */
const jstDate = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

/** 並べた数の q 番目（0〜1）。線形補間。空なら undefined */
export function quantile(values: readonly number[], q: number): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const BINS: [number, number][] = [[0, 0], [1, 4], [5, 9], [10, 14], [15, 19], [20, 29], [30, 49], [50, 99], [100, Infinity]];
/** 0／1〜4／…／100〜 の人数 */
export function histogram(values: readonly number[]): string {
  return BINS.map(([a, b]) => `${a === b ? a : b === Infinity ? `${a}〜` : `${a}〜${b}`}: ${values.filter((v) => v >= a && v <= b).length}`).join('  ');
}

const num = (v: number | undefined) => (v === undefined ? '―' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '―');
const summary = (v: number[]) => `中央値 ${num(quantile(v, 0.5))}（25%: ${num(quantile(v, 0.25))}・75%: ${num(quantile(v, 0.75))}・最大 ${num(v.length ? Math.max(...v) : undefined)}）`;

export type ShuinReportOptions = { now?: Date; proposal?: Record<string, number> };

export async function buildShuinReport(db: Db, cfg: GuildConfig, opts: ShuinReportOptions = {}): Promise<string> {
  const now = opts.now ?? new Date();
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const ranks = cfg.ranks;
  const autos = autoRanks(ranks);

  // ── 1. 条件と朱印の点数
  line('# 御朱印の昇格条件の集計（読むだけ・名前と ID は出さない）');
  line(`集計した時刻: ${now.toISOString()}（日本時間の日付 ${jstDate(now)}）`);
  line();
  line('## 1. いまの条件と、押す朱印の点数');
  for (const r of [...ranks].sort((a, b) => a.weight - b.weight)) line(`- ${r.name}（${r.key}）: 押す朱印 ${r.weight} 点 ・ ${r.auto ? `自動昇格 ご縁 ${r.requiredGoen}` : '任命制'}`);
  const reset = await resetState(db);
  if (reset && !reset.undoneAt) line(`- 評価のリセット: ${reset.at} に実行（それより前の朱印は取り消し済み）`);
  line();

  // ── 2. 人数（BOT・退出者を除く）。いちばん上の役職で分ける
  const people = (await db.select({ id: members.id, roleIds: members.roleIds, joinedAt: members.joinedAt }).from(members).where(and(isNull(members.leftAt), eq(members.isBot, false))));
  const rankOf = new Map<string, Rank | undefined>(people.map((p) => [p.id, highestRank(ranks, p.roleIds)]));
  const groups: { label: string; key: string; ids: string[] }[] = [
    ...[...ranks].sort((a, b) => a.weight - b.weight).map((r) => ({ label: r.name, key: r.key, ids: people.filter((p) => rankOf.get(p.id)?.key === r.key).map((p) => p.id) })),
    { label: '役職なし', key: '', ids: people.filter((p) => !rankOf.get(p.id)).map((p) => p.id) },
  ];
  line('## 2. 在籍の人数（BOT・退出者を除く。いちばん上の役職で数える）');
  line(`- ぜんぶ: ${people.length} 人`);
  for (const g of groups) line(`- ${g.label}: ${g.ids.length} 人`);
  line();

  // ── 3. 浮上（発言・通話）
  const since = (days: number) => jstDate(new Date(now.getTime() - (days - 1) * DAY));
  const activeSets = async (days: number) => {
    const from = since(days);
    const msg = new Set((await db.select({ id: activityDaily.memberId }).from(activityDaily).where(and(gte(activityDaily.date, from), gte(activityDaily.messageCount, 1)))).map((r) => r.id));
    const vc = new Set((await db.select({ id: voiceUsage.memberId }).from(voiceUsage).where(and(gte(voiceUsage.date, from), gte(voiceUsage.minutes, 1)))).map((r) => r.id));
    return { msg, vc };
  };
  const act = { 7: await activeSets(7), 30: await activeSets(30) };
  line('## 3. 浮上した人数と浮上率');
  line('判定: 発言 = BOT が数えた発言が 1 回以上ある日がある（activity_daily）。通話 = AFK などを除いた通話に 1 分以上いた日がある（voice_usage）。期間は今日をふくむ日本時間の 7 日・30 日。両方した人は「浮上」で 1 人と数える。');
  for (const d of [7, 30] as const) {
    line(`### 直近 ${d} 日`);
    for (const g of groups) {
      const m = g.ids.filter((id) => act[d].msg.has(id));
      const v = g.ids.filter((id) => act[d].vc.has(id));
      const both = m.filter((id) => act[d].vc.has(id)).length;
      const any = new Set([...m, ...v]).size;
      line(`- ${g.label}（${g.ids.length} 人）: 浮上 ${any} 人（${pct(any, g.ids.length)}）＝ 発言だけ ${m.length - both}・通話だけ ${v.length - both}・両方 ${both}`);
    }
  }
  line();

  // ── 4. 朱印をくれた人数・ご縁（特別ご縁は分ける）
  const live = await db.select({ giver: shuin.giverId, receiver: shuin.receiverId, weight: shuin.weight, at: shuin.createdAt }).from(shuin).where(isNull(shuin.revokedAt));
  const sp = await db.select({ id: specialGoen.memberId, amount: specialGoen.amount }).from(specialGoen).where(isNull(specialGoen.revokedAt));
  const givers = new Map<string, number>();
  const shuinGoen = new Map<string, number>();
  const gave = new Map<string, number>();
  for (const s of live) {
    givers.set(s.receiver, (givers.get(s.receiver) ?? 0) + 1);
    shuinGoen.set(s.receiver, (shuinGoen.get(s.receiver) ?? 0) + s.weight);
    gave.set(s.giver, (gave.get(s.giver) ?? 0) + 1);
  }
  const special = new Map<string, number>();
  for (const s of sp) special.set(s.id, (special.get(s.id) ?? 0) + s.amount);
  const total = (id: string) => (shuinGoen.get(id) ?? 0) + (special.get(id) ?? 0);
  line('## 4. 朱印をくれた人数・ご縁（取り消し分は除く）');
  line('「朱印のご縁」は通常の朱印だけ。「特別ご縁」は宮司が振った分。昇格に使うのは、その合計。');
  for (const g of groups) {
    if (!g.ids.length) continue;
    const gv = g.ids.map((id) => givers.get(id) ?? 0);
    const sg = g.ids.map((id) => shuinGoen.get(id) ?? 0);
    const spv = g.ids.map((id) => special.get(id) ?? 0);
    const tv = g.ids.map(total);
    const gaveV = g.ids.map((id) => gave.get(id) ?? 0);
    line(`### ${g.label}（${g.ids.length} 人）`);
    line(`- 朱印をくれた人数: ${summary(gv)}`);
    line(`  分布 ${histogram(gv)}`);
    line(`- 朱印のご縁: ${summary(sg)}`);
    line(`  分布 ${histogram(sg)}`);
    line(`- 特別ご縁: もらった人 ${spv.filter((v) => v > 0).length} 人・${summary(spv.filter((v) => v > 0))}`);
    line(`- 合計のご縁: ${summary(tv)}`);
    line(`- 自分が朱印を押した相手の数: ${summary(gaveV)}`);
  }
  // やり取り: 直近 30 日に押した・押された人
  const from30 = new Date(now.getTime() - 30 * DAY);
  const recentGive = new Set(live.filter((s) => s.at >= from30).map((s) => s.giver));
  const recentGet = new Set(live.filter((s) => s.at >= from30).map((s) => s.receiver));
  const here = new Set(people.map((p) => p.id));
  line(`- 直近 30 日に朱印を押した在籍の人: ${[...recentGive].filter((id) => here.has(id)).length} 人 ・ 押された在籍の人: ${[...recentGet].filter((id) => here.has(id)).length} 人`);
  line();

  // ── 5. 参加から昇格までの日数
  line('## 5. 新しく入った人が、氏子・世話役になるまでの日数');
  const startAt = reset && !reset.undoneAt ? new Date(reset.at) : undefined;
  const promos = await db.select({ id: memberEvents.memberId, detail: memberEvents.detail, at: memberEvents.at }).from(memberEvents).where(eq(memberEvents.kind, 'promote'));
  const joins = await db.select({ id: memberEvents.memberId, at: memberEvents.at }).from(memberEvents).where(inArray(memberEvents.kind, ['join', 'rejoin']));
  const firstJoinLogged = joins.length ? new Date(Math.min(...joins.map((j) => j.at.getTime()))) : undefined;
  line(`- 参加の記録（member_events）のいちばん古い日: ${firstJoinLogged ? jstDate(firstJoinLogged) : 'なし'}${startAt ? ` ・ 評価のリセット ${jstDate(startAt)} より後だけを数える` : ''}`);
  line('- 数え方: 在籍中の人の参加日（members.joined_at。入り直した人は最後の参加日）から、その役職以上への昇格の記録（promote）がはじめて出るまで。届いていない人は「参加してからの日数」を別に出す（まだ届いていないだけで、これから届く人もいる）。');
  const order = new Map(autos.map((r, i) => [r.key, i]));
  for (const target of autos.slice(1)) {
    const t = order.get(target.key)!;
    const reached: number[] = [];
    const waiting: number[] = [];
    for (const p of people) {
      if (!p.joinedAt) continue;
      const base = startAt && startAt > p.joinedAt ? startAt : p.joinedAt;
      if (firstJoinLogged && p.joinedAt < firstJoinLogged) continue;
      const hit = promos
        .filter((e) => e.id === p.id && e.at >= base && (order.get(String((e.detail as { to?: unknown }).to)) ?? -1) >= t)
        .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
      if (hit) reached.push((hit.at.getTime() - base.getTime()) / DAY);
      else if (!rankOf.get(p.id) || (order.get(rankOf.get(p.id)!.key) ?? -1) < t) waiting.push((now.getTime() - base.getTime()) / DAY);
    }
    line(`### ${target.name}`);
    line(`- 届いた: ${reached.length} 人 ・ 日数 ${summary(reached)}`);
    line(`- まだ: ${waiting.length} 人 ・ 参加してからの日数 ${summary(waiting)}`);
  }
  line('- 偏り: 記録が始まる前に入った人・評価のリセット前の昇格は数えない。退出した人は数えない（早くやめた人が抜ける）。手でロールを付けた昇格は記録に出ない。');
  line();

  // ── 6. 条件ごとに届く人数
  line('## 6. 条件ごとに、届く人数（自動昇格の役職の人と役職なしの人。合計のご縁で）');
  const pool = people.filter((p) => !rankOf.get(p.id) || rankOf.get(p.id)!.auto).map((p) => p.id);
  const active30 = new Set([...act[30].msg, ...act[30].vc]);
  const traded = new Set([...recentGive, ...recentGet]);
  const plans: [string, Record<string, number>][] = [['いまの条件', Object.fromEntries(autos.map((r) => [r.key, r.requiredGoen]))]];
  if (opts.proposal) plans.push(['暫定案', opts.proposal]);
  line(`対象 ${pool.length} 人（うち直近 30 日に浮上 ${pool.filter((id) => active30.has(id)).length} 人・直近 30 日に朱印のやり取り ${pool.filter((id) => traded.has(id)).length} 人）`);
  for (const [label, need] of plans) {
    line(`### ${label}`);
    for (const r of autos) {
      const n = need[r.key];
      if (n === undefined) continue;
      const ok = pool.filter((id) => total(id) >= n);
      line(`- ${r.name}（ご縁 ${n}）以上: ${ok.length} 人（${pct(ok.length, pool.length)}）・浮上した人のうち ${ok.filter((id) => active30.has(id)).length} 人・やり取りした人のうち ${ok.filter((id) => traded.has(id)).length} 人`);
    }
  }
  return out.join('\n');
}
