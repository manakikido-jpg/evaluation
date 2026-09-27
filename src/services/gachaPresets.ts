import type { Db } from '../db/client.js';
import type { GachaPrizeRow, ShopItem } from '../db/schema.js';
import { createPrize, listPrizes, type PrizeInput } from './gacha.js';

/**
 * 物御籤の「おすすめの中身」: 限定の色守り・称号のロールと、券・札・十二支・ショップの色守りなどをまとめて足す。
 * 同じ中身がもうあれば足さない（何度押しても増えない）。
 */

export const PRESET_ROLES = [
  { key: 'gold', name: '✨ 金色（物御籤）', color: 0xe6b422 },
  { key: 'yozakura', name: '🌙 夜桜色（物御籤）', color: 0x9b6b9e },
  { key: 'ruri', name: '🌊 瑠璃色（物御籤）', color: 0x1e50a2 },
  { key: 'guren', name: '🔥 紅蓮色（物御籤）', color: 0xc53d43 },
  { key: 'miko', name: '🎴 大吉の申し子', color: 0 },
  { key: 'master', name: '👑 物御籤の主', color: 0 },
  { key: 'zodiac', name: '🐉 十二支守', color: 0 },
] as const;
export type PresetRoleKey = (typeof PRESET_ROLES)[number]['key'];

/** おすすめの中身（roles: 作った・見つけたロールの ID。shopColors: ショップの期限つきの色守り） */
export function presetPrizes(roles: Partial<Record<PresetRoleKey, string>>, shopColors: ShopItem[]): PrizeInput[] {
  const base = { amount: 1, weight: 1, fallback: false };
  const role = (key: PresetRoleKey): PrizeInput[] => (roles[key] ? [{ ...base, tier: 'daikichi', kind: 'role', roleId: roles[key] }] : []);
  return [
    // 🎊 超大当たり: 運営が渡す賞品（残り 1。渡したら社務所Web で補充）
    { ...base, tier: 'super', kind: 'special', label: 'Discord Nitro 1 か月分', stock: 1 },
    // 🌸 大吉: 物御籤限定の色守り・称号（全部持っていたら部屋代無料券 ×3）
    ...role('gold'),
    ...role('yozakura'),
    ...role('ruri'),
    ...role('guren'),
    ...role('miko'),
    ...role('master'),
    { ...base, tier: 'daikichi', kind: 'ticket', ticket: 'room_free', amount: 3, fallback: true },
    // 🏮 中吉: 福の札・運気アップ・無料券・ショップの色守り（30 日）
    { ...base, tier: 'chukichi', kind: 'ticket', ticket: 'fuku', weight: 2 },
    { ...base, tier: 'chukichi', kind: 'ticket', ticket: 'luck' },
    { ...base, tier: 'chukichi', kind: 'ticket', ticket: 'gacha_free' },
    ...shopColors.map((i): PrizeInput => ({ ...base, tier: 'chukichi', kind: 'shop', shopItemId: i.id })),
    // 🎐 小吉: 十二支のお守り・名前の飾り・贈り券・授与所 30% 引き
    { ...base, tier: 'shokichi', kind: 'zodiac', weight: 3, ...(roles.zodiac ? { roleId: roles.zodiac } : {}) },
    { ...base, tier: 'shokichi', kind: 'ticket', ticket: 'name_deco' },
    { ...base, tier: 'shokichi', kind: 'ticket', ticket: 'gacha_gift' },
    { ...base, tier: 'shokichi', kind: 'ticket', ticket: 'shop_30' },
    // 🍡 吉: おみくじもう 1 回券・授与所 10% 引き・お賽銭返し
    { ...base, tier: 'kichi', kind: 'ticket', ticket: 'omikuji_extra', weight: 2 },
    { ...base, tier: 'kichi', kind: 'ticket', ticket: 'shop_10' },
    { ...base, tier: 'kichi', kind: 'coins', amount: 100, weight: 2 },
  ];
}

const same = (a: PrizeInput, b: GachaPrizeRow) =>
  a.tier === b.tier &&
  a.kind === b.kind &&
  (a.roleId ?? null) === b.roleId &&
  (a.ticket ?? null) === b.ticket &&
  (a.shopItemId ?? null) === b.shopItemId &&
  (a.label ?? null) === b.label &&
  (a.kind === 'coins' ? a.amount === b.amount : true);

/** まだない中身だけ足す。足した数 */
export async function addPresetPrizes(db: Db, list: PrizeInput[]): Promise<number> {
  const now = await listPrizes(db);
  let added = 0;
  for (const p of list) {
    if (now.some((x) => same(p, x))) continue;
    await createPrize(db, p);
    added++;
  }
  return added;
}
