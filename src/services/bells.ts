import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { bells, type Bell } from '../db/schema.js';

/**
 * 呼び鈴: メンバーが運営を呼ぶ。運営のチャンネルにカードを出し、神職が「対応する」→「対応済み」にする。
 * 同じ人は cooldownMinutes の間、続けて鳴らせない（待っている呼び鈴があるときも鳴らせない）。
 */

/** 呼べるロール（設定になければ、運営の役職: 神職・宮司など） */
export function bellRoles(cfg: GuildConfig): string[] {
  return cfg.bell.roleIds.length ? cfg.bell.roleIds : cfg.ranks.filter((r) => !r.auto).map((r) => r.roleId);
}

export type RingResult = { status: 'ok'; bell: Bell } | { status: 'cooldown'; minutes: number } | { status: 'waiting'; bell: Bell };

export async function ringBell(
  db: Db,
  cfg: GuildConfig,
  input: { memberId: string; channelId?: string | null; voiceChannelId?: string | null; reason?: string; roleId?: string | null },
  now = new Date(),
): Promise<RingResult> {
  const [waiting] = await db
    .select()
    .from(bells)
    .where(and(eq(bells.memberId, input.memberId), inArray(bells.status, ['open', 'taken'])))
    .orderBy(desc(bells.createdAt))
    .limit(1);
  if (waiting) return { status: 'waiting', bell: waiting };
  const cooldown = cfg.bell.cooldownMinutes * 60_000;
  if (cooldown > 0) {
    const [recent] = await db
      .select({ createdAt: bells.createdAt })
      .from(bells)
      .where(and(eq(bells.memberId, input.memberId), gt(bells.createdAt, new Date(now.getTime() - cooldown))))
      .orderBy(desc(bells.createdAt))
      .limit(1);
    if (recent) return { status: 'cooldown', minutes: Math.max(1, Math.ceil((recent.createdAt.getTime() + cooldown - now.getTime()) / 60_000)) };
  }
  const [bell] = await db
    .insert(bells)
    .values({
      memberId: input.memberId,
      channelId: input.channelId ?? null,
      voiceChannelId: input.voiceChannelId ?? null,
      reason: (input.reason ?? '').trim().slice(0, 500),
      roleId: input.roleId ?? null,
      createdAt: now,
    })
    .returning();
  return { status: 'ok', bell: bell! };
}

export async function setBellCard(db: Db, id: number, channelId: string, messageId: string): Promise<void> {
  await db.update(bells).set({ cardChannelId: channelId, cardMessageId: messageId }).where(eq(bells.id, id));
}

/** 対応する（待っているものだけ） */
export async function takeBell(db: Db, id: number, staffId: string, now = new Date()): Promise<Bell | undefined> {
  const [row] = await db
    .update(bells)
    .set({ status: 'taken', takenBy: staffId, takenAt: now })
    .where(and(eq(bells.id, id), eq(bells.status, 'open')))
    .returning();
  return row;
}

/** 対応済みにする（待っている・対応中のもの） */
export async function doneBell(db: Db, id: number, staffId: string, now = new Date()): Promise<Bell | undefined> {
  const [cur] = await db.select().from(bells).where(eq(bells.id, id));
  if (!cur || cur.status === 'done') return undefined;
  const [row] = await db
    .update(bells)
    .set({ status: 'done', doneAt: now, takenBy: cur.takenBy ?? staffId, takenAt: cur.takenAt ?? now })
    .where(and(eq(bells.id, id), inArray(bells.status, ['open', 'taken'])))
    .returning();
  return row;
}

/** 呼び鈴のカードの文面 */
export function bellCardText(b: Bell): string {
  const status = b.status === 'open' ? '🔔 **待っています**' : b.status === 'taken' ? `🏃 <@${b.takenBy}> さんが対応中` : `✅ 対応済み（<@${b.takenBy}> さん）`;
  return [
    `**🔔 呼び鈴 #${b.id}** <@${b.memberId}> さんが${b.roleId ? ` <@&${b.roleId}> を` : '運営を'}呼んでいます`,
    ...(b.channelId ? [`場所: <#${b.channelId}>`] : []),
    ...(b.voiceChannelId ? [`通話: <#${b.voiceChannelId}>`] : []),
    ...(b.reason ? [`> ${b.reason.replace(/\n+/g, ' ')}`] : []),
    status,
  ].join('\n');
}
