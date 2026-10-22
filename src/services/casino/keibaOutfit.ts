/** 馬ごとの着せ替え。速さや賞金には影響しない。 */
export const KB_OUTFIT_COLORS = {
  '#f7f7f2': '白', '#c53046': '紅', '#1e63d6': '青', '#d4af37': '金',
  '#232936': '墨', '#728c69': '若草', '#b580c9': '藤', '#efa9be': '桜',
} as const;
export const KB_HOODS = { none: 'なし', ears: '耳カバー', full: '顔・耳カバー' } as const;
export const KB_ORNAMENTS = { none: 'なし', sakura: '桜の飾り', ribbon: 'リボン' } as const;
export type KbOutfit = { cloth: string; bridle: string; hood: keyof typeof KB_HOODS; ornament: keyof typeof KB_ORNAMENTS; aura?: KbAura | null; auraOwned?: KbAuraKey[]; auraRevision?: number };
export const KB_DEFAULT_OUTFIT: KbOutfit = { cloth: '#f7f7f2', bridle: '#232936', hood: 'none', ornament: 'none' };
export function isOutfit(value: unknown): value is KbOutfit {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.cloth === 'string' && Object.hasOwn(KB_OUTFIT_COLORS, o.cloth)
    && typeof o.bridle === 'string' && Object.hasOwn(KB_OUTFIT_COLORS, o.bridle)
    && typeof o.hood === 'string' && Object.hasOwn(KB_HOODS, o.hood)
    && typeof o.ornament === 'string' && Object.hasOwn(KB_ORNAMENTS, o.ornament);
}

export const KB_AURAS = {
  silver: { name: '白銀', body: '#d9e3ef', glow: '#bbddff' },
  ruby: { name: '紅玉', body: '#c83550', glow: '#ff6980' },
  sapphire: { name: '蒼天', body: '#3978dc', glow: '#70caff' },
  sakura: { name: '桜花', body: '#e9a1c1', glow: '#ffb5dc' },
  violet: { name: '藤霞', body: '#a37ad2', glow: '#caa0ff' },
} as const;
export type KbAuraKey = keyof typeof KB_AURAS;
export type KbAura = { key: KbAuraKey | 'gold' | 'custom'; body: string; glow: string };
export const KB_AURA_PRICE = 3500;
export const KB_CUSTOM_AURA_PRICE = 7000;
export const isAuraColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
