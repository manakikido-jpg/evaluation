import type { ThreadChannel } from 'discord.js';
import { audit } from '../services/audit.js';
import type { Db } from '../db/client.js';
import type { GuideThread } from '../db/schema.js';
import { threadById } from '../services/guideThreads.js';

export const GUIDE_THREAD_IDLE_MS = 3 * 86_400_000;
const BOOKING_GRACE_MS = 15 * 60_000;

/** 未完了の案内は施錠しない。返信すればDiscordが再び開ける状態にする。 */
export async function hideIdleGuideThread(db: Db, row: GuideThread, thread: ThreadChannel, now: Date): Promise<boolean> {
  if (row.closedAt || thread.archived || thread.locked) return false;
  // 自由記入の希望日は機械で確定できないため、案内人の確認待ちとして残す。
  if (row.scheduleMessageId || row.slotAt && +row.slotAt >= +now - BOOKING_GRACE_MS) return false;
  const cutoff = +now - GUIDE_THREAD_IDLE_MS;
  if (Math.max(+row.createdAt, row.lastActivityAt ? +row.lastActivityAt : 0, row.slotAt ? +row.slotAt : 0) > cutoff) return false;
  let before: string | undefined;
  let head: string | null = null;
  let idle = false;
  // BOTの受付やリマインダーは「人の返信」に数えない。取得できなければ閉じない。
  for (let page = 0; page < 5; page++) {
    const messages = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const list = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    if (page === 0) head = list[0]?.id ?? null;
    if (list.some(m => !m.author.bot && !m.system && m.createdTimestamp > cutoff)) return false;
    if (list.length < 100 || list[list.length - 1]!.createdTimestamp <= cutoff) { idle = true; break; }
    before = list[list.length - 1]!.id;
  }
  if (!idle) return false;
  const current = await threadById(db, thread.id);
  if (!current || current.closedAt || current.memberId !== row.memberId || current.scheduleMessageId || current.lastActivityAt && +current.lastActivityAt > cutoff || current.slotAt && +current.slotAt > cutoff) return false;
  const latest = await thread.messages.fetch({ limit: 1 });
  if ((latest.first()?.id ?? null) !== head) return false;
  await thread.edit({ archived: true, reason: '3日間やりとりのない案内を整理（返信で再開できます）' });
  // 調査と編集の間に投稿が来た場合は、すぐに元へ戻す。
  const after = await thread.messages.fetch({ limit: 1 });
  const changed = await threadById(db, thread.id);
  if (!changed || changed.closedAt) return false;
  if ((after.first()?.id ?? null) !== head || changed.scheduleMessageId || changed.lastActivityAt && +changed.lastActivityAt > cutoff || changed.slotAt && +changed.slotAt > cutoff) {
    await thread.edit({ archived: false, reason: '整理中に返信が届いたため再開' });
    return false;
  }
  await audit(db, { actorId: 'system', targetId: row.memberId, action: 'guide.thread_idle_archive', detail: { threadId: row.threadId, days: 3 }, via: 'discord' });
  return true;
}
