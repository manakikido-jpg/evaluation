/** 小判は額面の150％。割引や追加の送付手数料は使わない。 */
export const KOBAN_VALUES = [1000, 3000, 5000, 10000] as const;
export type KobanValue = typeof KOBAN_VALUES[number];
export type KobanKind = `koban_${KobanValue}`;
export function kobanValue(kind: string): KobanValue | undefined {
  return KOBAN_VALUES.find(value => kind === `koban_${value}`);
}
export const kobanPrice = (value: KobanValue) => value * 3 / 2;
