import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings } from '../db/schema.js';

/**
 * 🛡 レイド検知と警戒モード。短い時間にたくさん入ってきたら警戒モードにする。
 * 警戒モードの間は、案内人のロール付与と入鯖申請の自動承認を止める（まとめてのタイムアウトは K-PRO に任せる）
 */

const KEY = 'security.raid';

export type RaidState = { until: string; startedAt: string; by: string; joins?: number };

/** 入った時刻を数える（BOT の中だけ。再起動したら数え直し） */
export class JoinCounter {
  private times: number[] = [];
  /** 入ったことを数えて、窓の中の人数を返す */
  add(now: number, windowMs: number): number {
    this.times = this.times.filter((t) => now - t < windowMs);
    this.times.push(now);
    return this.times.length;
  }
}

export async function raidState(db: Db, now = new Date()): Promise<RaidState | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  const v = row?.value as RaidState | undefined;
  return v && new Date(v.until).getTime() > now.getTime() ? v : null;
}

export async function startRaid(db: Db, by: string, minutes: number, now = new Date(), joins?: number): Promise<RaidState> {
  const value: RaidState = { until: new Date(now.getTime() + minutes * 60_000).toISOString(), startedAt: now.toISOString(), by, ...(joins ? { joins } : {}) };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: now } });
  return value;
}

export async function endRaid(db: Db, by: string, now = new Date()): Promise<void> {
  const value: RaidState = { until: now.toISOString(), startedAt: now.toISOString(), by };
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: by, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: by, updatedAt: now } });
}

/** 作って days 日以内のアカウントか */
export const isNewAccount = (createdAt: Date, days: number, now = new Date()) => days > 0 && now.getTime() - createdAt.getTime() < days * 86_400_000;
