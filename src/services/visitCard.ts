import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { VISIT_BADGES, VISIT_ITEMS, type VisitData } from './visitProfile.js';

const fonts = ['ShipporiMinchoB1-500.ttf', 'ShipporiMinchoB1-800.ttf'].map(f =>
  fileURLToPath(new URL('../../assets/fonts/' + f, import.meta.url)));
const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const text = (x: number, y: number, s: string, size = 22, color = '#fff8ed', end = false) =>
  '<text x="' + x + '" y="' + y + '" font-family="Shippori Mincho B1 Medium" font-size="' + size +
  '" fill="' + color + '" filter="url(#textShadow)"' + (end ? ' text-anchor="end"' : '') + '>' + esc(s) + '</text>';
const hours = (n: number) => Math.floor(n / 60) + '時間 ' + n % 60 + '分';
const ART_FILES: Record<string, string> = {
  paper: 'background-paper.jpg', sakura: 'background-sakura.jpg', moon: 'background-moon.jpg',
  snow: 'background-snow.jpg', goldnight: 'background-goldnight.jpg',
  petal: 'frame-petal.png', crescent: 'frame-crescent.png', gold: 'frame-gold.png', century: 'frame-century.png',
};
const embedded = new Map<string, string>();
/** ファイルは固定カタログだけ。画像の中に外部URLを残さず、オフラインで描画する。 */
function art(id: string): string {
  const file = ART_FILES[id];
  if (!file) return '';
  let uri = embedded.get(file);
  if (!uri) {
    uri = 'data:image/' + (file.endsWith('.jpg') ? 'jpeg' : 'png') + ';base64,' +
      readFileSync(new URL('../../assets/visit/' + file, import.meta.url)).toString('base64');
    embedded.set(file, uri);
  }
  return '<image href="' + uri + '" width="1080" height="640"/>';
}
const stars = (x: number, y: number, size: number, color: string) =>
  '<path d="M' + x + ' ' + (y-size) + 'L' + (x+size*.24) + ' ' + (y-size*.24) + 'L' +
  (x+size) + ' ' + y + 'L' + (x+size*.24) + ' ' + (y+size*.24) + 'L' + x + ' ' +
  (y+size) + 'L' + (x-size*.24) + ' ' + (y+size*.24) + 'L' + (x-size) + ' ' + y +
  'L' + (x-size*.24) + ' ' + (y-size*.24) + 'Z" fill="' + color + '"/>';
const BADGE_ART: Record<string, { color: string; symbol: string }> = {
  first: { color: '#f4a8cc', symbol: '<path d="M-16-9H16M-13-5H13M-10-5V17M10-5V17M-13 4H13"/>' },
  vc1: { color: '#73dce5', symbol: '<path d="M5-17A18 18 0 1 0 16 8A15 15 0 0 1 5-17Z"/>' },
  vc10: { color: '#92b7ff', symbol: '<path d="M0-19L5-6L19-6L8 3L12 17L0 9L-12 17L-8 3L-19-6L-5-6Z"/>' },
  vc100: { color: '#d7a5ff', symbol: '<path d="M-19-7L-11 14H11L19-7L8 1L0-15L-8 1ZM-10 20H10"/>' },
  vc500: { color: '#ffe07c', symbol: '<path d="M0-20L16 0L0 20L-16 0ZM-16 0H16M0-20L-7 0L0 20L7 0Z"/>' },
  days7: { color: '#92e2bf', symbol: '<path d="M-15-12Q0-24 15-12V6Q9 19 0 23Q-9 19-15 6ZM-7 0L-1 7L10-7"/>' },
  days30: { color: '#ffc29c', symbol: '<path d="M-17 14L-19-8L-7 0L0-18L7 0L19-8L17 14ZM-17 20H17"/>' },
  anniversary: { color: '#fff0b0', symbol: '<path d="M-18-10H18V-2H-18ZM-15-2V18H15V-2M0-10V18M0-10Q-17-26-15-13Q-10-7 0-10Q17-26 15-13Q10-7 0-10"/>' },
};
function medal(id: string, x: number, y: number): string {
  const badge = BADGE_ART[id];
  if (!badge) return '';
  const leaf = '<path d="M-25 25Q-45 2-23-29M25 25Q45 2 23-29" fill="none" stroke="#dfc480" stroke-width="2"/>' +
    [-1,1].map(sign => [0,1,2,3].map(i => '<ellipse cx="' + sign*(29+Math.sin(i)*3) + '" cy="' +
      (18-i*11) + '" rx="4" ry="7" transform="rotate(' + sign*35 + ' ' + sign*30 + ' ' + (18-i*11) +
      ')" fill="url(#metal)"/>').join('')).join('');
  return '<g transform="translate(' + x + ' ' + y + ')">' +
    '<path d="M-24 22L-29 54L-14 46L-5 55L2 24M24 22L29 54L14 46L5 55L-2 24" fill="' +
    badge.color + '" stroke="#ead6a1" stroke-width="1"/>' + leaf +
    '<circle r="37" fill="url(#metal)" stroke="#fff1c0" stroke-width="1.5"/>' +
    '<circle r="31" fill="#11172c" stroke="#aa7d38" stroke-width="2"/>' +
    '<circle r="27" fill="' + badge.color + '" opacity=".24"/>' +
    '<circle cy="-8" r="25" fill="url(#medalShine)" opacity=".7"/>' +
    '<g fill="none" stroke="' + badge.color + '" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">' +
    badge.symbol + '</g>' + [-135,-90,-45,0,45,90,135,180].map(a => {
      const r=a*Math.PI/180;return '<circle cx="' + Math.cos(r)*34 + '" cy="' + Math.sin(r)*34 +
        '" r="1.6" fill="#fff3c3"/>';
    }).join('') + stars(26,-27,5,'#fff3d0') + '</g>';
}

export function visitCardSvg(data: VisitData, options: {
  privateView?: boolean; background?: string; frame?: string; avatar?: Uint8Array; preview?: boolean;
} = {}) {
  const bg = VISIT_ITEMS.find(i => i.kind === 'background' && i.id === (options.background ?? data.profile.background)) ?? VISIT_ITEMS[0];
  const frame = VISIT_ITEMS.find(i => i.kind === 'frame' && i.id === (options.frame ?? data.profile.frame)) ?? VISIT_ITEMS[5];
  const visible = options.privateView || data.profile.publicStats;
  const name = [...data.member.displayName].slice(0, 18).join('');
  const title = visible ? (data.profile.title === 'rank' ? data.rank.name : VISIT_BADGES.find(b => b.id === data.profile.title)?.name ?? '') : '';
  const progress = data.rank.next ? Math.max(0,Math.min(1,(data.minutes-data.rank.minutes)/(data.rank.next.minutes-data.rank.minutes))) : 1;
  const accent = frame.colors[0];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640"><defs>' +
    '<linearGradient id="veil"><stop stop-color="#05091a" stop-opacity=".86"/><stop offset=".56" stop-color="#080d24" stop-opacity=".62"/><stop offset="1" stop-color="#080c20" stop-opacity=".12"/></linearGradient>' +
    '<linearGradient id="metal" x2=".8" y2="1"><stop stop-color="#8e5823"/><stop offset=".22" stop-color="#fff5c8"/><stop offset=".5" stop-color="#b78a43"/><stop offset=".75" stop-color="#f5d994"/><stop offset="1" stop-color="#825421"/></linearGradient>' +
    '<linearGradient id="accent"><stop stop-color="' + accent + '"/><stop offset="1" stop-color="#fff1c7"/></linearGradient>' +
    '<radialGradient id="medalShine" cy="0"><stop stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
    '<filter id="textShadow" x="-.2" y="-.5" width="1.4" height="2"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity=".95"/></filter>' +
    '<clipPath id="avatar"><circle cx="234" cy="150" r="33"/></clipPath><clipPath id="card"><rect width="1080" height="640" rx="20"/></clipPath></defs><g clip-path="url(#card)">' +
    art(bg.id) + '<rect x="42" y="67" width="996" height="504" rx="28" fill="url(#veil)"/>' +
    '<path d="M160 210H969M160 490H550" stroke="' + accent + '" stroke-opacity=".45"/>' +
    '<circle cx="234" cy="150" r="39" fill="#10182b" stroke="url(#metal)" stroke-width="4"/>';
  svg += options.avatar ? '<image href="data:image/png;base64,' + Buffer.from(options.avatar).toString('base64') +
    '" x="201" y="117" width="66" height="66" clip-path="url(#avatar)"/>' : text(216,163,[...name][0]??'桜',34);
  svg += text(285,118,'咲楽ノ宮  /  参拝プロフィール',17,accent) + text(283,157,name,name.length>14?26:31) +
    text(286,186,title,17,'#eee2cb');
  svg += text(912,152,'SAKURA',17,accent,true) + text(912,178,options.preview ? '試着中' : 'YOUR STORY',12,'#ddd6d7',true);
  if (visible) {
    svg += text(160,243,'参拝ランク',17,accent) + text(160,286,'Lv.' + data.rank.level + '  ' + data.rank.name,34);
    svg += text(160,316,data.rank.next ? '次の「' + data.rank.next.name + '」まで ' + hours(data.rank.next.minutes-data.minutes) : '最高ランクに到達しました',16);
    svg += '<rect x="160" y="334" width="381" height="6" rx="3" fill="#fff" opacity=".2"/><rect x="160" y="334" width="' +
      Math.round(381*progress) + '" height="6" rx="3" fill="url(#accent)"/>';
    svg += text(160,384,'累計通話',18,'#d8cfe0') + text(541,384,hours(data.minutes),23,'#fff8ed',true) +
      text(160,428,'今月の通話',18,'#d8cfe0') + text(541,428,hours(data.monthMinutes),23,'#fff8ed',true) +
      text(160,472,'参拝日数',18,'#d8cfe0') + text(541,472,data.activeDays + '日',23,'#fff8ed',true);
    svg += '<path d="M591 235V488" stroke="' + accent + '" stroke-opacity=".3"/>';
    svg += text(640,243,'ご縁のしるし',18,accent) + text(969,243,data.badges.length + ' / ' + VISIT_BADGES.length,16,'#eee2cb',true);
    const selected = data.profile.badges.filter(id => data.badges.some(b => b.badgeId === id)).slice(0,5);
    if (!selected.length) svg += text(652,326,'バッジを選んで飾れます',18) + text(652,358,'語らいの足あとを、この一枚に。',15,'#d1c4d6');
    selected.forEach((id,i) => {
      const b = VISIT_BADGES.find(b => b.id === id);
      if (!b) return;
      const x = 685 + i%3*120, y = i<3 ? 302 : 427;
      svg += medal(id,x,y);
      const chars = [...b.name];
      svg += text(x,y+69,chars.slice(0,7).join(''),13,'#fff6df',true).replace('text-anchor="end"','text-anchor="middle"');
      if (chars.length>7) svg += text(x,y+86,chars.slice(7).join(''),13,'#fff6df',true).replace('text-anchor="end"','text-anchor="middle"');
    });
  } else {
    svg += text(160,309,'活動記録は非公開です',31) + text(160,350,'背景とフレームで、自分らしい一枚に。',19,'#eee2cb');
  }
  svg += text(160,513,options.preview ? '着せ替えの見本 · 保存前のプレビュー' : '一つひとつの語らいが、ご縁になる。',13,'#f6e2b9');
  // 最前面は独立した透過フレーム。背景を替えてもこの装飾は保つ。
  svg += frame.id === 'plain' ? '<rect x="18" y="18" width="1044" height="604" rx="18" fill="none" stroke="url(#metal)" stroke-width="3"/>' : art(frame.id);
  return svg + '</g></svg>';
}
export function renderVisitCard(data: VisitData, options: Parameters<typeof visitCardSvg>[1] = {}): Buffer {
  return Buffer.from(new Resvg(visitCardSvg(data,options), {
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Shippori Mincho B1 Medium' },
  }).render().asPng());
}
