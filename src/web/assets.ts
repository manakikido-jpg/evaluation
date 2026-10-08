import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isArtKey } from '../services/casino/slotArt.js';

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
const IMAGE_TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
/** 🀄 麻雀の牌の絵（public/mahjong/。名前は m1〜m9・p1〜p9・s1〜s9・ton・nan・sha・pei・haku・hatsu・chun・m5r・p5r・s5r（赤）・back） */
const MJ_DIR = path.join(here, 'public/mahjong');
const mjFiles = existsSync(MJ_DIR) ? readdirSync(MJ_DIR).filter((f) => /^[a-z0-9-]+\.(webp|png|jpg|svg)$/.test(f)) : [];
/**
 * 🦊 AT 機の絵（public/at/ に置いた画像。名前は社務所Web の絵の欄と同じ: bg-normal.png・byakko.webp など）。
 * GitHub のこのフォルダに入れると、自動更新で台に出る（社務所Web で入れた絵があれば、そちらが先）
 */
const AT_DIR = path.join(here, 'public/at');
const AT_EXT = ['webp', 'png', 'jpg', 'jpeg', 'gif'];
/** フォルダのファイル名から、絵の名前 → 使うファイル（同じ名前なら webp → png → jpg → gif） */
export function pickAtFiles(files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ext of [...AT_EXT].reverse()) {
    for (const f of files) {
      const m = /^([a-z0-9-]+)\.([a-z]+)$/.exec(f.toLowerCase());
      if (m && m[2] === ext && isArtKey(m[1]!) && f === f.toLowerCase()) out[m[1]!] = f;
    }
  }
  return out;
}
const atFiles = existsSync(AT_DIR) ? Object.values(pickAtFiles(readdirSync(AT_DIR))) : [];
const slotFiles = existsSync(SLOT_DIR) ? readdirSync(SLOT_DIR).filter((f) => /^[a-z0-9-]+\.(webp|png|jpg|svg)$/.test(f)) : [];

export const STATIC: Record<string, { body: string | Uint8Array<ArrayBuffer>; type: string; version: string }> = Object.fromEntries(
  Object.entries({
    ...Object.fromEntries(slotFiles.map((f) => [`slots-${f}`, { body: new Uint8Array(readFileSync(path.join(SLOT_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    ...Object.fromEntries(atFiles.map((f) => [`atart-${f}`, { body: new Uint8Array(readFileSync(path.join(AT_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    ...Object.fromEntries(mjFiles.map((f) => [`mahjong-${f}`, { body: new Uint8Array(readFileSync(path.join(MJ_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    'style.css': { body: readText(path.join(here, 'public/style.css')), type: 'text/css; charset=utf-8' },
    'editor.js': { body: readText(path.join(here, 'public/editor.js')), type: 'text/javascript; charset=utf-8' },
    'theme.js': { body: readText(path.join(here, 'public/theme.js')), type: 'text/javascript; charset=utf-8' },
    'menu.js': { body: readText(path.join(here, 'public/menu.js')), type: 'text/javascript; charset=utf-8' },
    'invite-selection.js': { body: readText(path.join(here, 'public/invite-selection.js')), type: 'text/javascript; charset=utf-8' },
    'perms.js': { body: readText(path.join(here, 'public/perms.js')), type: 'text/javascript; charset=utf-8' },
    'charts.js': { body: readText(path.join(here, 'public/charts.js')), type: 'text/javascript; charset=utf-8' },
    'casino-lobby.css': { body: readText(path.join(here, 'public/casino-lobby.css')), type: 'text/css; charset=utf-8' },
    'casino-lobby-night.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-night.webp'))), type: 'image/webp' },
    'casino-lobby-art.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-art.webp'))), type: 'image/webp' },
    'casino.css': { body: readText(path.join(here, 'public/casino.css')), type: 'text/css; charset=utf-8' },
    'casino-bg.svg': { body: readText(path.join(here, 'public/casino-bg.svg')), type: 'image/svg+xml' },
    'casino.js': { body: readText(path.join(here, 'public/casino.js')), type: 'text/javascript; charset=utf-8' },
    'atslot.js': { body: readText(path.join(here, 'public/atslot.js')), type: 'text/javascript; charset=utf-8' },
    'popup.js': { body: readText(path.join(here, 'public/popup.js')), type: 'text/javascript; charset=utf-8' },
    'htmx.min.js': { body: readText(path.join(here, '../../node_modules/htmx.org/dist/htmx.min.js')), type: 'text/javascript; charset=utf-8' },
  }).map(([name, f]) => [name, { ...f, version: createHash('sha256').update(f.body).digest('hex').slice(0, 10) }]),
);

export const assetUrl = (name: keyof typeof STATIC & string) => `/static/${name}?v=${STATIC[name]?.version ?? ''}`;

/** 🦊 フォルダ（public/at/）に置いた AT 機の絵（名前 → URL） */
export const AT_FILE_ART: Record<string, string> = Object.fromEntries(
  Object.entries(pickAtFiles(atFiles)).map(([key, f]) => [key, `/static/atart-${f}?v=${STATIC[`atart-${f}`]!.version}`]),
);

/** スロットの絵の URL（その名前の画像がなければ undefined） */
export const slotArt = (name: string) => artOf('slots', name);
/** 麻雀の牌の絵の URL（なければ undefined。そのときは字で描く） */
export const mahjongArt = (name: string) => artOf('mahjong', name);

function artOf(dir: string, name: string): string | undefined {
  for (const ext of ['webp', 'png', 'jpg', 'svg']) {
    const key = `${dir}-${name}.${ext}`;
    if (Object.hasOwn(STATIC, key)) return `/static/${key}?v=${STATIC[key]!.version}`;
  }
  return undefined;
}
