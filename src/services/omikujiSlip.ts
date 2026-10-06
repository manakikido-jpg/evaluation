import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

/**
 * 📜 おみくじの紙（縦書きの画像）を、引くたびに作る。
 * 台紙（社務所Web で入れた絵）があれば、その上に紙を重ねて字を書く。なければ、ここで描いた柄を使う。
 * 字は assets/fonts の明朝体（Shippori Mincho B1 を JIS 第 1・第 2 水準に絞ったもの。太字は第 1 水準まで）
 */

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FONT_FILES = [`${FONT_DIR}ShipporiMinchoB1-500.ttf`, `${FONT_DIR}ShipporiMinchoB1-800.ttf`];
const BODY = 'Shippori Mincho B1 Medium';
const BOLD = 'Shippori Mincho B1 ExtraBold';

export const SLIP_W = 600;
export const SLIP_H = 1200;

export type SlipInput = {
  /** 運勢の名前（大吉・小林吉 など） */
  name: string;
  /** 色（#rrggbb） */
  color: string;
  message: string;
  items: { label: string; text: string }[];
  /** 神社の名前（上に「〇〇　御神籤」。印にも使う） */
  shrine: string;
  /** 第〇番（なければ出さない） */
  number?: number;
  date: Date;
  /** 🎴 運営吉（金の枠・特別な柄） */
  special?: boolean;
  /** 台紙（PNG・JPEG）。あれば紙・枠・線は描かず、字と朱印だけ書く */
  bg?: { contentType: string; data: Uint8Array };
  /** 運勢の向き（台紙がないときの柄: good = 桜と金 / normal = 桜 / bad = 雲） */
  tone?: 'good' | 'normal' | 'bad';
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 1〜999 を漢数字に（十七・二十・百五 など） */
export function kanjiNumber(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 1000) return String(n);
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  return `${h ? `${h > 1 ? KANJI[h] : ''}百` : ''}${t ? `${t > 1 ? KANJI[t] : ''}十` : ''}${o ? KANJI[o] : ''}`;
}

/** 日本時間の和暦（令和八年十月六日） */
export function wareki(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3_600_000);
  const y = j.getUTCFullYear() - 2018;
  return `令和${y === 1 ? '元' : kanjiNumber(y)}年${kanjiNumber(j.getUTCMonth() + 1)}月${kanjiNumber(j.getUTCDate())}日`;
}

// ───────── 縦書き ─────────

/** 90 度回して置く字（長音・括弧・波線・三点リーダーなど） */
const ROTATE = new Set([...'ー―—－-~〜～…‥（）()「」『』【】〈〉《》［］[]｛｝{}＝=→←⇒']);
/** 右上に寄せる句読点 */
const PUNCT = new Set([...'、。，．,.']);
/** 少し右上に寄せる小さい字 */
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ']);
/** 行のはじめに来てはいけない字（前の行にぶら下げる） */
const NO_START = new Set([...'、。，．,.）」』】〉》］｝ー！？!?ぁぃぅぇぉっゃゅょァィゥェォッャュョ…‥']);

/** 縦に 1 列の字を置く（x: 列の中心、y: 上の端） */
function vcol(chars: string[], x: number, y: number, size: number, attrs: string, step = 1.02): string {
  return chars
    .map((c, k) => {
      if (c === ' ' || c === '　') return '';
      const cy = y + k * size * step + size / 2;
      const base = `font-size="${size}" ${attrs}`;
      if (ROTATE.has(c)) return `<text x="${x}" y="${cy + size * 0.36}" text-anchor="middle" ${base} transform="rotate(90 ${x} ${cy})">${esc(c)}</text>`;
      if (PUNCT.has(c)) return `<text x="${x + size * 0.62}" y="${cy + size * 0.36 - size * 0.62}" text-anchor="middle" ${base}>${esc(c)}</text>`;
      if (SMALL.has(c)) return `<text x="${x + size * 0.1}" y="${cy + size * 0.36 - size * 0.1}" text-anchor="middle" ${base}>${esc(c)}</text>`;
      return `<text x="${x}" y="${cy + size * 0.36}" text-anchor="middle" ${base}>${esc(c)}</text>`;
    })
    .join('');
}

/** 列に分ける（1 列 per 字まで。行頭に来てはいけない字は前の列にぶら下げる）。first: 最初の列だけ短いとき */
export function wrapColumns(text: string, per: number, first = per): string[][] {
  const chars = [...text];
  const cols: string[][] = [];
  let cur: string[] = [];
  for (const c of chars) {
    const limit = cols.length ? per : first;
    if (cur.length >= limit && !NO_START.has(c)) {
      cols.push(cur);
      cur = [];
    }
    cur.push(c);
  }
  if (cur.length) cols.push(cur);
  return cols;
}

// ───────── 柄 ─────────

/** 桜（5 枚の花びら）。r: 大きさ */
const sakura = (cx: number, cy: number, r: number, fill: string, op: number, rot = 0) =>
  `<g transform="translate(${cx} ${cy}) rotate(${rot})" opacity="${op}">${[0, 72, 144, 216, 288]
    .map((a) => `<path transform="rotate(${a})" d="M0 0 C ${-r * 0.55} ${-r * 0.35} ${-r * 0.45} ${-r * 0.95} 0 ${-r * 0.82} C ${r * 0.45} ${-r * 0.95} ${r * 0.55} ${-r * 0.35} 0 0 Z" fill="${fill}"/>`)
    .join('')}<circle r="${r * 0.14}" fill="#fff6d0"/></g>`;

/** 雲（丸を重ねたもの） */
const cloud = (x: number, y: number, s: number, fill: string, op: number) =>
  `<g opacity="${op}" fill="${fill}"><ellipse cx="${x}" cy="${y}" rx="${s * 1.4}" ry="${s * 0.55}"/><circle cx="${x - s * 0.55}" cy="${y - s * 0.25}" r="${s * 0.5}"/><circle cx="${x + s * 0.25}" cy="${y - s * 0.45}" r="${s * 0.62}"/><circle cx="${x + s * 0.9}" cy="${y - s * 0.1}" r="${s * 0.42}"/></g>`;

/** 金のきらめき（4 方向の星） */
const sparkle = (x: number, y: number, r: number, fill: string, op: number) =>
  `<path opacity="${op}" fill="${fill}" d="M${x} ${y - r} Q ${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q ${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q ${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q ${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z"/>`;

/** 決まった並びの乱数（同じ運勢なら同じ柄） */
function seeded(seed: number) {
  let x = seed || 1;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 2147483647, 7);

/** #rrggbb を明るく（t > 0）・暗く（t < 0） */
export function shade(hex: string, t: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const GOLD = '#c9a43a';
const INK = '#2b1d14';
const PAPER = '#fbf6ea';

function background(inp: SlipInput): string {
  const c = inp.color;
  if (inp.bg) {
    const href = `data:${inp.bg.contentType};base64,${Buffer.from(inp.bg.data).toString('base64')}`;
    return `<rect width="${SLIP_W}" height="${SLIP_H}" fill="${shade(c, -0.4)}"/><image href="${href}" x="0" y="0" width="${SLIP_W}" height="${SLIP_H}" preserveAspectRatio="xMidYMid slice"/>`;
  }
  const rand = seeded(hash(inp.name));
  const parts: string[] = [];
  if (inp.special) {
    // 運営吉: 色のグラデーション・金の枠・雲・桜・きらめき
    parts.push(
      `<defs><linearGradient id="bgg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 0.15)}"/><stop offset="1" stop-color="${shade(c, -0.45)}"/></linearGradient>` +
        `<radialGradient id="glow" cx="0.5" cy="0.3" r="0.6"><stop offset="0" stop-color="#fff3c4" stop-opacity="0.55"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient></defs>`,
      `<rect width="${SLIP_W}" height="${SLIP_H}" fill="url(#bgg)"/>`,
      `<rect width="${SLIP_W}" height="${SLIP_H}" fill="url(#glow)"/>`,
    );
    // 斜めの格子（菱）
    for (let k = -SLIP_H; k < SLIP_W; k += 46) parts.push(`<path d="M${k} 0 L${k + SLIP_H} ${SLIP_H}" stroke="#fff" stroke-opacity="0.06" stroke-width="2"/><path d="M${k + SLIP_H} 0 L${k} ${SLIP_H}" stroke="#fff" stroke-opacity="0.06" stroke-width="2"/>`);
    for (let k = 0; k < 7; k++) parts.push(cloud(rand() * SLIP_W, 120 + rand() * (SLIP_H - 200), 34 + rand() * 30, '#ffffff', 0.22 + rand() * 0.18));
    for (let k = 0; k < 26; k++) parts.push(sakura(rand() * SLIP_W, rand() * SLIP_H, 12 + rand() * 22, k % 3 ? '#ffffff' : '#ffd6e2', 0.5 + rand() * 0.4, rand() * 72));
    for (let k = 0; k < 30; k++) parts.push(sparkle(rand() * SLIP_W, rand() * SLIP_H, 4 + rand() * 9, '#ffe9a8', 0.55 + rand() * 0.4));
    // 金の二重枠と四隅の飾り
    parts.push(
      `<rect x="14" y="14" width="${SLIP_W - 28}" height="${SLIP_H - 28}" fill="none" stroke="${GOLD}" stroke-width="6"/>`,
      `<rect x="26" y="26" width="${SLIP_W - 52}" height="${SLIP_H - 52}" fill="none" stroke="${GOLD}" stroke-width="2"/>`,
      ...[
        [26, 26],
        [SLIP_W - 26, 26],
        [26, SLIP_H - 26],
        [SLIP_W - 26, SLIP_H - 26],
      ].map(([x, y]) => `${sakura(x!, y!, 20, GOLD, 1)}`),
    );
    return parts.join('');
  }
  const tone = inp.tone ?? 'normal';
  parts.push(`<rect width="${SLIP_W}" height="${SLIP_H}" fill="${shade(c, 0.82)}"/>`);
  // 和紙のすじ
  for (let k = 0; k < 60; k++) {
    const x = rand() * SLIP_W;
    const y = rand() * SLIP_H;
    parts.push(`<path d="M${x} ${y} q ${8 + rand() * 20} ${rand() * 6 - 3} ${16 + rand() * 30} ${rand() * 4 - 2}" stroke="${shade(c, 0.4)}" stroke-opacity="0.25" stroke-width="1" fill="none"/>`);
  }
  if (tone === 'bad') for (let k = 0; k < 9; k++) parts.push(cloud(rand() * SLIP_W, rand() * SLIP_H, 26 + rand() * 30, shade(c, 0.35), 0.3));
  else for (let k = 0; k < (tone === 'good' ? 22 : 14); k++) parts.push(sakura(rand() * SLIP_W, rand() * SLIP_H, 10 + rand() * 18, shade(c, 0.3), 0.28 + rand() * 0.2, rand() * 72));
  if (tone === 'good') for (let k = 0; k < 18; k++) parts.push(sparkle(rand() * SLIP_W, rand() * SLIP_H, 4 + rand() * 7, GOLD, 0.5));
  parts.push(`<rect x="12" y="12" width="${SLIP_W - 24}" height="${SLIP_H - 24}" fill="none" stroke="${c}" stroke-width="4"/>`);
  return parts.join('');
}

// ───────── 紙 ─────────

const P = { x: 50, y: 56, w: 500, h: 1090 };

export function slipSvg(inp: SlipInput): string {
  const c = inp.color;
  const accent = inp.special ? GOLD : c;
  const nameColor = inp.special ? c : c;
  // 台紙があるときは、紙・枠・線は台紙に描いてあるものとして、字（と朱印）だけ書く
  const deco = !inp.bg;
  const out: string[] = [background(inp)];
  // 紙
  if (deco)
    out.push(
      `<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="6" fill="${PAPER}" fill-opacity="0.97"/>`,
      `<rect x="${P.x + 10}" y="${P.y + 10}" width="${P.w - 20}" height="${P.h - 20}" fill="none" stroke="${accent}" stroke-width="3"/>`,
      `<rect x="${P.x + 16}" y="${P.y + 16}" width="${P.w - 32}" height="${P.h - 32}" fill="none" stroke="${accent}" stroke-width="1"/>`,
    );
  // 上: 〇〇　御神籤（運営吉は「特別御神籤」）
  const head = `${inp.shrine ? `${inp.shrine}　` : ''}${inp.special ? '特別御神籤' : '御神籤'}`;
  out.push(`<text x="${SLIP_W / 2}" y="${P.y + 62}" text-anchor="middle" font-family="${BOLD}" font-size="26" letter-spacing="5" fill="${accent}">${esc(head)}</text>`);
  if (deco) out.push(`<path d="M${P.x + 40} ${P.y + 82} H ${P.x + P.w - 40}" stroke="${accent}" stroke-width="1.5"/>`);

  // 運勢の名前（大きく・枠つき）
  const name = [...inp.name].slice(0, 8);
  const n = name.length;
  const top = P.y + 110;
  const size = n <= 2 ? 118 : n === 3 ? 100 : Math.max(52, Math.floor(400 / n));
  const bw = size + 44;
  const bh = Math.min(n * size * 1.0 + 40, 470);
  const bx = SLIP_W / 2 - bw / 2;
  if (deco) out.push(`<rect x="${bx}" y="${top}" width="${bw}" height="${bh}" fill="#ffffff" fill-opacity="0.85" stroke="${accent}" stroke-width="5"/>`);
  if (deco && inp.special) out.push(`<rect x="${bx + 7}" y="${top + 7}" width="${bw - 14}" height="${bh - 14}" fill="none" stroke="${GOLD}" stroke-width="1.5"/>`);
  out.push(vcol(name, SLIP_W / 2, top + 20, size, `font-family="${BOLD}" fill="${nameColor}"${inp.special ? ` stroke="${GOLD}" stroke-width="1.5"` : ''}`, 1.0));

  // 一言（右）: 入りきる大きさを探す
  const msgTop = top + 6;
  const msgBottom = P.y + 560;
  const right = P.x + P.w - 46;
  const leftLimit = bx + bw + 24;
  for (const s of [28, 26, 24, 22, 20, 18]) {
    const per = Math.floor((msgBottom - msgTop) / (s * 1.02));
    const cols = wrapColumns(inp.message, per);
    const pitch = s * 1.5;
    if (right - (cols.length - 1) * pitch - s / 2 >= leftLimit || s === 18) {
      cols.forEach((col, k) => out.push(vcol(col, right - k * pitch, msgTop, s, `font-family="${BODY}" fill="${INK}"`)));
      break;
    }
  }
  // 第〇番・日付（左）
  const leftX = P.x + 46;
  if (inp.number) out.push(vcol([...`第${kanjiNumber(inp.number)}番`], leftX + 44, msgTop, 24, `font-family="${BOLD}" fill="${accent}"`));
  out.push(vcol([...wareki(inp.date)], leftX, msgTop, 19, `font-family="${BODY}" fill="#6b5040"`));

  // 区切り
  const divY = P.y + 590;
  if (deco) out.push(`<path d="M${P.x + 30} ${divY} H ${P.x + P.w - 30}" stroke="${accent}" stroke-width="2.5"/><path d="M${P.x + 30} ${divY + 6} H ${P.x + P.w - 30}" stroke="${accent}" stroke-width="1"/>`);

  // 項目（右から左へ。見出しは太字・色。折り返しは見出しの下にそろえる）
  const itemTop = divY + 26;
  const itemBottom = P.y + P.h - 96;
  const width = P.w - 80;
  for (const s of [25, 23, 21, 19, 17]) {
    const per = Math.floor((itemBottom - itemTop) / (s * 1.02));
    const pitch = s * 1.55;
    const blocks = inp.items.map((it) => {
      const label = [...it.label].slice(0, 6);
      const indent = label.length + 1;
      return { label, cols: wrapColumns(it.text, per - indent), indent };
    });
    const total = blocks.reduce((t, b) => t + b.cols.length * pitch, 0) + Math.max(0, blocks.length - 1) * s * 0.6;
    if (total <= width || s === 17) {
      let x = P.x + P.w - 48;
      for (const b of blocks) {
        out.push(vcol(b.label, x, itemTop, s, `font-family="${BOLD}" fill="${accent === GOLD ? shade(c, -0.15) : c}"`));
        b.cols.forEach((col, k) => out.push(vcol(col, x - k * pitch, itemTop + b.indent * s * 1.02, s, `font-family="${BODY}" fill="${INK}"`)));
        x -= b.cols.length * pitch + s * 0.6;
      }
      break;
    }
  }

  // 下: ひとこと・印
  out.push(`<text x="${SLIP_W / 2 + 30}" y="${P.y + P.h - 40}" text-anchor="middle" font-family="${BODY}" font-size="17" letter-spacing="3" fill="#6b5040">― 吉凶は心がけ次第 ―</text>`);
  const seal = [...(inp.shrine || '御神籤')].slice(0, 4);
  const sx = P.x + 34;
  const sy = P.y + P.h - 104;
  const sealCols = seal.length <= 2 ? [seal] : [seal.slice(0, 2), seal.slice(2)];
  out.push(
    `<g transform="rotate(-6 ${sx + 34} ${sy + 34})"><rect x="${sx}" y="${sy}" width="68" height="68" rx="6" fill="${PAPER}" stroke="#c0392b" stroke-width="3.5"/>` +
      sealCols.map((col, k) => vcol(col, sealCols.length === 1 ? sx + 34 : sx + 48 - k * 28, sy + (col.length === 1 ? 20 : 8), seal.length <= 1 ? 30 : 25, `font-family="${BOLD}" fill="#c0392b"`, 1.0)).join('') +
      `</g>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIP_W}" height="${SLIP_H}" viewBox="0 0 ${SLIP_W} ${SLIP_H}">${out.join('')}</svg>`;
}

/** おみくじの紙を PNG に */
export function renderSlip(inp: SlipInput): Buffer {
  const r = new Resvg(slipSvg(inp), { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: BODY }, fitTo: { mode: 'width', value: SLIP_W } });
  return r.render().asPng();
}
