import { and, desc, eq } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { roleRequests, type RoleRequestRow } from '../db/schema.js';
import { audit } from './audit.js';

/**
 * 🛡 ロールの承認制。神職が /ロール・/一時ロール で、許可リスト（security.freeRoleIds）にないロールを付け外ししたいときは、
 * 承認待ちにする。頼んだ人とは別の神職・宮司が承認したら、BOT が付け外しする。宮司はいらない
 */

export type RoleRequestKind = 'give' | 'remove' | 'temp';

export function needsApproval(cfg: GuildConfig, level: 'guji' | 'shinshoku', roleId: string): boolean {
  if (level === 'guji' || !cfg.security.roleApproval) return false;
  return !cfg.security.freeRoleIds.includes(roleId);
}

export async function createRoleRequest(
  db: Db,
  r: { kind: RoleRequestKind; memberId: string; roleId: string; minutes?: number; reason: string; requestedBy: string },
  now = new Date(),
): Promise<RoleRequestRow> {
  const [row] = await db
    .insert(roleRequests)
    .values({ kind: r.kind, memberId: r.memberId, roleId: r.roleId, minutes: r.minutes ?? null, reason: r.reason.slice(0, 200), requestedBy: r.requestedBy, createdAt: now })
    .returning();
  await audit(db, { actorId: r.requestedBy, targetId: r.memberId, action: 'role.request', detail: { id: row!.id, kind: r.kind, roleId: r.roleId, minutes: r.minutes ?? null }, via: 'discord' });
  return row!;
}

export type DecideResult = { status: 'ok'; request: RoleRequestRow } | { status: 'not_found' | 'decided' | 'self' };

/** 承認・却下を決める（同時に押しても 1 回だけ。頼んだ本人は決められない） */
export async function decideRoleRequest(db: Db, id: number, by: string, approve: boolean, now = new Date()): Promise<DecideResult> {
  const [cur] = await db.select().from(roleRequests).where(eq(roleRequests.id, id));
  if (!cur) return { status: 'not_found' };
  if (cur.status !== 'pending') return { status: 'decided' };
  if (cur.requestedBy === by) return { status: 'self' };
  const [row] = await db
    .update(roleRequests)
    .set({ status: approve ? 'approved' : 'rejected', decidedBy: by, decidedAt: now })
    .where(and(eq(roleRequests.id, id), eq(roleRequests.status, 'pending')))
    .returning();
  if (!row) return { status: 'decided' };
  await audit(db, { actorId: by, targetId: row.memberId, action: approve ? 'role.request_approve' : 'role.request_reject', detail: { id, kind: row.kind, roleId: row.roleId, requestedBy: row.requestedBy }, via: 'discord' });
  return { status: 'ok', request: row };
}

/** 付け外しの結果を残す（承認したあと、うまくいかなかったら failed） */
export async function finishRoleRequest(db: Db, id: number, ok: boolean, result: string): Promise<void> {
  await db.update(roleRequests).set({ result: result.slice(0, 200), ...(ok ? {} : { status: 'failed' }) }).where(eq(roleRequests.id, id));
}

export async function recentRoleRequests(db: Db, limit = 30): Promise<RoleRequestRow[]> {
  return db.select().from(roleRequests).orderBy(desc(roleRequests.id)).limit(limit);
}
