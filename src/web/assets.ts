import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 画面で使う CSS・JS。URL に中身から作った印（?v=…）を付けるので、
 * 更新したらブラウザが古いものを使い続けない（前の CSS のままだとグラフが真っ黒になる）。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const readText = (p: string) => readFileSync(p, 'utf8');

/**
 * スロットの絵（public/slots/ に置いた画像。名前は「絵柄.拡張子」: seven.webp・top.png など）。
 * 同じ名前なら webp → png → jpg → svg の順に使う（あとから画像を足せば、仮の SVG と入れ替わる）
 */
const SLOT_DIR = path.join(here, 'public/slots');
const IMAGE_TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
const slotFiles = existsSync(SLOT_DIR) ? readdirSync(SLOT_DIR).filter((f) => /^[a-z0-9-]+\.(webp|png|jpg|svg)$/.test(f)) : [];

export const STATIC: Record<string, { body: string | Uint8Array<ArrayBuffer>; type: string; version: string }> = Object.fromEntries(
  Object.entries({
    ...Object.fromEntries(slotFiles.map((f) => [`slots-${f}`, { body: new Uint8Array(readFileSync(path.join(SLOT_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    'style.css': { body: readText(path.join(here, 'public/style.css')), type: 'text/css; charset=utf-8' },
    'editor.js': { body: readText(path.join(here, 'public/editor.js')), type: 'text/javascript; charset=utf-8' },
    'menu.js': { body: readText(path.join(here, 'public/menu.js')), type: 'text/javascript; charset=utf-8' },
    'perms.js': { body: readText(path.join(here, 'public/perms.js')), type: 'text/javascript; charset=utf-8' },
    'casino.css': { body: readText(path.join(here, 'public/casino.css')), type: 'text/css; charset=utf-8' },
    'casino-bg.svg': { body: readText(path.join(here, 'public/casino-bg.svg')), type: 'image/svg+xml' },
    'casino.js': { body: readText(path.join(here, 'public/casino.js')), type: 'text/javascript; charset=utf-8' },
    'popup.js': { body: readText(path.join(here, 'public/popup.js')), type: 'text/javascript; charset=utf-8' },
    'htmx.min.js': { body: readText(path.join(here, '../../node_modules/htmx.org/dist/htmx.min.js')), type: 'text/javascript; charset=utf-8' },
  }).map(([name, f]) => [name, { ...f, version: createHash('sha256').update(f.body).digest('hex').slice(0, 10) }]),
);

export const assetUrl = (name: keyof typeof STATIC & string) => `/static/${name}?v=${STATIC[name]?.version ?? ''}`;

/** スロットの絵の URL（その名前の画像がなければ undefined） */
export function slotArt(name: string): string | undefined {
  for (const ext of ['webp', 'png', 'jpg', 'svg']) {
    const key = `slots-${name}.${ext}`;
    if (Object.hasOwn(STATIC, key)) return `/static/${key}?v=${STATIC[key]!.version}`;
  }
  return undefined;
}
