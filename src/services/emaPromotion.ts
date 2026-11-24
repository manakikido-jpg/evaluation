import { and, eq, isNull } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { memberAlts, members, settings } from '../db/schema.js';
import { highestRank } from '../domain/ranks.js';
import { EMA_UJIKO_KEEP, EMA_UJIKO_PROMOTE } from '../domain/ema.js';
import { validEmaCountOf } from './ema.js';
import { staffAlts } from './staffAlts.js';

/**
 * 🎐 絵馬での昇格（新制度③）の ON/OFF。宮司が社務所Webで切り替える。
 * 既定は OFF＝従来どおり（参拝者→氏子はご縁40＋縁側20時間）。
 * ON＝参拝者→氏子は「有効な絵馬 EMA_UJIKO_PROMOTE 枚」で決める（ご縁・縁側時間は使わない）。
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

/** 参拝者で、有効な絵馬が EMA_UJIKO_PROMOTE 枚以上＝氏子に昇格できる人の ID。 */
export async function emaPromotableSanpaisha(db: Db, cfg: GuildConfig, now = new Date()): Promise<string[]> {
  const out: string[] = [];
  for (const p of await targetMembers(db)) {
    if (highestRank(cfg.ranks, p.roleIds)?.key !== 'sanpaisha') continue;
    if ((await validEmaCountOf(db, p.id, now)) >= EMA_UJIKO_PROMOTE) out.push(p.id);
  }
  return out;
}

/** 維持の警告: 氏子で、有効な絵馬が EMA_UJIKO_KEEP 枚未満の人（自動降格はしない・運営の手動判断用）。 */
export async function ujikoBelowKeep(db: Db, cfg: GuildConfig, now = new Date()): Promise<{ id: string; count: number }[]> {
  const out: { id: string; count: number }[] = [];
  for (const p of await targetMembers(db)) {
    if (highestRank(cfg.ranks, p.roleIds)?.key !== 'ujiko') continue;
    const count = await validEmaCountOf(db, p.id, now);
    if (count < EMA_UJIKO_KEEP) out.push({ id: p.id, count });
  }
  return out.sort((a, b) => a.count - b.count || a.id.localeCompare(b.id));
}
