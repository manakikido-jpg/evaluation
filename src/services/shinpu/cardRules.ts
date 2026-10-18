import { catalog } from './catalog.js';
import type { CardDefinition } from './engine.js';

/** 数値・効果文は完成カード、出現重みと価格は保存済み237枚案を使う。 */
export const catalogCards: CardDefinition[] = catalog.map(c => ({
  id: c.id, name: c.name, element: c.element, cost: c.mpCost,
  type: c.attack > 0 ? 'attack' : c.category === '防具' ? 'guard' : c.heal > 0 ? 'heal'
    : c.effectKey.startsWith('mp_') && c.effectKey !== 'mp_heal_cleanse' ? 'mana'
    : c.effectKey === 'cleanse' ? 'cleanse' : c.effectKey === 'earn_money' ? 'money' : 'tool',
  power: c.attack || c.defense || c.heal || ({ mp_small: 3, mp_medium: 6, mp_large: 9, earn_money: 8 }[c.effectKey as 'mp_small'] ?? 0),
  icon: c.category === '武器' ? '⚔' : c.category === '防具' ? '🛡' : c.category === '奇跡' ? '✦' : '✿',
  stackable: c.stackable, text: c.effect, effect: c.effectKey,
  category: c.category, rarity: c.rarity, weight: c.drawWeight, price: c.tradeValue,
}));
export const ELEMENTS = ['火', '水', '風', '雷', '土', '光', '闇'] as const;
