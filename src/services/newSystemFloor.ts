import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/**
 * 🌸 新制度の「数えはじめ」（④ご縁のリセットを押した時）。
 * 本人の決定 2026-11-28：絵馬の枚数・絵馬を贈れる条件（縁側の日）・結べる相手・世話役の投票権・お守りの週は、
 * 新制度が始まってからの分だけを数える（参拝者→氏子の必要数＝縁側10時間以上の氏子の数だけは、前の日も数える）。
 * 新制度がまだなら、制限なし（at＝いちばん古い時刻・date＝いちばん古い日付）。
 */
export async function newSystemFloor(db: Db): Promise<{ at: Date; date: string; started: boolean }> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'new_system_started'));
  const iso = (row?.value as { at?: string } | undefined)?.at;
  if (!iso) return { at: new Date(0), date: '0000-00-00', started: false };
  const at = new Date(iso);
  return { at, date: new Date(at.getTime() + 9 * 3_600_000).toISOString().slice(0, 10), started: true };
}
