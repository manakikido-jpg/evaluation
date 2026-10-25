import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { champagneOf } from './castChampagne.js';

const W = 720, H = 420;
/** 高いボトルほどコマ数と余韻も増やす。 */
export function champagneMotion(id: string): { frames: number; frameMs: number; holdMs: number } {
  const b = champagneOf(id);
  if (!b) throw Error('unknown champagne');
  return { frames: 20+b.tier*4, frameMs: 120, holdMs: 1400+b.tier*200 };
}
const fonts = ['ShipporiMinchoB1-500.ttf', 'ShipporiMinchoB1-800.ttf']
  .map(f => fileURLToPath(new URL('../../assets/fonts/' + f, import.meta.url)));
const cache = new Map<string, Promise<Buffer>>();
const art = new Map<string, string>();
function bottleUrl(id: string): string {
  let url = art.get(id);
  if (!url) {
    // idはchampagneOfで確認した固定の5種類だけ。任意のパスは受け取らない。
    url = 'data:image/png;base64,' + readFileSync(new URL(`../../assets/champagne/${id}.png`, import.meta.url)).toString('base64');
    art.set(id, url);
  }
  return url;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const phase = (p: number, start: number, end: number) => clamp((p - start) / (end - start));
const ease = (n: number) => 1 - (1 - clamp(n)) ** 3;
const star = (x: number, y: number, r: number, color: string, opacity: number) =>
  `<path d="M${x} ${y-r} Q${x+1} ${y-1} ${x+r} ${y} Q${x+1} ${y+1} ${x} ${y+r} Q${x-1} ${y+1} ${x-r} ${y} Q${x-1} ${y-1} ${x} ${y-r}Z" fill="${color}" opacity="${opacity}"/>`;

function flute(x: number, y: number, angle: number, color: string): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">
    <path d="M-17-64Q-22-5 0 0Q22-5 17-64Z" fill="#f7e8ff" fill-opacity=".13" stroke="#fff1ce" stroke-width="1.5"/>
    <path d="M-15-42Q-16-5 0-3Q16-5 15-42Z" fill="${color}" opacity=".65"/>
    <path d="M0 0V39M-19 41Q0 35 19 41" fill="none" stroke="#fff1ce" stroke-width="2"/>
    <path d="M-10-55L-11-27" stroke="#fff" opacity=".8"/>
    ${[0,1,2,3].map(i=>`<circle cx="${i%2?5:-5}" cy="${-10-i*9}" r="1.4" fill="#fff8ce"/>`).join('')}
  </g>`;
}

/** POPと同じ5種の専用アニメ素材。王冠ごと開栓し、モチーフ・泡・光・乾杯を重ねる。 */
export function champagneSvg(id: string, progress = 0): string {
  const b = champagneOf(id);
  if (!b) throw Error('unknown champagne');
  const p = Number.isFinite(progress) ? clamp(progress) : 0;
  const opening = ease(phase(p,.17,.46)), toast = ease(phase(p,.47,.76)), finale = ease(phase(p,.66,.88));
  const gold = '#edce85', image = bottleUrl(b.id);
  const capHeight = [24,29,43,49,49][b.tier-1]!;
  const mouthX = 255, mouthY = 78+capHeight;
  const rays = Array.from({length:14+b.tier*2},(_,i) =>
    `<path d="M255 230L${255+Math.cos(i*.7)*340} ${230+Math.sin(i*.7)*270}L${255+Math.cos(i*.7+.025)*340} ${230+Math.sin(i*.7+.025)*270}Z" fill="${b.color}" opacity=".045"/>`).join('');
  const lights = Array.from({length:16+b.tier*4},(_,i) => star(40+i*103%640,100+i*59%245,i%4===0?5:2,gold,.15+.4*(1+Math.sin(p*Math.PI*2+i))/2)).join('');
  const fountain = Array.from({length:7+b.tier},(_,i) => {
    const t = phase(p,.2,.55), fade = 1-phase(p,.55,.8);
    const x = mouthX+(i-(6+b.tier)/2)*18*t, y = mouthY-50*t+(i%3)*5;
    return `<path d="M${mouthX} ${mouthY}Q${mouthX+(i-5)*7} ${mouthY-34*t} ${x} ${y}" stroke="url(#foam)" stroke-width="${1+i%3*.5}" stroke-linecap="round" fill="none" opacity="${t*fade*.8}"/>`;
  }).join('');
  const spray = Array.from({length:30+b.tier*12},(_,i) => {
    const t = phase(p,.2+i%4*.008,.82+i%3*.02);
    if (!t) return '';
    const angle = -Math.PI+.22+(i*2.399963%(Math.PI-.44)), speed = 80+i%9*12;
    const x = mouthX+Math.cos(angle)*speed*t, y = mouthY+Math.sin(angle)*speed*t+t*t*170;
    return `<circle cx="${x}" cy="${y}" r="${1+i%4*.5}" fill="${i%3?gold:'#fff'}" opacity="${(1-phase(p,.74,.98))*.7}"/>`;
  }).join('');
  const confetti = Array.from({length:14+b.tier*8},(_,i) => {
    const t = phase(p,.32+i%5*.012,1);
    if (!t) return '';
    const x = 50+i*113%620+Math.sin(i+t*3)*16, y = 110+t*(190+i%7*10)-i%4*18;
    let motif: string;
    if (b.id==='moon' && i%3===0) motif=`<path d="M0-5A5 5 0 1 0 5 3A5 5 0 0 1 0-5" fill="${gold}"/>`;
    else if (b.id==='silver' && i%3===0) motif=`<path d="M0-6L4 0L0 6L-4 0Z" fill="#d5faff" stroke="#fff"/>`;
    else if (b.id==='rose' && i%3===0) motif=`<path d="M0 5C-11-1-3-9 0-4C3-9 11-1 0 5Z" fill="${b.color}"/>`;
    else if (i%3===0) motif=`<path d="M0-5Q8-4 5 2Q1 7-3 2Q-6-3 0-5Z" fill="${b.color}"/>`;
    else motif=`<rect x="-1.5" y="-4" width="3" height="8" rx=".5" fill="${i%2?gold:b.color}"/>`;
    return `<g transform="translate(${x} ${y}) rotate(${i*37+t*145})" opacity="${Math.min(1,t*4)*.8}">${motif}</g>`;
  }).join('');
  const crest = b.id==='moon' ? `<path d="M592 105A40 40 0 1 0 628 160A40 40 0 0 1 592 105" fill="${gold}" opacity=".12"/>`
    : b.id==='silver' ? `<path d="M604 104L638 145L604 188L570 145Z" fill="${b.color}" opacity=".1"/>`
    : `<path d="M591 111Q642 97 633 140Q656 171 614 177Q584 209 570 168Q535 150 570 131Q564 100 591 111Z" fill="${b.color}" opacity=".08"/>`;
  const jewels = b.tier >= 3 ? Array.from({length:b.tier*3},(_,i) => {
    const angle=i*Math.PI*2/(b.tier*3), reveal=ease(phase(p,.38,.7));
    const x=255+Math.cos(angle)*115, y=218+Math.sin(angle)*135;
    return `<path d="M${x} ${y-4}L${x+3} ${y}L${x} ${y+4}L${x-3} ${y}Z" fill="${b.color}" stroke="${gold}" stroke-width=".5" opacity="${reveal*.65}"/>`;
  }).join('') : '';
  const fireworks = b.tier === 5 ? [0,1].map(k => {
    const t=phase(p,.48+k*.12,.85+k*.12), radius=15+t*34;
    if (!t) return '';
    return Array.from({length:16},(_,i) => {
      const angle=i*Math.PI/8, x=430+k*195, y=130+k*38;
      return `<path d="M${x+Math.cos(angle)*radius*.65} ${y+Math.sin(angle)*radius*.65}L${x+Math.cos(angle)*radius} ${y+Math.sin(angle)*radius}" stroke="${i%2?gold:b.color}" stroke-width="1.2" opacity="${Math.sin(t*Math.PI)*.8}"/>`;
    }).join('');
  }).join('') : '';
  const tower = b.tier === 5 ? `<g opacity="${ease(phase(p,.5,.8))}">
    <path d="M572 305H672" stroke="${gold}" opacity=".5"/>
    ${[0,1,2].flatMap(row=>Array.from({length:row+1},(_,i)=>
      `<g transform="translate(${622+(i-row/2)*23} ${230+row*27}) scale(.34)">${flute(0,0,0,gold)}</g>`)).join('')}
  </g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="bg"><stop stop-color="#3b1a45"/><stop offset=".6" stop-color="#151125"/><stop offset="1" stop-color="#080b17"/></radialGradient>
      <radialGradient id="halo"><stop stop-color="${b.color}" stop-opacity=".3"/><stop offset="1" stop-color="${b.color}" stop-opacity="0"/></radialGradient>
      <linearGradient id="gold"><stop stop-color="#b98637"/><stop offset=".35" stop-color="#fff1c2"/><stop offset=".65" stop-color="#cb9a43"/><stop offset="1" stop-color="#ffe7a1"/></linearGradient>
      <linearGradient id="curtain"><stop stop-color="#350921"/><stop offset=".4" stop-color="#891e55"/><stop offset=".7" stop-color="#4a0b30"/><stop offset="1" stop-color="#180c20"/></linearGradient>
      <linearGradient id="foam" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#fff6d3"/><stop offset="1" stop-color="#fff6d3" stop-opacity="0"/></linearGradient>
      <clipPath id="body"><rect x="145" y="${mouthY}" width="220" height="${280-capHeight}"/></clipPath>
      <clipPath id="cap"><rect x="145" y="78" width="220" height="${capHeight}"/></clipPath>
    </defs>
    <rect width="720" height="420" rx="20" fill="url(#bg)"/>
    <path d="M0 0H110Q90 130 0 190Z M720 0H610Q630 130 720 190Z" fill="url(#curtain)"/>
    <path d="M10 0Q26 95 3 160M35 0Q46 85 20 146M710 0Q694 95 717 160M685 0Q674 85 700 146" stroke="${gold}" stroke-opacity=".3" fill="none"/>
    ${rays}<ellipse cx="255" cy="220" rx="210" ry="170" fill="url(#halo)"/>${crest}${lights}${jewels}${fireworks}
    <path d="M28 358Q360 310 692 358V400H28Z" fill="#291c30" stroke="${gold}" stroke-opacity=".2"/>
    <ellipse cx="255" cy="359" rx="112" ry="12" fill="#100d18" stroke="url(#gold)" stroke-width="2"/>
    <ellipse cx="255" cy="356" rx="99" ry="6" fill="${b.color}" opacity=".14"/>
    <image x="145" y="78" width="220" height="280" xlink:href="${image}" clip-path="url(#body)"/>
    <ellipse cx="${mouthX}" cy="${mouthY+1}" rx="9" ry="2" fill="#302132" opacity="${opening}"/>
    <g transform="translate(${opening*65} ${-opening*56}) rotate(${opening*82} ${mouthX} ${mouthY-12})" opacity="${1-phase(p,.48,.64)}">
      <image x="145" y="78" width="220" height="280" xlink:href="${image}" clip-path="url(#cap)"/>
    </g>
    ${fountain}${spray}${confetti}
    <rect x="15" y="15" width="690" height="390" rx="13" fill="none" stroke="url(#gold)" stroke-width="1.5"/>
    <path d="M23 49V23H49M671 23H697V49M23 371V397H49M671 397H697V371" fill="none" stroke="${gold}"/>
    <text x="360" y="35" text-anchor="middle" fill="${gold}" font-size="10" letter-spacing="5">SAKURANOMIYA · CHAMPAGNE</text>
    <text x="360" y="68" text-anchor="middle" fill="${b.color}" font-family="Shippori Mincho B1" font-size="30">${b.name}</text>
    <g opacity="${1-toast}"><text x="510" y="165" text-anchor="middle" fill="${gold}" font-size="10" letter-spacing="3">SPECIAL MOMENT</text>
      <text x="510" y="200" text-anchor="middle" fill="#fff3dc" font-family="Shippori Mincho B1" font-size="23">${p<.2?'想いを込めて':'華やかに、開栓'}</text></g>
    ${tower}<g opacity="${toast}">${flute(466+toast*14,215,toast*16,b.color)}${flute(553-toast*15,215,-toast*16,gold)}${star(509,155,8,gold,finale)}</g>
    <text x="510" y="290" text-anchor="middle" fill="${b.color}" font-size="23">${b.price.toLocaleString('ja-JP')}</text>
    <text x="510" y="309" text-anchor="middle" fill="#cbbbaf" font-size="9" letter-spacing="3">BASE POINTS / BOTTLE</text>
    <text x="510" y="347" text-anchor="middle" fill="url(#gold)" font-family="Shippori Mincho B1" font-size="33" opacity="${finale}">乾杯！</text>
    <path d="M158 375H322M398 375H562" stroke="url(#gold)" opacity=".6"/>${star(360,375,5,b.color,.9)}
    <text x="360" y="397" text-anchor="middle" fill="#f2e1d0" font-family="Shippori Mincho B1" font-size="15">キャストとの時間に、ありがとうを。</text>
  </svg>`;
}

export function champagnePreview(id: string): Buffer {
  return Buffer.from(new Resvg(champagneSvg(id), { font: { fontFiles: fonts, loadSystemFonts: false } }).render().asPng());
}

export async function champagneAnimation(id: string): Promise<Buffer> {
  let result = cache.get(id);
  if (!result) {
    result = (async () => {
      const motion = champagneMotion(id);
      const frames: Buffer[] = [];
      for (let frame = 0; frame < motion.frames; frame++) {
        const png = new Resvg(champagneSvg(id, frame/(motion.frames-1)),
          { font: { fontFiles: fonts, loadSystemFonts: false } }).render().asPng();
        frames.push(await sharp(png).ensureAlpha().raw().toBuffer());
      }
      return sharp(Buffer.concat(frames), { raw: { width: W, height: H*motion.frames, channels: 4, pageHeight: H } })
        .gif({ loop: 1, delay: Array.from({length:motion.frames},(_,i)=>i===motion.frames-1?motion.holdMs:motion.frameMs), colours:128, dither:0, effort:3 }).toBuffer();
    })();
    cache.set(id,result);
    result.catch(()=>cache.delete(id));
  }
  return result;
}
