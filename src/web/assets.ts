import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 画面で使う CSS・JS。URL に中身から作った印（?v=…）を付けるので、
 * 更新したらブラウザが古いものを使い続けない（前の CSS のままだとグラフが真っ黒になる）。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const readText = (p: string) => readFileSync(p, 'utf8');

export const STATIC: Record<string, { body: string; type: string; version: string }> = Object.fromEntries(
  Object.entries({
    'style.css': { body: readText(path.join(here, 'public/style.css')), type: 'text/css; charset=utf-8' },
    'htmx.min.js': { body: readText(path.join(here, '../../node_modules/htmx.org/dist/htmx.min.js')), type: 'text/javascript; charset=utf-8' },
  }).map(([name, f]) => [name, { ...f, version: createHash('sha256').update(f.body).digest('hex').slice(0, 10) }]),
);

export const assetUrl = (name: keyof typeof STATIC & string) => `/static/${name}?v=${STATIC[name]?.version ?? ''}`;
