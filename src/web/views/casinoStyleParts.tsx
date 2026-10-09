import { styleItem } from '../../services/casino/styles.js';
import { assetUrl } from '../assets.js';

/** 見本と実際の席で、同じ置物を出す。 */
export function StyleOrnament(p: { itemKey?: string; fallback?: string }) {
  const item = styleItem(p.itemKey ?? '');
  if (item?.slot === 'ornament' && ['fox', 'fan'].includes(item.key)) {
    return <img class="cs-ornament-art" src={assetUrl(`casino-ornament-${item.key}.webp`)} alt={item.name} width="80" height="80" />;
  }
  return p.fallback ? <span class="cs-emblem" aria-hidden="true">{p.fallback}</span> : null;
}
