import data from './catalog-data.json' with { type: 'json' };

/** 制作済みの札の仕様。対戦エンジンの山札とは分けて管理する。 */
export const catalog = data.cards;
export const catalogSourceCommit = data.sourceCommit;
export type CatalogCard = (typeof catalog)[number];
export const catalogCategories = ['武器', '防具', '奇跡', '道具', '取引'] as const;
export const catalogElements = ['火', '水', '風', '雷', '土', '光', '闇', '無'] as const;

export function findCatalogCards(query = '', category = '', element = '') {
  const words = query.trim().normalize('NFKC').toLocaleLowerCase('ja').split(/\s+/).filter(Boolean);
  return catalog.filter((card) => {
    const text = `${card.id} ${card.name} ${card.effect}`.normalize('NFKC').toLocaleLowerCase('ja');
    return (!category || card.category === category) && (!element || card.element === element) && words.every(w => text.includes(w));
  });
}
