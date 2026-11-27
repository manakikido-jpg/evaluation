import { and, count, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { ema, invites, memberAlts, members, settings, ujikoKeepState } from '../db/schema.js';
import { emaFreshSince } from '../domain/ema.js';
import { highestRank } from '../domain/ranks.js';
import { ujikoCountFrom } from './sewayakuElection.js';
import { newSystemStartedAt } from './shuin.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🍃 氏子のキープと 🍂 元氏子（新制度・本人の決定 2026-11-27）。
 * - 氏子は keepDays（30日）ごとに判定。判定の日に有効な絵馬が keepNeed（20）、うち keepFromSanpai（10）は参拝者・元氏子から。
 *   招待（招待した人が通話4時間で1人・その判定の期間中）で keepInviteMax（5）まで補える（合計にも「参拝者から」にも足す）。
 * - 判定の7日前に、足りなければ「あと◯枚」を知らせる。
 * - 足りないと元氏子に（お守りがあれば1回防ぐ。前の判定で使った人は使えない）。元氏子のロールが未設定のあいだは降格しない。
 * - 元氏子は、元氏子になってからの絵馬が motoNeed（15）、うち motoFromSanpai（10）は参拝者・元氏子から（招待で motoInviteMax まで）で氏子に戻る。
 * - 最初の判定は「氏子になった日」と「④ご縁のリセットの日」の遅いほうから keepDays 日後。③④が済むまで動かない。
 * 役職（ロール）の付け外しは呼ぶ側（Discord）が行う。ここは数えて、状態の表を進めるだけ。
 */

const DAY = 86_400_000;
const ROLES_KEY = 'new_system_roles';

export type NewSystemRoles = { motoUjiko?: string; aramitama?: string };

/** 元氏子・荒魂のロール ID（社務所Web で入れる。なければ未設定） */
export async function newSystemRoles(db: Db): Promise<NewSystemRoles> {
  const [row] = await db.select().from(settings).where(eq(settings.key, ROLES_KEY));
  const v = (row?.value ?? {}) as Record<string, unknown>;
  const id = (x: unknown) => (typeof x === 'string' && /^\d{17,20}$/.test(x) ? x : undefined);
  return { ...(id(v.motoUjiko) ? { motoUjiko: id(v.motoUjiko) } : {}), ...(id(v.aramitama) ? { aramitama: id(v.aramitama) } : {}) };
}

export async function setNewSystemRoles(db: Db, roles: NewSystemRoles, by: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key: ROLES_KEY, value: roles, updatedBy: by })
    .onConflictDoUpdate({ target: settings.key, set: { value: roles, updatedBy: by, updatedAt: new Date() } });
}

/** 元氏子か（状態の表で見る） */
export async function isMotoUjiko(db: Db, memberId: string): Promise<boolean> {
  const [row] = await db.select({ state: ujikoKeepState.state }).from(ujikoKeepState).where(eq(ujikoKeepState.memberId, memberId));
  return row?.state === 'moto';
}

/** 元氏子の人の ID */
export async function motoUjikoIds(db: Db): Promise<Set<string>> {
  const rows = await db.select({ id: ujikoKeepState.memberId }).from(ujikoKeepState).where(eq(ujikoKeepState.state, 'moto'));
  return new Set(rows.map((r) => r.id));
}

export type KeepProgress = {
  /** 有効な絵馬（氏子以上から＋30日以内の参拝者・元氏子から） */
  total: number;
  /** そのうち参拝者・元氏子から */
  fromSanpai: number;
  /** 期間中に「1人」と数えた招待と、補いに使う数 */
  invites: number;
  inviteUsed: number;
  need: number;
  needSanpai: number;
  /** あと何枚（合計・参拝者から。大きいほう） */
  short: number;
  met: boolean;
};

async function progress(db: Db, memberId: string, opts: { emaSince?: Date; inviteSince: Date; need: number; needSanpai: number; inviteMax: number }, now: Date): Promise<KeepProgress> {
  const since = opts.emaSince ? [gte(ema.createdAt, opts.emaSince)] : [];
  const base = [eq(ema.receiverId, memberId), isNull(ema.revokedAt), lte(ema.createdAt, now), ...since];
  const [[u], [s], [i]] = await Promise.all([
    db.select({ n: count() }).from(ema).where(and(...base, eq(ema.tier, 'ujiko'))),
    db.select({ n: count() }).from(ema).where(and(...base, eq(ema.tier, 'sanpai'), gte(ema.createdAt, emaFreshSince(now)))),
    db.select({ n: count() }).from(invites).where(and(eq(invites.inviterId, memberId), isNotNull(invites.qualifiedAt), gte(invites.qualifiedAt, opts.inviteSince), lte(invites.qualifiedAt, now))),
  ]);
  const fromSanpai = Number(s?.n ?? 0);
  const total = Number(u?.n ?? 0) + fromSanpai;
  const inv = Number(i?.n ?? 0);
  const inviteUsed = Math.min(inv, opts.inviteMax);
  const short = Math.max(0, opts.need - total - inviteUsed, opts.needSanpai - fromSanpai - inviteUsed);
  return { total, fromSanpai, invites: inv, inviteUsed, need: opts.need, needSanpai: opts.needSanpai, short, met: short === 0 };
}

/** 氏子のキープの進み具合（periodStart＝その判定の期間のはじめ） */
export function keepProgress(db: Db, cfg: GuildConfig, memberId: string, periodStart: Date, now = new Date()): Promise<KeepProgress> {
  const th = cfg.emaThresholds;
  return progress(db, memberId, { inviteSince: periodStart, need: th.keepNeed, needSanpai: th.keepFromSanpai, inviteMax: th.keepInviteMax }, now);
}

/** 元氏子が氏子に戻るまでの進み具合（since＝元氏子になった日。それより後の絵馬だけ） */
export function motoProgress(db: Db, cfg: GuildConfig, memberId: string, since: Date, now = new Date()): Promise<KeepProgress> {
  const th = cfg.emaThresholds;
  return progress(db, memberId, { emaSince: since, inviteSince: since, need: th.motoNeed, needSanpai: th.motoFromSanpai, inviteMax: th.motoInviteMax }, now);
}

/** プロフィールに出す、その人のキープ／復帰のようす */
export type KeepCard = { kind: 'keep'; judgeAt: Date; p: KeepProgress } | { kind: 'moto'; p: KeepProgress };
export async function keepCardOf(db: Db, cfg: GuildConfig, memberId: string, now = new Date()): Promise<KeepCard | undefined> {
  const [row] = await db.select().from(ujikoKeepState).where(eq(ujikoKeepState.memberId, memberId));
  if (!row) return undefined;
  if (row.state === 'moto') return { kind: 'moto', p: await motoProgress(db, cfg, memberId, row.since, now) };
  if (!row.nextJudgeAt) return undefined;
  return { kind: 'keep', judgeAt: row.nextJudgeAt, p: await keepProgress(db, cfg, memberId, new Date(row.nextJudgeAt.getTime() - cfg.emaThresholds.keepDays * DAY), now) };
}

export type KeepAction =
  /** 判定の7日前：足りないので本人に知らせる */
  | { type: 'warn'; id: string; judgeAt: Date; p: KeepProgress }
  /** 判定：足りたので、次の判定へ */
  | { type: 'kept'; id: string; nextJudgeAt: Date; p: KeepProgress }
  /** 判定：足りないが、お守りで防いだ */
  | { type: 'omamori'; id: string; nextJudgeAt: Date; p: KeepProgress }
  /** 判定：足りないので元氏子に（ロールの付け替えは呼ぶ側） */
  | { type: 'demote'; id: string; p: KeepProgress }
  /** 判定：足りないが、元氏子のロールが未設定なので見送った（本人と運営に1回だけ知らせる） */
  | { type: 'hold'; id: string; p: KeepProgress }
  /** 元氏子が条件を満たして氏子に戻る（ロールの付け替えは呼ぶ側） */
  | { type: 'return'; id: string; p: KeepProgress };

export type KeepDeps = {
  /** お守りを1つ使う。使えたら true（お守りの仕組みがなければ渡さない） */
  consumeOmamori?: (memberId: string) => Promise<boolean>;
};

/**
 * 🍃 キープの見回り（10分ごと）。状態の表を進めて、やること（お知らせ・降格・復帰）を返す。
 * ③（絵馬での昇格）と④（ご縁のリセット）が済んでいるときだけ動く。
 */
export async function runUjikoKeep(db: Db, cfg: GuildConfig, now = new Date(), deps: KeepDeps = {}): Promise<KeepAction[]> {
  if (!(await newSystemStartedAt(db))) return [];
  const [on] = await db.select().from(settings).where(eq(settings.key, 'ema_promotion'));
  if ((on?.value as { on?: boolean } | undefined)?.on !== true) return [];
  const th = cfg.emaThresholds;
  const period = th.keepDays * DAY;
  const [people, alts, altRows, rows, roles] = await Promise.all([
    db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(and(eq(members.isBot, false), isNull(members.leftAt))),
    staffAlts(db),
    db.select({ id: memberAlts.altId }).from(memberAlts).where(eq(memberAlts.status, 'approved')),
    db.select().from(ujikoKeepState),
    newSystemRoles(db),
  ]);
  const skip = new Set([...alts.map((a) => a.id), ...altRows.map((a) => a.id)]);
  const rankOf = new Map(people.filter((p) => !skip.has(p.id)).map((p) => [p.id, highestRank(cfg.ranks, p.roleIds)?.key] as const));
  const rowOf = new Map(rows.map((r) => [r.memberId, r]));
  const out: KeepAction[] = [];

  // 表にあるが、もう対象でない人（抜けた・世話役以上になった・運営が手で参拝者に戻した氏子）は表から外す
  const gone = rows.filter((r) => {
    const rank = rankOf.get(r.memberId);
    if (r.state === 'ujiko') return rank !== 'ujiko';
    return rank !== 'sanpaisha' && rank !== 'ujiko';
  });
  if (gone.length) await db.delete(ujikoKeepState).where(inArray(ujikoKeepState.memberId, gone.map((r) => r.memberId)));
  for (const r of gone) rowOf.delete(r.memberId);

  for (const [id, rank] of rankOf) {
    const row = rowOf.get(id);
    if (rank === 'ujiko') {
      // はじめて見る氏子・氏子に戻った元氏子（絵馬がそろって昇格した・運営が手で戻した）：判定の日を決める
      if (!row || row.state === 'moto') {
        if (row?.state === 'moto') out.push({ type: 'return', id, p: await motoProgress(db, cfg, id, row.since, now) });
        const since = row?.state === 'moto' ? now : ((await ujikoCountFrom(db, id)) ?? now);
        const value = { state: 'ujiko' as const, since, nextJudgeAt: new Date(since.getTime() + period), warnedFor: null, heldFor: null, omamoriUsedLast: false, updatedAt: now };
        await db.insert(ujikoKeepState).values({ memberId: id, ...value }).onConflictDoUpdate({ target: ujikoKeepState.memberId, set: value });
        continue;
      }
      const judgeAt = row.nextJudgeAt ?? new Date(row.since.getTime() + period);
      const same = (a: Date | null) => a?.getTime() === judgeAt.getTime();
      if (now >= judgeAt) {
        const p = await keepProgress(db, cfg, id, new Date(judgeAt.getTime() - period), now);
        const next = new Date(judgeAt.getTime() + period);
        if (p.met) {
          await db.update(ujikoKeepState).set({ nextJudgeAt: next, omamoriUsedLast: false, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
          out.push({ type: 'kept', id, nextJudgeAt: next, p });
        } else if (!row.omamoriUsedLast && deps.consumeOmamori && (await deps.consumeOmamori(id))) {
          await db.update(ujikoKeepState).set({ nextJudgeAt: next, omamoriUsedLast: true, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
          out.push({ type: 'omamori', id, nextJudgeAt: next, p });
        } else if (roles.motoUjiko) {
          await db.update(ujikoKeepState).set({ state: 'moto', since: now, nextJudgeAt: null, warnedFor: null, heldFor: null, omamoriUsedLast: false, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
          out.push({ type: 'demote', id, p });
        } else if (!same(row.heldFor)) {
          await db.update(ujikoKeepState).set({ heldFor: judgeAt, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
          out.push({ type: 'hold', id, p });
        }
      } else if (now.getTime() >= judgeAt.getTime() - 7 * DAY && !same(row.warnedFor)) {
        const p = await keepProgress(db, cfg, id, new Date(judgeAt.getTime() - period), now);
        await db.update(ujikoKeepState).set({ warnedFor: judgeAt, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
        if (!p.met) out.push({ type: 'warn', id, judgeAt, p });
      }
    } else if (rank === 'sanpaisha' && row?.state === 'moto') {
      const p = await motoProgress(db, cfg, id, row.since, now);
      if (p.met) {
        await db.update(ujikoKeepState).set({ state: 'ujiko', since: now, nextJudgeAt: new Date(now.getTime() + period), warnedFor: null, heldFor: null, omamoriUsedLast: false, updatedAt: now }).where(eq(ujikoKeepState.memberId, id));
        out.push({ type: 'return', id, p });
      }
    }
  }
  return out;
}
