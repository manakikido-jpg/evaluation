/** 馬ごとの着せ替え。速さや賞金には影響しない。 */
export const KB_OUTFIT_COLORS = {
  '#f7f7f2': '白', '#c53046': '紅', '#1e63d6': '青', '#d4af37': '金',
  '#232936': '墨', '#728c69': '若草', '#b580c9': '藤', '#efa9be': '桜',
} as const;
export const KB_HOODS = { none: 'なし', ears: '耳カバー', full: '顔・耳カバー' } as const;
export const KB_ORNAMENTS = { none: 'なし', sakura: '桜の飾り', ribbon: 'リボン' } as const;
export type KbOutfit = { cloth: string; bridle: string; hood: keyof typeof KB_HOODS; ornament: keyof typeof KB_ORNAMENTS };
export const KB_DEFAULT_OUTFIT: KbOutfit = { cloth: '#f7f7f2', bridle: '#232936', hood: 'none', ornament: 'none' };
export function isOutfit(value: unknown): value is KbOutfit {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.cloth === 'string' && Object.hasOwn(KB_OUTFIT_COLORS, o.cloth)
    && typeof o.bridle === 'string' && Object.hasOwn(KB_OUTFIT_COLORS, o.bridle)
    && typeof o.hood === 'string' && Object.hasOwn(KB_HOODS, o.hood)
    && typeof o.ornament === 'string' && Object.hasOwn(KB_ORNAMENTS, o.ornament);
}
