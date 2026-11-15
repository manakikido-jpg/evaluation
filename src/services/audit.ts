import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import type { GuildConfig } from '../config.js';
import { auditLogs, members } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';

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

/**
 * 🔒 記録の表示から、宮司が行った操作を隠す（した本人の宮司にだけ見せる。ほかの宮司・神職には見せない）。
 * 記録そのものは消さない（内部の読み出し・社務所Web の表示だけで隠す）。viewerId は今見ている人。
 */
export async function hideGujiAudit<T extends { actorId: string }>(db: Db, cfg: GuildConfig, rows: T[], viewerId: string): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.actorId).filter((id) => id && id !== viewerId && id !== 'system' && !id.startsWith('acct:')))];
  if (!ids.length) return rows;
  const people = await db.select({ id: members.id, roleIds: members.roleIds }).from(members).where(inArray(members.id, ids));
  const guji = new Set(people.filter((m) => highestRank(cfg.ranks, m.roleIds)?.key === 'guji').map((m) => m.id));
  if (!guji.size) return rows;
  return rows.filter((r) => !guji.has(r.actorId));
}
