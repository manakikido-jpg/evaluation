import { and, desc, eq, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { specialGoen, type SpecialGoen } from '../db/schema.js';

/**
 * ✨ 特別ご縁: 宮司が社務所Web から、朱印とは別にご縁を振る。
 * - ご縁の合計（役職の昇格・御朱印帳・メンバーの一覧）に足して数える。番付（朱印のランキング）には入れない
 * - 振った分は 1 つずつ取り消せる（取り消してもご縁が減るだけで、役職は下げない。朱印の取り消しと同じ）
 * - 昇格は BOT が 1 分ごとに確かめる（社務所Web は Discord のロールを変えないため）
 */

/** 1 回に振れる上限（打ち間違いで桁が増えないように） */
export const SPECIAL_GOEN_MAX = 1000;
export const validSpecialGoen = (n: number) => Number.isInteger(n) && n >= 1 && n <= SPECIAL_GOEN_MAX;

/** 取り消していない特別ご縁の合計 */
export async function specialGoenOf(db: Db, memberId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(specialGoen.amount) })
    .from(specialGoen)
    .where(and(eq(specialGoen.memberId, memberId), isNull(specialGoen.revokedAt)));
  return Number(row?.total ?? 0);
}

/** メンバーの一覧などで使う、特別ご縁の合計の式（members.id ごと） */
export const specialGoenSumFor = (memberIdCol: unknown) =>
  sql<number>`coalesce((select sum(${specialGoen.amount}) from ${specialGoen} where ${specialGoen.memberId} = ${memberIdCol} and ${specialGoen.revokedAt} is null), 0)`;

export type GrantSpecialGoenInput = { memberId: string; amount: number; reason: string; by: string; nonce: string };

/** 振る。同じ番号（画面を開いたときに作る）は 1 回だけ（ボタンの二度押し・再送信で 2 回振らない） */
export async function grantSpecialGoen(db: Db, input: GrantSpecialGoenInput): Promise<{ status: 'ok'; row: SpecialGoen } | { status: 'duplicate' }> {
  if (!validSpecialGoen(input.amount)) throw new Error('invalid amount');
  const [row] = await db
    .insert(specialGoen)
    .values({ memberId: input.memberId, amount: input.amount, reason: input.reason, grantedBy: input.by, nonce: input.nonce })
    .onConflictDoNothing()
    .returning();
  return row ? { status: 'ok', row } : { status: 'duplicate' };
}

/** 取り消す（その人の、まだ取り消していないものだけ。同時に押しても 1 回だけ） */
export async function revokeSpecialGoen(db: Db, id: number, memberId: string, by: string): Promise<SpecialGoen | undefined> {
  const [row] = await db
    .update(specialGoen)
    .set({ revokedAt: sql`now()`, revokedBy: by })
    .where(and(eq(specialGoen.id, id), eq(specialGoen.memberId, memberId), isNull(specialGoen.revokedAt)))
    .returning();
  return row;
}

/** その人の特別ご縁の記録（新しい順。取り消したものも） */
export async function specialGoenHistory(db: Db, memberId: string, limit = 50): Promise<SpecialGoen[]> {
  return db.select().from(specialGoen).where(eq(specialGoen.memberId, memberId)).orderBy(desc(specialGoen.createdAt), desc(specialGoen.id)).limit(limit);
}

/** BOT が昇格を確かめる人（振ったあと、まだ確かめていない人）。取ったら印を付けるので、1 回だけ返す */
export async function takeUncheckedSpecialGoen(db: Db): Promise<string[]> {
  const rows = await db
    .update(specialGoen)
    .set({ checkedAt: sql`now()` })
    .where(isNull(specialGoen.checkedAt))
    .returning({ memberId: specialGoen.memberId });
  return [...new Set(rows.map((r) => r.memberId))];
}

/** 本人への DM */
export function specialGoenDm(amount: number, reason: string, goen: number): string {
  return [`✨ 咲楽ノ宮の社務所から、**特別ご縁 +${amount}** を頂きました。`, `> ${reason}`, `今のご縁は **${goen}** です。\`/御朱印帳\` で見られます。`].join('\n');
}

/** #記録 に出す 1 行（通知は飛ばさない） */
export function specialGoenLog(kind: 'grant' | 'revoke', memberId: string, by: string, amount: number, reason: string, goen: number): string {
  return kind === 'grant'
    ? `✨ <@${by}> が <@${memberId}> に特別ご縁 +${amount}（${reason}）→ ご縁 ${goen}`
    : `✨ <@${by}> が <@${memberId}> の特別ご縁 +${amount}（${reason}）を取り消しました → ご縁 ${goen}（役職はそのまま）`;
}
