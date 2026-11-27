import { and, count, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { ema, emaKeepWarn, invites, memberAlts, members, settings } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { emaStepFrom, emaTiersShown, emaFreshSince, type EmaStep } from '../domain/ema.js';
import { ujikoProgress } from './ujikoRequirement.js';
import { validEmaCountOf } from './ema.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🎐 絵馬での昇格（新制度③）の ON/OFF。宮司が社務所Webで切り替える。
 * 既定は OFF＝従来どおり（参拝者→氏子はご縁40＋縁側20時間）。
 * ON＝参拝者→氏子は「お参り期間中に、毎週きまる数の絵馬（招待で補える）」で決める（ご縁・縁側時間は使わない。ujikoRequirement.ts）。
 * どちらでも自動降格はしない。今いる氏子は据え置き。
 */
const KEY = 'ema_promotion';

export async function emaPromotionEnabled(db: Db): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return (row?.value as { on?: boolean } | undefined)?.on === true;
}

export async function setEmaPromotion(db: Db, on: boolean, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KEY, value: { on }, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: { on }, updatedBy: by, updatedAt: new Date() } });
}

/** 昇格・維持の対象外（BOT・退出・運営サブ・承認ずみサブ）を除いた在籍メンバー */
async function targetMembers(db: Db): Promise<{ id: string; roleIds: string[] }[]> {
  const [people, alts, altRows] = await Promise.all([
    db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
  ]);
  const skip = new Set([...alts.map((a) => a.id), ...altRows.map((a) => a.id)]);
  return people.filter((p) => !skip.has(p.id));
}

/**
 * その段で「いま数えている枚数」と「必要な枚数」。
 * 参拝者→氏子はお参り期間中の氏子の票＋招待の補いと、毎週きまる必要数（ujikoProgress）。
 * 氏子→世話役・世話役→総代は、有効な票の枚数と設定の枚数。
 */
export async function emaStepProgress(db: Db, cfg: GuildConfig, memberId: string, step: EmaStep, now = new Date()): Promise<{ count: number; need: number }> {
  if (step.from === 'sanpaisha') {
    const p = await ujikoProgress(db, cfg, memberId, now);
    return { count: p.total, need: p.required };
  }
  return { count: await validEmaCountOf(db, memberId, now, step.tier), need: step.promote };
}

/**
 * 絵馬が必要枚数そろって、次の役職に昇格できる人の ID。
 * いまの役職の段（emaStepFrom）に応じて、数える票の種類と必要枚数が変わる：
 * 参拝者→氏子（お参り期間中・毎週きまる数・招待で補える）／世話役→総代（総代の票）。氏子→世話役は候補ごとの選挙（sewayakuElection.ts）。
 * 運営（神職・宮司など自動役職でない位が最上位の人）は対象外。
 */
export async function emaPromotable(db: Db, cfg: GuildConfig, now = new Date()): Promise<string[]> {
  const out: string[] = [];
  const people = (await targetMembers(db))
    .map((p) => ({ ...p, step: emaStepFrom(highestRank(cfg.ranks, p.roleIds)?.key, cfg.emaThresholds) }))
    .filter((p) => p.step && cfg.ranks.some((r) => r.key === p.step!.to));
  // 毎分の見回りが重くならないよう、参拝者は「今までの氏子の票＋招待の補い」が最低の数にも届かない人を先にまとめて外す
  const sanIds = people.filter((p) => p.step!.from === 'sanpaisha').map((p) => p.id);
  const upper = new Map<string, number>();
  if (sanIds.length) {
    const [votes, inv] = await Promise.all([
      db.select({ id: ema.receiverId, n: count() }).from(ema).where(and(inArray(ema.receiverId, sanIds), eq(ema.tier, 'ujiko'), isNull(ema.revokedAt))).groupBy(ema.receiverId),
      db.select({ id: invites.inviterId, n: count() }).from(invites).where(and(inArray(invites.inviterId, sanIds), isNotNull(invites.rewardedAt))).groupBy(invites.inviterId),
    ]);
    for (const r of votes) upper.set(r.id, Number(r.n));
    for (const r of inv) upper.set(r.id, (upper.get(r.id) ?? 0) + Math.min(Number(r.n), cfg.emaThresholds.inviteSubstituteMax));
  }
  for (const p of people) {
    const step = p.step!;
    if (step.from === 'sanpaisha' && (upper.get(p.id) ?? 0) < cfg.emaThresholds.ujikoMin) continue;
    const { count: have, need } = await emaStepProgress(db, cfg, p.id, step, now);
    if (have >= need) out.push(p.id);
  }
  return out;
}

/** 維持の警告: 氏子で、有効な絵馬が維持の枚数（ujikoKeep）未満の人（自動降格はしない・運営の手動判断用）。 */
export async function ujikoBelowKeep(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ id: string; count: number }[]> {
  const keep = cfg.emaThresholds.ujikoKeep;
  if (keep <= 0) return [];
  const out: { id: string; count: number }[] = [];
  for (const p of await targetMembers(db)) {
    if (highestRank(cfg.ranks, p.roleIds)?.key !== 'ujiko') continue;
    // 氏子の維持は「氏子の票＋参拝者の票（30日以内）」で数える
    const count = await validEmaCountOf(db, p.id, now, emaTiersShown('ujiko'));
    if (count < keep) out.push({ id: p.id, count });
  }
  return out.sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}

/**
 * 🎐 維持の注意を「1回だけ」お知らせする相手を集める（状態 ema_keep_warn を更新しながら）。
 * - 氏子の票が維持の枚数（ujikoKeep）を割っていて、
 * - これまでに一度は維持の枚数に届いたことがあり（据え置きで0枚のままの氏子には知らせない）、
 * - まだ今の「割っている状態」で知らせていない人、を返す。
 * 枚数が戻るとお知らせ状態を消すので、次にまた割ったら改めて知らせる。自動降格はしない。
 */
export async function collectEmaKeepWarnings(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ id: string; count: number }[]> {
  const keep = cfg.emaThresholds.ujikoKeep;
  if (keep <= 0) return [];
  const ujiko = (await targetMembers(db)).filter((p) => highestRank(cfg.ranks, p.roleIds)?.key === 'ujiko');
  if (!ujiko.length) return [];
  const ids = ujiko.map((p) => p.id);
  // 氏子の有効な票（氏子の票＋30日以内の参拝者の票・未取消）を一括で数える
  const countRows = await db
    .select({ id: ema.receiverId, n: count() })
    .from(ema)
    .where(and(inArray(ema.receiverId, ids), isNull(ema.revokedAt), or(eq(ema.tier, 'ujiko'), and(eq(ema.tier, 'sanpai'), gte(ema.createdAt, emaFreshSince(now))))))
    .groupBy(ema.receiverId);
  const countOf = new Map(countRows.map((r) => [r.id, Number(r.n)]));
  const stateRows = await db.select().from(emaKeepWarn).where(inArray(emaKeepWarn.memberId, ids));
  const stateOf = new Map(stateRows.map((r) => [r.memberId, r]));
  const toWarn: { id: string; count: number }[] = [];
  for (const id of ids) {
    const n = countOf.get(id) ?? 0;
    const st = stateOf.get(id);
    if (n >= keep) {
      // 健全：到達済みにし、注意の記録を消す（戻ったら、次に割ったらまた知らせる）
      if (!st || !st.reachedKeep || st.warnedAt != null) {
        await db
          .insert(emaKeepWarn)
          .values({ memberId: id, reachedKeep: true, warnedAt: null })
          .onConflictDoUpdate({ target: emaKeepWarn.memberId, set: { reachedKeep: true, warnedAt: null } });
      }
    } else if (st?.reachedKeep && st.warnedAt == null) {
      // 一度は届いたのに割った、かつまだ知らせていない → 今回知らせる（二度は知らせない）
      await db.update(emaKeepWarn).set({ warnedAt: now }).where(eq(emaKeepWarn.memberId, id));
      toWarn.push({ id, count: n });
    }
  }
  return toWarn;
}
