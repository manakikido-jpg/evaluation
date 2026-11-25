import { and, eq, isNull, sql } from 'drizzle-orm';
import type { GuildConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { goenPerkClaims, members, shuin } from '../db/schema.js';
import { addCoins } from './economy.js';
import { specialGoenSumFor } from './specialGoen.js';

export type GoenPerkGrant = { memberId: string; goen: number; coins: number; roleId?: string; label: string };

/**
 * 🎁 ご縁の節目特典（新制度⑦）。ご縁が節目に届いた人へ、まだ渡していない特典を 1 回だけ渡す。
 * 銭はここで渡し、称号ロールは呼び出し側（Discord）で付ける。渡した節目は goen_perk_claims に記録（1人・節目ごとに1回）。
 * 「絵馬での昇格」が ON のときだけ呼ぶ想定（新制度が始まってから）。
 */
export async function grantGoenPerks(db: Db, cfg: GuildConfig, now = new Date()): Promise<GoenPerkGrant[]> {
  const perks = [...cfg.goenPerks].sort((a, b) => a.goen - b.goen);
  if (!perks.length) return [];
  // 全員のご縁（取り消しを除く朱印の重み＋特別ご縁）
  const rows = await db
    .select({
      id: members.id,
      goen: sql<number>`coalesce((select sum(${shuin.weight}) from ${shuin} where ${shuin.receiverId} = ${members.id} and ${shuin.revokedAt} is null), 0) + ${specialGoenSumFor(members.id)}`,
    })
    .from(members)
    .where(and(eq(members.isBot, false), isNull(members.leftAt)));
  const claimed = new Set((await db.select({ memberId: goenPerkClaims.memberId, goen: goenPerkClaims.goen }).from(goenPerkClaims)).map((c) => `${c.memberId}:${c.goen}`));

  const grants: GoenPerkGrant[] = [];
  for (const m of rows) {
    const goen = Number(m.goen);
    for (const perk of perks) {
      if (goen < perk.goen) break; // 節目は小さい順。届いていないものが出たら、以降も届いていない
      if (claimed.has(`${m.id}:${perk.goen}`)) continue;
      const ok = await db.transaction(async (tx) => {
        const [c] = await tx.insert(goenPerkClaims).values({ memberId: m.id, goen: perk.goen, claimedAt: now }).onConflictDoNothing().returning();
        if (!c) return false;
        if (perk.coins > 0) await addCoins(tx, m.id, perk.coins, 'goen_perk', { goen: perk.goen });
        return true;
      });
      if (ok) grants.push({ memberId: m.id, goen: perk.goen, coins: perk.coins, roleId: perk.roleId, label: perk.label });
    }
  }
  return grants;
}
