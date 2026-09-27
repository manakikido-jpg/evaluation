import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { TICKET_KINDS, type TicketKind } from '../config.js';
import type { Db } from '../db/client.js';
import { tickets } from '../db/schema.js';

/**
 * 券（物御籤で出る・運営が渡す）。
 * auto: 使う場面で自動で使う（部屋代・ショップの割引は選んで使う）/ manual: /物御籤 の「🎟 券を使う」から使う
 */

type TicketDef = { emoji: string; name: string; note: string; use: 'auto' | 'manual' };

export const ROOM_KIND_LABEL = { public: '🔓公開', invite: '🔒招待限定', secret: '🤫シークレット', twoshot: '💞ツーショット' } as const;
export type RoomKindKey = keyof typeof ROOM_KIND_LABEL;
const room = (k: RoomKindKey): Record<string, TicketDef> => ({
  [`room_free_${k}`]: { emoji: '🎫', name: `${ROOM_KIND_LABEL[k]}の部屋代無料券`, note: `${ROOM_KIND_LABEL[k]}の部屋の部屋代が 1 回無料（宿坊はその部屋ぜんぶ・宵宮は 1 時間分。払うときに自動で使う）`, use: 'auto' },
  [`room_half_${k}`]: { emoji: '🎟', name: `${ROOM_KIND_LABEL[k]}の部屋代半額券`, note: `${ROOM_KIND_LABEL[k]}の部屋の部屋代が 1 回半額（払うときに自動で使う）`, use: 'auto' },
  [`room_day_${k}`]: { emoji: '📅', name: `${ROOM_KIND_LABEL[k]}の一日券`, note: `${ROOM_KIND_LABEL[k]}の部屋の部屋代が 24 時間無料（最初に払うときに自動で使い始める）`, use: 'auto' },
});

/** 券の名前と説明（全部の券。テストで数を確かめる） */
export const TICKET_LABEL = {
  room_free: { emoji: '🎫', name: '部屋代無料券', note: 'どの種類の部屋でも、部屋代が 1 回無料（宿坊はその部屋ぜんぶ・宵宮は 1 時間分。払うときに自動で使う）', use: 'auto' },
  ...room('public'),
  ...room('invite'),
  ...room('secret'),
  ...room('twoshot'),
  shop_10: { emoji: '🏷', name: 'ショップ 10% 割引券', note: '授与所の品が 1 回 10% 引き（受けるときに選んで使う）', use: 'auto' },
  shop_30: { emoji: '🏷', name: 'ショップ 30% 割引券', note: '授与所の品が 1 回 30% 引き（受けるときに選んで使う）', use: 'auto' },
  shop_50: { emoji: '🏷', name: 'ショップ 50% 割引券', note: '授与所の品が 1 回半額（受けるときに選んで使う）', use: 'auto' },
  ema_pin: { emoji: '📌', name: '絵馬のピン留め券', note: '授与所の「絵馬の奉納」が無料（受けるときに自動で使う）', use: 'auto' },
  market_nofee: { emoji: '🏪', name: '市場の手数料なし券', note: '市場で売れたとき、手数料を引かずに受け取れる（自動で使う）', use: 'auto' },
  fuku: { emoji: '🧧', name: '福の札', note: '使うと 24 時間、通話でもらえる銭が 2 倍', use: 'manual' },
  luck: { emoji: '🍀', name: '運気アップの札', note: '使うと、次の 10 回は物御籤の大吉が出やすくなる（2 倍）', use: 'manual' },
  omikuji_extra: { emoji: '🎴', name: 'おみくじもう 1 回券', note: 'その日のおみくじを、もう 1 回引ける（1 日 1 回まで）', use: 'manual' },
  gacha_free: { emoji: '🎁', name: '物御籤の無料券', note: '物御籤を 1 回タダで引ける', use: 'manual' },
  gacha_gold10: { emoji: '🌟', name: '金の10連券', note: '物御籤を 10 連タダで引ける（10 回のうち 1 回は大吉以上が確定）', use: 'manual' },
  gacha_gift: { emoji: '💝', name: '物御籤の贈り券', note: 'ほかの人に「物御籤の無料券」を贈れる', use: 'manual' },
  name_deco: { emoji: '🏷', name: '名前の飾り札', note: '使うと 7 日間、名前の前に好きな絵文字を 1 つ付けられる', use: 'manual' },
} as Record<TicketKind, TicketDef>;

/** 券の選び方（管理画面の選ぶ欄を、まとまりごとに分ける） */
export const TICKET_GROUPS: { label: string; kinds: TicketKind[] }[] = [
  { label: '🎫 部屋代（どの種類の部屋でも）', kinds: ['room_free'] },
  ...(Object.keys(ROOM_KIND_LABEL) as RoomKindKey[]).map((k) => ({
    label: `${ROOM_KIND_LABEL[k]}の部屋`,
    kinds: [`room_free_${k}`, `room_half_${k}`, `room_day_${k}`] as TicketKind[],
  })),
  { label: '🏷 授与所（ショップ）', kinds: ['shop_10', 'shop_30', 'shop_50', 'ema_pin'] },
  { label: '🏪 市場', kinds: ['market_nofee'] },
  { label: '🧧 使うと効く札（/物御籤 の「券を使う」から）', kinds: ['fuku', 'luck', 'omikuji_extra', 'gacha_free', 'gacha_gold10', 'gacha_gift', 'name_deco'] },
];

/** /物御籤 の「券を使う」から使う券 */
export const MANUAL_TICKETS = TICKET_KINDS.filter((k) => TICKET_LABEL[k].use === 'manual');

export const ticketName = (k: TicketKind) => `${TICKET_LABEL[k].emoji}${TICKET_LABEL[k].name}`;

export const emptyTickets = (): Record<TicketKind, number> => Object.fromEntries(TICKET_KINDS.map((k) => [k, 0])) as Record<TicketKind, number>;

export async function ticketsOf(db: Db, memberId: string): Promise<Record<TicketKind, number>> {
  const rows = await db.select().from(tickets).where(eq(tickets.memberId, memberId));
  const out = emptyTickets();
  for (const r of rows) if (r.kind in out) out[r.kind as TicketKind] = r.count;
  return out;
}

export async function addTickets(tx: Db, memberId: string, kind: TicketKind, count: number): Promise<void> {
  if (count <= 0) return;
  await tx
    .insert(tickets)
    .values({ memberId, kind, count })
    .onConflictDoUpdate({ target: [tickets.memberId, tickets.kind], set: { count: sql`${tickets.count} + ${count}`, updatedAt: new Date() } });
}

/** 1 枚使う。持っていなければ false（同時に使っても 0 より減らない） */
export async function useTicket(tx: Db, memberId: string, kind: TicketKind): Promise<boolean> {
  const rows = await tx
    .update(tickets)
    .set({ count: sql`${tickets.count} - 1`, updatedAt: new Date() })
    .where(and(eq(tickets.memberId, memberId), eq(tickets.kind, kind), gt(tickets.count, 0)))
    .returning({ count: tickets.count });
  return rows.length > 0;
}

/** 持っている券の一行（なければ undefined） */
export function ticketLine(t: Record<TicketKind, number>): string | undefined {
  const parts = TICKET_KINDS.filter((k) => t[k] > 0).map((k) => `${ticketName(k)} ×${t[k]}`);
  return parts.length ? parts.join('　') : undefined;
}

/** 運営が減らす（持っている分まで）。減らした枚数を返す */
export async function takeTickets(db: Db, memberId: string, kind: TicketKind, count: number): Promise<number> {
  if (count <= 0) return 0;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.memberId, memberId), eq(tickets.kind, kind)))
      .for('update');
    const take = Math.min(row?.count ?? 0, count);
    if (take <= 0) return 0;
    await tx
      .update(tickets)
      .set({ count: sql`${tickets.count} - ${take}`, updatedAt: new Date() })
      .where(and(eq(tickets.memberId, memberId), eq(tickets.kind, kind)));
    return take;
  });
}

/** 券を持っている人（管理画面）。多い順 */
export async function ticketHolders(db: Db): Promise<{ memberId: string; tickets: Record<TicketKind, number> }[]> {
  const rows = await db.select().from(tickets).where(gt(tickets.count, 0)).orderBy(desc(tickets.count));
  const by = new Map<string, Record<TicketKind, number>>();
  for (const r of rows) {
    if (!(r.kind in TICKET_LABEL)) continue;
    const t = by.get(r.memberId) ?? emptyTickets();
    t[r.kind as TicketKind] = r.count;
    by.set(r.memberId, t);
  }
  const sum = (t: Record<TicketKind, number>) => TICKET_KINDS.reduce((n, k) => n + t[k], 0);
  return [...by.entries()].map(([memberId, t]) => ({ memberId, tickets: t })).sort((a, b) => sum(b.tickets) - sum(a.tickets));
}
