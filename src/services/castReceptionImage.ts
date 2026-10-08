import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import type { CastSession } from '../db/schema.js';
import type { CastReception } from './cast.js';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url));
const FONT_FILES = ['ShipporiMinchoB1-500.ttf', 'ShipporiMinchoB1-800.ttf'].map((f) => FONT_DIR + f);
const FAMILY = 'Shippori Mincho B1 Medium';
export const RECEPTION_W = 960;
export const RECEPTION_H = 1220;
const MAX_AVATAR = 256 * 1024;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const shorten = (s: string, max: number) => [...s.replace(/[\r\n\t]/g, ' ')].length > max ? [...s.replace(/[\r\n\t]/g, ' ')].slice(0, max - 1).join('') + '…' : s.replace(/[\r\n\t]/g, ' ');
const clock = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
const day = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '/');
const fmt = (n: number) => n.toLocaleString('ja-JP');
const plan = (s: CastSession) => (s.plan === 'night' ? '寝落ち' : s.plan === '60' ? '1時間' : '30分') + (s.extensions ? ' ＋' + s.extensions * 30 + '分' : '');
const STATUS: Record<CastSession['status'], string> = { reserved: '返事待ち', accepted: '予約確定', requested: '返事待ち', active: '通話中', done: '終了', declined: '受付終了', canceled: '取消', disputed: '運営確認中', refunded: '返金済み' };
const STATES = { waiting: ['待機中', '#8cc4a6'], busy: ['対応中', '#efd39a'], off: ['受付停止', '#d4c6d1'], pending: ['運営の確認待ち', '#d4c6d1'], paused: ['運営による休止', '#d4c6d1'] } as const;

/** Discord のアイコンだけ読みこむ。取れないときは、文字のアイコンで表示できる */
export async function loadReceptionAvatar(url: string): Promise<Buffer | undefined> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !['cdn.discordapp.com', 'media.discordapp.net'].includes(u.hostname)) return undefined;
    const res = await fetch(u, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_AVATAR || !res.body) return undefined;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_AVATAR) return undefined;
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return await sharp(Buffer.concat(chunks), { limitInputPixels: 1_048_576, animated: false }).resize(180, 180, { fit: 'cover' }).png().toBuffer();
  } catch { return undefined; }
}

export type ReceptionImageInput = {
  reception: CastReception;
  name: string;
  names: ReadonlyMap<string, string>;
  currency: string;
  avatar?: Uint8Array;
};

function text(x: number, y: number, value: string, size = 28, fill = '#4c3640', bold = false): string {
  return '<text x="' + x + '" y="' + y + '" font-family="' + (bold ? 'Shippori Mincho B1 ExtraBold' : FAMILY) + '" font-size="' + size + '" fill="' + fill + '">' + esc(value) + '</text>';
}
function box(x: number, y: number, w: number, h: number, fill: string, stroke = 'none', r = 24): string {
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + fill + '" stroke="' + stroke + '"/>';
}
function blossom(x: number, y: number, scale: number): string {
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')" fill="#e9b4bd" opacity=".32">' + [0, 72, 144, 216, 288].map((a) => '<ellipse cy="-17" rx="11" ry="18" transform="rotate(' + a + ')"/>').join('') + '<circle r="5" fill="#ebce8c"/></g>';
}

/** 本人の予約・売上をまとめた画像。文字はSVGとして実行されないように引用する */
export function receptionSvg(input: ReceptionImageInput): string {
  const { reception: d, name, names, currency, avatar } = input;
  const [state, stateColor] = STATES[d.state];
  const customer = (id: string) => shorten(names.get(id) ?? '利用者', 14);
  const current = d.current.slice(0, 2);
  const today = d.today.slice(0, 4);
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1220" viewBox="0 0 960 1220"><defs><linearGradient id="hero" x2="1" y2="1"><stop stop-color="#563244"/><stop offset="1" stop-color="#2d202d"/></linearGradient><clipPath id="avatar">' + box(74, 92, 132, 132, '#fff', 'none', 28) + '</clipPath></defs>';
  svg += box(0, 0, 960, 1220, '#faf4ec', 'none', 0);
  svg += blossom(925, 1120, 3) + blossom(44, 420, 2);
  svg += box(34, 30, 892, 230, 'url(#hero)');
  svg += blossom(840, 82, 2.4) + blossom(896, 219, 1.5);
  svg += text(74, 71, '咲楽ノ宮  ／  キャスト受付', 23, '#ebd6bd');
  svg += box(72, 90, 136, 136, '#87646d', '#e9ccb0', 30);
  svg += avatar ? '<image href="data:image/png;base64,' + Buffer.from(avatar).toString('base64') + '" x="74" y="92" width="132" height="132" clip-path="url(#avatar)"/>' : text(104, 181, shorten(name, 2), 44, '#fff0e2', true);
  svg += text(236, 132, shorten(name, 13), 40, '#fff5e8', true);
  svg += text(238, 174, shorten(d.cast.tags.join(' ・ ') || 'キャスト', 23), 23, '#ead4d6');
  svg += box(650, 196, 242, 42, stateColor, 'none', 21) + text(671, 225, state, 22, '#382b33', true);
  const waiting = d.cast.available === 'waiting' && d.cast.waitingUntil && d.cast.waitingUntil > d.now ? '待機設定  ' + clock(d.cast.waitingUntil) + ' まで' : 'あなた専用の受付画面';
  svg += text(238, 220, waiting, 22, '#ead4d6');

  svg += box(34, 282, 438, 142, '#fffdfa', '#e6d8c9') + box(488, 282, 438, 142, '#fffdfa', '#e6d8c9');
  svg += text(66, 322, '今月の受取額', 23, '#8a7279') + text(520, 322, '今月の指名回数', 23, '#8a7279');
  svg += text(66, 381, fmt(d.stat.earned), 48, '#733d52', true) + text(520, 381, fmt(d.stat.count) + ' 回', 48, '#733d52', true);
  svg += text(66, 407, '手数料を引いた受取額（' + shorten(currency, 6) + '）', 19, '#9a8385') + text(520, 407, '精算が済んだ指名', 19, '#9a8385');

  svg += box(34, 444, 892, 240, '#fffdfa', '#e6d8c9') + text(66, 487, '現在の指名', 29, '#543345', true);
  if (!current.length) {
    svg += text(66, 556, 'いま対応中の指名はありません', 30, '#9a8385');
    svg += text(66, 611, '下のボタンから待機を切り替えられます', 23, '#9a8385');
  } else {
    for (let i = 0; i < current.length; i++) {
      const s = current[i]!;
      const y = 535 + i * 84;
      const remaining = s.status === 'active' && s.endsAt ? '残り ' + Math.max(0, Math.ceil((s.endsAt.getTime() - d.now.getTime()) / 60_000)) + ' 分' : '返事待ち';
      svg += text(66, y, customer(s.customerId) + ' さん', 29, '#543345', true);
      svg += text(650, y, remaining, 26, '#9b5672', true);
      svg += text(66, y + 33, '#' + s.id + '  ' + plan(s) + ' ／ ' + fmt(s.price) + currency + (s.endsAt ? ' ／ ' + clock(s.endsAt) + 'まで' : ''), 22, '#8a7279');
    }
    if (d.current.length > 2) svg += text(650, 660, 'ほか ' + (d.current.length - 2) + ' 件', 19, '#8a7279');
  }

  svg += box(34, 704, 892, 342, '#fffdfa', '#e6d8c9') + text(66, 750, '今日の予約', 29, '#543345', true) + text(640, 750, day(d.now) + '  ／  ' + d.today.length + ' 件', 22, '#8a7279');
  if (!today.length) svg += text(66, 828, '今日の予約はありません', 30, '#9a8385');
  for (let i = 0; i < today.length; i++) {
    const s = today[i]!;
    const y = 803 + i * 59;
    svg += text(66, y, s.startAt ? clock(s.startAt) : '—', 28, '#733d52', true);
    svg += text(190, y, customer(s.customerId) + ' さん', 26, '#543345');
    svg += text(615, y, plan(s) + ' ・ ' + STATUS[s.status], 21, '#8a7279');
    if (i < today.length - 1) svg += '<path d="M66 ' + (y + 17) + 'H894" stroke="#eee3d8"/>';
  }
  if (d.today.length > 4) svg += text(66, 1030, 'ほか ' + (d.today.length - 4) + ' 件（下の「予約一覧」で確認できます）', 19, '#8a7279');
  svg += text(66, 1091, '料金  30分 ' + fmt(d.cast.price30) + ' ／ 1時間 ' + fmt(d.cast.price60) + (d.cast.priceNight ? ' ／ 寝落ち ' + fmt(d.cast.priceNight) : '') + ' ' + shorten(currency, 6), 24, '#733d52');
  svg += text(66, 1133, '18歳未満の雑談：' + (d.cast.minorOk ? '受ける' : '受けない') + '  ／  ブロック：' + (d.cast.blocked?.length ?? 0) + '人', 23, '#8a7279');
  svg += '<path d="M66 1157H894" stroke="#dccbb9"/>' + text(66, 1190, day(d.now) + ' ' + clock(d.now) + ' 更新  ／  日本時間', 19, '#9a8385') + text(705, 1190, '本人だけに表示', 19, '#9a8385');
  return svg + '</svg>';
}

export function renderCastReception(input: ReceptionImageInput): Buffer {
  return Buffer.from(new Resvg(receptionSvg(input), { font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FAMILY } }).render().asPng());
}
