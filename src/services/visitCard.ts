import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { visitBadgeImage } from './visitBadgeArt.js';
import { VISIT_BADGES, VISIT_ITEMS, visitStaffStyle, type VisitData } from './visitProfile.js';

const fonts = ['ShipporiMinchoB1-500.ttf', 'ShipporiMinchoB1-800.ttf'].map(f =>
  fileURLToPath(new URL('../../assets/fonts/' + f, import.meta.url)));
const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const text = (x: number, y: number, s: string, size = 22, color = '#fff8ed', end = false) =>
  '<text x="' + x + '" y="' + y + '" font-family="Shippori Mincho B1 Medium" font-size="' + size +
  '" fill="' + color + '" filter="url(#textShadow)"' + (end ? ' text-anchor="end"' : '') + '>' + esc(s) + '</text>';
const hours = (n: number) => Math.floor(n / 60) + '時間 ' + n % 60 + '分';
const ART_FILES: Record<string, string> = {
  'staff-blue-lantern': 'background-staff-blue-lantern.png', 'staff-blue-lantern-frame': 'frame-staff-blue-lantern.png',
  'staff-crimson': 'background-staff-crimson.png', 'staff-crimson-frame': 'frame-staff-crimson.png',
  paper: 'background-paper.jpg', sakura: 'background-sakura.jpg', moon: 'background-moon.jpg',
  snow: 'background-snow.jpg', goldnight: 'background-goldnight.jpg',
  petal: 'frame-petal.png', crescent: 'frame-crescent.png', gold: 'frame-gold.png', century: 'frame-century.png',
};
const embedded = new Map<string, string>();
/** ファイルは固定カタログだけ。画像の中に外部URLを残さず、オフラインで描画する。 */
function art(id: string, edge = false): string {
  const file = ART_FILES[id];
  if (!file) return '';
  let uri = embedded.get(file);
  if (!uri) {
    uri = 'data:image/' + (file.endsWith('.jpg') ? 'jpeg' : 'png') + ';base64,' +
      readFileSync(new URL('../../assets/visit/' + file, import.meta.url)).toString('base64');
    embedded.set(file, uri);
  }
  return '<image href="' + uri + '"' + (edge ? ' x="-4" y="-4" width="1088" height="648"' : ' width="1080" height="640"') + '/>';
}
/** 通常用・運営用とも同じ勲章を使う。透過余白を含めて80px。 */
function medal(id: string, x: number, y: number): string {
  const label = VISIT_BADGES.find(b => b.id === id)?.name;
  if (!label) return '';
  const image = visitBadgeImage(id);
  if (!image) return '';
  return '<g><title>' + esc(label) + '</title><image x="' + (x-40) + '" y="' + (y-40) +
    '" width="80" height="80" href="data:image/png;base64,' + image.toString('base64') + '"/></g>';
}

/** 背景が主役の共通レイアウト。背景と細い枠だけを独立して替える。 */
export function visitCardSvg(data: VisitData, options: {
  privateView?: boolean; staffStyle?: string; background?: string; frame?: string; avatar?: Uint8Array; preview?: boolean;
} = {}) {
  if (data.staffTheme) return staffCardSvg(data, options);
  const catalog=data.catalog ?? VISIT_ITEMS;
  const image=(id:string,edge=false)=>data.art?.[id] ? '<image href="data:image/png;base64,'+data.art[id]+'" width="1080" height="640"/>' : art(id,edge);
  const bg = catalog.find(i => i.kind === 'background' && i.id === (options.background ?? data.profile.background)) ?? VISIT_ITEMS[0];
  const frame = catalog.find(i => i.kind === 'frame' && i.id === (options.frame ?? data.profile.frame)) ?? VISIT_ITEMS[5];
  const visible = options.privateView || data.profile.publicStats;
  const name = [...data.member.displayName].slice(0,22).join('');
  const title = visible ? (data.profile.title === 'rank' ? data.rank.name : VISIT_BADGES.find(b => b.id === data.profile.title)?.name ?? '') : '';
  const accent = '#f6dfa0';
  const clearText=(...args:Parameters<typeof text>)=>text(...args).replace('Shippori Mincho B1 Medium','Shippori Mincho B1 ExtraBold');
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640"><defs>' +
    '<linearGradient id="veil"><stop stop-color="#05091c" stop-opacity=".86"/><stop offset=".55" stop-color="#0c1024" stop-opacity=".65"/><stop offset="1" stop-color="#090d20" stop-opacity=".04"/></linearGradient>' +
    '<linearGradient id="metal"><stop stop-color="#e9c878"/><stop offset=".5" stop-color="#fff5cc"/><stop offset="1" stop-color="#aa8448"/></linearGradient>' +
    '<filter id="textShadow" x="-.2" y="-.5" width="1.4" height="2"><feDropShadow dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="1"/></filter>' +
    '<clipPath id="avatar"><circle cx="123" cy="83" r="27"/></clipPath><clipPath id="card"><rect width="1080" height="640"/></clipPath></defs><g clip-path="url(#card)">' +
    image(bg.id) + '<rect width="1080" height="640" fill="url(#veil)"/>' +
    '<rect x="76" y="40" width="928" height="88" rx="16" fill="#05070e" fill-opacity=".64"/>' +
    '<rect x="94" y="143" width="496" height="371" rx="16" fill="#05070e" fill-opacity=".7"/>' +
    (visible ? '<rect x="622" y="143" width="382" height="261" rx="16" fill="#05070e" fill-opacity=".78"/>' : '') +
    '<circle cx="123" cy="83" r="29" fill="#1b2644" stroke="' + frame.colors[0] + '" stroke-width="2"/>';
  svg += options.avatar ? '<image href="data:image/png;base64,' + Buffer.from(options.avatar).toString('base64') +
    '" x="96" y="56" width="54" height="54" clip-path="url(#avatar)"/>' : text(111,93,[...name][0]??'桜',28);
  svg += clearText(167,75,'咲楽ノ宮 参拝帳',23,accent) + clearText(167,111,name,Math.min(30,Math.floor(440/Math.max(1,[...name].length))),'#ffffff');
  if(title) svg += clearText(975,108,title,22,accent,true);
  const lines = (y: number, rows: [string,string][]) => rows.map(([label,value],i) =>
    clearText(120,y+i*36,label,21,'#eee7d8') + clearText(328,y+i*36,value,24,'#ffffff')).join('');
  if (visible) {
    svg += clearText(120,184,'参拝ランク',26,accent) + lines(226,[
      ['現在のランク','Lv.' + data.rank.level + ' ' + data.rank.name],
      ['次のランク',data.rank.next?.name ?? '最高ランクに到達'],
      ['次までの通話',data.rank.next ? hours(Math.max(0,data.rank.next.minutes-data.minutes)) : '達成済み'],
    ]);
    svg += clearText(120,365,'通話の記録',26,accent) + lines(407,[
      ['累計通話',hours(data.minutes)],['今月の通話',hours(data.monthMinutes)],['参拝した日数',data.activeDays+'日'],
    ]);
    const selected = data.profile.badges.filter(id => data.badges.some(b => b.badgeId === id)).slice(0,5);
    svg += clearText(650,184,'参拝バッジ',26,accent) + clearText(650,216,'飾っているバッジ ' + selected.length + '個',19,'#ffffff');
    if (!selected.length) svg += clearText(650,263,'獲得したバッジをWebで選べます',19,'#ffffff');
    selected.forEach((id,i) => { svg += medal(id,691+i%3*93,i<3?270:350); });
  } else {
    svg += clearText(120,245,'活動記録は非公開です',27,'#ffffff') + clearText(120,287,'公開する内容は、本人がWebで選べます。',20,'#ffffff');
  }
  if (options.preview) svg += text(125,577,'着せ替えの見本 · 保存前のプレビュー',14,'#d8d0e3');
  if (frame.id !== 'plain') svg += image(frame.id,true);
  // 細縁と装飾枠のどちらも四辺へ接続し、外側へ余白を作らない。
  svg += '<rect x="0" y="0" width="1080" height="640" fill="none" stroke="url(#metal)" stroke-width="2"/>';
  return svg + '</g></svg>';
}

/** 運営ロールを入口で確認したカードだけ。文字とバッジを左側にまとめる。 */
function staffCardSvg(data: VisitData, options: {privateView?:boolean; staffStyle?:string; avatar?:Uint8Array; preview?:boolean}) {
  const staffText=(...args:Parameters<typeof text>)=>text(...args).replace('Shippori Mincho B1 Medium','Shippori Mincho B1 ExtraBold');
  const visible=options.privateView||data.profile.publicStats;
  const name=[...data.member.displayName].slice(0,22).join('');
  const nameSize=Math.min(48,Math.floor(440/Math.max(1,[...name].length)));
  const blue=visitStaffStyle(options.staffStyle??data.profile.staffStyle).id==='blue-lantern';
  const gold=blue?'#e0e5ff':'#f6dfa0';
  const avatarX=blue?145:107;
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640"><defs>'+
    '<linearGradient id="staffVeil"><stop stop-color="#080204" stop-opacity=".94"/><stop offset=".49" stop-color="#100306" stop-opacity=".83"/><stop offset=".68" stop-color="#100306" stop-opacity=".12"/><stop offset="1" stop-opacity="0"/></linearGradient>'+
    '<linearGradient id="metal"><stop stop-color="#e9c878"/><stop offset=".5" stop-color="#fff5cc"/><stop offset="1" stop-color="#aa8448"/></linearGradient>'+
    '<filter id="textShadow" x="-.2" y="-.5" width="1.4" height="2"><feDropShadow dy="1" stdDeviation="1.5" flood-color="#000"/></filter>'+
    '<clipPath id="avatar"><circle cx="'+avatarX+'" cy="82" r="22"/></clipPath></defs>'+art(blue?'staff-blue-lantern':'staff-crimson')+
    '<rect width="1080" height="640" fill="url(#staffVeil)"/>';
  if(options.avatar)svg+='<image href="data:image/png;base64,'+Buffer.from(options.avatar).toString('base64')+'" x="'+(avatarX-22)+'" y="60" width="44" height="44" clip-path="url(#avatar)"/>';
  svg+=staffText(options.avatar?avatarX+38:blue?145:85,91,'咲楽ノ宮 参拝帳',28,gold)+staffText(85,158,name,nameSize,'#ffffff')+staffText(85,194,'運営',19,gold);
  svg+='<path d="M85 212H510M85 466H510" stroke="'+gold+'" stroke-opacity=".65"/>';
  if(visible){
    svg+=staffText(85,253,'参拝の記録',25,gold);
    const rows:[string,string][]=[['参拝ランク','Lv.'+data.rank.level+' '+data.rank.name],['累計通話',hours(data.minutes)],['今月の通話',hours(data.monthMinutes)],['参拝した日数',data.activeDays+'日']];
    rows.forEach(([label,value],i)=>{svg+=staffText(85,297+i*43,label,20,gold)+staffText(270,297+i*43,value,24,'#ffffff');});
    svg+=staffText(85,502,'獲得バッジ',23,gold);
    const selected=data.profile.badges.filter(id=>data.badges.some(b=>b.badgeId===id)).slice(0,5);
    selected.forEach((id,i)=>{svg+=medal(id,113+i*82,546);});
    if(!selected.length)svg+=staffText(85,545,'獲得したバッジをWebで選べます',18,'#ffffff');
  }else svg+=staffText(85,284,'活動記録は非公開です',25,'#ffffff')+staffText(85,323,'公開する内容は、本人がWebで選べます。',17,'#ffffff');
  if(options.preview)svg+=staffText(85,590,'着せ替えの見本 · 保存前のプレビュー',14,gold);
  return svg+art(blue?'staff-blue-lantern-frame':'staff-crimson-frame')+'</svg>';
}

export function renderVisitCard(data: VisitData, options: Parameters<typeof visitCardSvg>[1] = {}): Buffer {
  return Buffer.from(new Resvg(visitCardSvg(data,options), {
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Shippori Mincho B1 Medium' },
  }).render().asPng());
}
