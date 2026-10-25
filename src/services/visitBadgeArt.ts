import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

/** 実績IDと採用した金細工。獲得条件はvisitProfile側を共用する。 */
export const VISIT_BADGE_ART: Record<string, { file: string; motif: string }> = {
  first: { file: 'sakura-pearl.png', motif: '真珠の桜' },
  vc1: { file: 'moon.png', motif: '三日月' },
  vc10: { file: 'fan.png', motif: '紫水晶の扇' },
  vc100: { file: 'fox.png', motif: '狐面' },
  vc500: { file: 'dragon.png', motif: '翡翠の龍' },
  days7: { file: 'torii.png', motif: '鳥居' },
  days30: { file: 'phoenix.png', motif: '鳳凰' },
  anniversary: { file: 'sakura-crown.png', motif: '紅玉の八重桜' },
};
const images = new Map<string, Buffer>();
/** 固定の素材だけを読む。ユーザー入力をパスとして使わない。 */
export function visitBadgeImage(id: string): Buffer | undefined {
  const art = Object.hasOwn(VISIT_BADGE_ART, id) ? VISIT_BADGE_ART[id] : undefined;
  if (!art) return undefined;
  let image = images.get(art.file);
  if (!image) {
    const original = readFileSync(new URL('../../assets/visit/badges/' + art.file, import.meta.url));
    // 56/80pxの表示に十分な256pxへ一度だけ描画し、Webへ原寸の数MBを配らない。
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><image width="256" height="256" href="data:image/png;base64,' + original.toString('base64') + '"/></svg>';
    image = Buffer.from(new Resvg(svg).render().asPng());
    images.set(art.file, image);
  }
  return image;
}
