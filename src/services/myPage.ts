import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { shopItems, shopPurchases } from '../db/schema.js';

/**
 * 👘 マイページ: 持っているロールの品（色守り・称号・自分だけの色など）を、自分でつける・外す。
 * - 外しても持ったまま（期限はそのまま進む）。つけ直すとロールがまた付く
 * - ロールを付ける・外すのは呼び出し側（Discord）。ここは「いまつけているか」の記録だけ
 */

export type Wearable = {
  purchaseId: number;
  roleId: string;
  name: string;
  emoji: string;
  /** color / title / vip / mycolor / other */
  group: string;
  worn: boolean;
  expiresAt: Date | null;
};

const GROUP_ORDER = ['color', 'mycolor', 'title', 'vip', 'other'];

/** その人が持っている（期限内の）ロールの品。同じロールは新しい 1 つだけ */
export async function wearables(db: Db, memberId: string): Promise<Wearable[]> {
  const rows = await db
    .select({ p: shopPurchases, name: shopItems.name, emoji: shopItems.emoji, group: shopItems.roleGroup })
    .from(shopPurchases)
    .leftJoin(shopItems, eq(shopItems.id, shopPurchases.itemId))
    .where(and(eq(shopPurchases.memberId, memberId), inArray(shopPurchases.kind, ['role', 'mycolor']), isNull(shopPurchases.endedAt), isNotNull(shopPurchases.roleId)))
    .orderBy(desc(shopPurchases.createdAt));
  const seen = new Set<string>();
  const out: Wearable[] = [];
  for (const r of rows) {
    if (seen.has(r.p.roleId!)) continue;
    seen.add(r.p.roleId!);
    out.push({
      purchaseId: r.p.id,
      roleId: r.p.roleId!,
      name: r.name ?? 'ロールの品',
      emoji: r.emoji ?? '',
      group: r.p.kind === 'mycolor' ? 'mycolor' : (r.group ?? 'other'),
      worn: r.p.worn,
      expiresAt: r.p.expiresAt,
    });
  }
  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name, 'ja'));
}

/** つける・外す（本人の、期限内のものだけ）。変えたものを返す（なければ undefined） */
export async function setWorn(db: Db, memberId: string, purchaseId: number, worn: boolean): Promise<Wearable | undefined> {
  const [row] = await db
    .update(shopPurchases)
    .set({ worn })
    .where(and(eq(shopPurchases.id, purchaseId), eq(shopPurchases.memberId, memberId), inArray(shopPurchases.kind, ['role', 'mycolor']), isNull(shopPurchases.endedAt), isNotNull(shopPurchases.roleId)))
    .returning();
  if (!row) return undefined;
  return (await wearables(db, memberId)).find((w) => w.roleId === row.roleId);
}
