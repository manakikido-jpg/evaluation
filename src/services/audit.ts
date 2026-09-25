import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

export type AuditInput = {
  actorId: string;
  targetId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  via: 'web' | 'discord' | 'system';
};

/** 操作の記録を残す（追記のみ） */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: input.actorId,
    targetId: input.targetId ?? null,
    action: input.action,
    detail: input.detail ?? {},
    via: input.via,
  });
}

export async function listAudit(
  db: Db,
  filter: { actorId?: string; targetId?: string; action?: string; limit?: number } = {},
) {
  const conds: SQL[] = [];
  if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId));
  if (filter.targetId) conds.push(eq(auditLogs.targetId, filter.targetId));
  if (filter.action) conds.push(eq(auditLogs.action, filter.action));
  return db
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(Math.min(filter.limit ?? 100, 500));
}
