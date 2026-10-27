import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISIT_BADGE_ART, visitBadgeImage } from '../services/visitBadgeArt.js';
import { isArtKey } from '../services/casino/slotArt.js';

/**
 * 画面で使う CSS・JS。URL に中身から作った印（?v=…）を付けるので、
 * 更新したらブラウザが古いものを使い続けない（前の CSS のままだとグラフが真っ黒になる）。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const bingoShrine = new Uint8Array(readFileSync(path.join(here, '../../assets/visit/background-paper.jpg')));
const bingoShrineVersion = createHash('sha256').update(bingoShrine).digest('hex').slice(0, 10);
const readText = (p: string) => readFileSync(p, 'utf8');
const keibaReplay = readText(path.join(here, 'public/keiba-replay.js'));
const keibaHorse = readText(path.join(here, 'public/keiba-horse.js'));
const keibaReplayHash = createHash('sha256').update(keibaReplay).digest('hex').slice(0, 10);
const keibaHorseHash = createHash('sha256').update(keibaHorse).digest('hex').slice(0, 10);
const lifeRoute = readText(path.join(here, 'public/life-route.js'));
const lifeRouteHash = createHash('sha256').update(lifeRoute).digest('hex').slice(0, 10);
const threeDir = path.dirname(createRequire(import.meta.url).resolve('three'));
const threeCore = readText(path.join(threeDir, 'three.core.js'));
const threeCoreHash = createHash('sha256').update(threeCore).digest('hex').slice(0, 10);
const threeModule = readText(path.join(threeDir, 'three.module.js')).replaceAll("'./three.core.js'", `'./three.core.js?v=${threeCoreHash}'`);
/** 絵を差し替えたときも、着せ替えのCSSから新しい絵を読む。 */
const premiumCss = () => readText(path.join(here, 'public/casino-premium.css')).replace(/\/static\/(casino-(scene|table|ornament|trim)-([a-z]+)\.(webp|svg))/g, (_url, name: string, kind: string, key: string, ext: string) => {
  const folder = { scene: 'casino-scenes', table: 'casino-tables', ornament: 'casino-ornaments' }[kind as 'scene' | 'table' | 'ornament'];
  const file = folder ? path.join(here, 'public', folder, `${key}.${ext}`) : path.join(here, 'public', `casino-trim-${key}.${ext}`);
  const version = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
  return `/static/${name}?v=${version}`;
});

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
const SCENE_DIR = path.join(here, 'public/casino-scenes');
const sceneFiles = readdirSync(SCENE_DIR).filter((f) => /^[a-z]+\.(svg|webp)$/.test(f));

/** 神符合戦の生成画像。カードの数字や名前はHTMLで重ねる。 */
const SHINPU_DIR = path.join(here, 'public/shinpu');
const SHINPU_CATALOG_DIR = path.join(here, 'public/shinpu-catalog');
const catalogImages = ['cards', 'thumbnails'].flatMap(size =>
  readdirSync(path.join(SHINPU_CATALOG_DIR, size)).filter(f => /^SK-\d{3}\.webp$/.test(f)).map(file => [
    `shinpu-catalog-${size}-${file}`, { body: new Uint8Array(readFileSync(path.join(SHINPU_CATALOG_DIR, size, file))), type: 'image/webp' },
  ] as const));
const shinpuFiles = readdirSync(SHINPU_DIR).filter(f => /^[a-z][a-z0-9-]*\.webp$/.test(f));
const shinpuCss = () => readText(path.join(here, 'public/shinpu.css')).replace(/\/static\/(shinpu-([a-z][a-z0-9-]*)\.webp)/g, (_url, name: string, key: string) => {
  const file = path.join(SHINPU_DIR, `${key}.webp`);
  const version = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
  return `/static/${name}?v=${version}`;
});

export const STATIC: Record<string, { body: string | Uint8Array<ArrayBuffer>; type: string; version: string }> = Object.fromEntries(
  Object.entries({
    ...Object.fromEntries(Object.keys(VISIT_BADGE_ART).map(id => ['visit-badge-' + id + '.png', { body: new Uint8Array(visitBadgeImage(id)!), type: 'image/png' }])),
    'keiba-club.css': { body: readText(path.join(here, 'public/keiba-club.css')), type: 'text/css; charset=utf-8' },
    'keiba-preview.css': { body: readText(path.join(here, 'public/keiba-preview.css')), type: 'text/css; charset=utf-8' },
    'keiba-replay.js': { body: keibaReplay, type: 'text/javascript; charset=utf-8' },
    'keiba-horse.js': { body: keibaHorse, type: 'text/javascript; charset=utf-8' },
    'keiba-preview.js': { body: readText(path.join(here, 'public/keiba-preview.js')).replace('./keiba-replay.js?v=1', `./keiba-replay.js?v=${keibaReplayHash}`).replace('./keiba-horse.js?v=1', `./keiba-horse.js?v=${keibaHorseHash}`), type: 'text/javascript; charset=utf-8' },
    'three.core.js': { body: threeCore, type: 'text/javascript; charset=utf-8' },
    'three.module.js': { body: threeModule, type: 'text/javascript; charset=utf-8' },
    'life-route.js': { body: lifeRoute, type: 'text/javascript; charset=utf-8' },
    'life3d.js': { body: readText(path.join(here, 'public/life3d.js')).replace('./life-route.js?v=1', `./life-route.js?v=${lifeRouteHash}`), type: 'text/javascript; charset=utf-8' },
    ...Object.fromEntries(sceneFiles.map((f) => [`casino-scene-${f}`, { body: new Uint8Array(readFileSync(path.join(SCENE_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    ...Object.fromEntries(slotFiles.map((f) => [`slots-${f}`, { body: new Uint8Array(readFileSync(path.join(SLOT_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    ...Object.fromEntries(atFiles.map((f) => [`atart-${f}`, { body: new Uint8Array(readFileSync(path.join(AT_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    ...Object.fromEntries(mjFiles.map((f) => [`mahjong-${f}`, { body: new Uint8Array(readFileSync(path.join(MJ_DIR, f))), type: IMAGE_TYPES[f.split('.').pop()!]! }])),
    'maikura-pop.png': { body: new Uint8Array(readFileSync(path.join(here, 'public/maikura-pop.png'))), type: 'image/png' },
    'cast-office.css': { body: readText(path.join(here, 'public/cast-office.css')), type: 'text/css; charset=utf-8' },
    'cast-office.js': { body: readText(path.join(here, 'public/cast-office.js')), type: 'text/javascript; charset=utf-8' },
    ...Object.fromEntries(shinpuFiles.map(f => [`shinpu-${f}`, { body: new Uint8Array(readFileSync(path.join(SHINPU_DIR, f))), type: 'image/webp' }])),
    ...Object.fromEntries(catalogImages),
    'shinpu-catalog.css': { body: readText(path.join(here, 'public/shinpu-catalog.css')), type: 'text/css; charset=utf-8' },
    'shinpu.css': { body: shinpuCss(), type: 'text/css; charset=utf-8' },
    'shinpu.js': { body: readText(path.join(here, 'public/shinpu.js')), type: 'text/javascript; charset=utf-8' },
    'style.css': { body: readText(path.join(here, 'public/style.css')), type: 'text/css; charset=utf-8' },
    'recordings.js': { body: readText(path.join(here, 'public/recordings.js')), type: 'text/javascript; charset=utf-8' },
    'editor.js': { body: readText(path.join(here, 'public/editor.js')), type: 'text/javascript; charset=utf-8' },
    'guide.js': { body: readText(path.join(here, 'public/guide.js')), type: 'text/javascript; charset=utf-8' },
    'nav-order.js': { body: readText(path.join(here, 'public/nav-order.js')), type: 'text/javascript; charset=utf-8' },
    'org.js': { body: readText(path.join(here, 'public/org.js')), type: 'text/javascript; charset=utf-8' },
    'theme.js': { body: readText(path.join(here, 'public/theme.js')), type: 'text/javascript; charset=utf-8' },
    'menu.js': { body: readText(path.join(here, 'public/menu.js')), type: 'text/javascript; charset=utf-8' },
    'copy-text.js': { body: readText(path.join(here, 'public/copy-text.js')), type: 'text/javascript; charset=utf-8' },
    'bingo-shrine.jpg': { body: bingoShrine, type: 'image/jpeg' },
    'bingo.css': { body: readText(path.join(here, 'public/bingo.css')).replaceAll('/static/bingo-shrine.jpg', '/static/bingo-shrine.jpg?v=' + bingoShrineVersion), type: 'text/css; charset=utf-8' },
    'bingo.js': { body: readText(path.join(here, 'public/bingo.js')), type: 'text/javascript; charset=utf-8' },
    'member-filters.js': { body: readText(path.join(here, 'public/member-filters.js')), type: 'text/javascript; charset=utf-8' },
    'office-actions.js': { body: readText(path.join(here, 'public/office-actions.js')), type: 'text/javascript; charset=utf-8' },
    'office-ui.js': { body: readText(path.join(here, 'public/office-ui.js')), type: 'text/javascript; charset=utf-8' },
    'invite-selection.js': { body: readText(path.join(here, 'public/invite-selection.js')), type: 'text/javascript; charset=utf-8' },
    'perms.js': { body: readText(path.join(here, 'public/perms.js')), type: 'text/javascript; charset=utf-8' },
    'charts.js': { body: readText(path.join(here, 'public/charts.js')), type: 'text/javascript; charset=utf-8' },
    'home-voice.js': { body: readText(path.join(here, 'public/home-voice.js')), type: 'text/javascript; charset=utf-8' },
    'casino-lobby.css': { body: readText(path.join(here, 'public/casino-lobby.css')), type: 'text/css; charset=utf-8' },
    'casino-lobby-night.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-night.webp'))), type: 'image/webp' },
    ...Object.fromEntries(['fox', 'fan'].map(key => [`casino-ornament-${key}.webp`, { body: new Uint8Array(readFileSync(path.join(here, `public/casino-ornaments/${key}.webp`))), type: 'image/webp' }])),
    ...Object.fromEntries(['yozakura', 'foxroom', 'gold', 'stars'].map(key => [`casino-table-${key}.webp`, { body: new Uint8Array(readFileSync(path.join(here, `public/casino-tables/${key}.webp`))), type: 'image/webp' }])),
    'casino-premium.css': { body: premiumCss(), type: 'text/css; charset=utf-8' },
    ...Object.fromEntries(['sakura', 'dragon'].map(key => [`casino-trim-${key}.svg`, { body: readText(path.join(here, `public/casino-trim-${key}.svg`)), type: 'image/svg+xml' }])),
    'casino-lobby-cards.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-cards.webp'))), type: 'image/webp' },
    'casino-lobby-more.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-more.webp'))), type: 'image/webp' },
    'casino-lobby-art.webp': { body: new Uint8Array(readFileSync(path.join(here, 'public/casino-lobby-art.webp'))), type: 'image/webp' },
    'visit.css': { body: readText(path.join(here, 'public/visit.css')), type: 'text/css; charset=utf-8' },
    'marketplace.css': { body: readText(path.join(here, 'public/marketplace.css')), type: 'text/css; charset=utf-8' },
    'casino.css': { body: readText(path.join(here, 'public/casino.css')), type: 'text/css; charset=utf-8' },
    'casino-bg.svg': { body: readText(path.join(here, 'public/casino-bg.svg')), type: 'image/svg+xml' },
    'casino-request.js': { body: readText(path.join(here, 'public/casino-request.js')), type: 'text/javascript; charset=utf-8' },
    'fortune.js': { body: readText(path.join(here, 'public/fortune.js')), type: 'text/javascript; charset=utf-8' },
    'fortune.css': { body: readText(path.join(here, 'public/fortune.css')), type: 'text/css; charset=utf-8' },
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
