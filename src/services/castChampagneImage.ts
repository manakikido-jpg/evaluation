import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { champagneOf } from './castChampagne.js';
const W=720,H=420;
const fonts=['ShipporiMinchoB1-500.ttf','ShipporiMinchoB1-800.ttf'].map(f=>fileURLToPath(new URL('../../assets/fonts/'+f,import.meta.url)));
const cache=new Map<string,Promise<Buffer>>();
/** ボトルと開栓の飛沫はSVGで描く。外部画像・外部URLは読み込まない。 */
export function champagneSvg(id:string,progress=0) {
 const b=champagneOf(id);if(!b)throw Error('unknown champagne');
 const particles=Array.from({length:b.tier*7},(_,i)=>{const angle=i*2.39996,spread=25+progress*(50+i%5*22),x=360+Math.cos(angle)*spread,y=148+Math.sin(angle)*spread-progress*36;return `<circle cx="${x}" cy="${y}" r="${i%3+1.5}" fill="${b.color}" opacity="${progress?0.75:0}"/>`;}).join('');
 const stars=Array.from({length:b.tier*3},(_,i)=>{const x=42+(i*103)%640,y=45+(i*59)%285;return `<path d="M${x-5} ${y}h10M${x} ${y-5}v10" stroke="${b.color}" opacity="${.15+progress*.5}"/>`;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><radialGradient id="bg"><stop stop-color="#283442"/><stop offset="1" stop-color="#101420"/></radialGradient><linearGradient id="glass"><stop stop-color="#183f38"/><stop offset=".4" stop-color="#46725a"/><stop offset="1" stop-color="#142b29"/></linearGradient></defs><rect width="720" height="420" rx="24" fill="url(#bg)"/><rect x="18" y="18" width="684" height="384" rx="16" fill="none" stroke="${b.color}" opacity=".65"/>${stars}<text x="360" y="55" text-anchor="middle" fill="${b.color}" font-size="14" letter-spacing="5">SAKURANOMIYA</text><text x="360" y="99" text-anchor="middle" fill="#fff" font-family="Shippori Mincho B1 Medium" font-size="30">${b.name}</text>${particles}<g transform="rotate(-8 360 225)"><path d="M345 149h30v41c0 15 26 27 26 48v72q0 12-12 12h-58q-12 0-12-12v-72c0-21 26-33 26-48z" fill="url(#glass)" stroke="${b.color}" stroke-width="2"/><rect x="343" y="148" width="34" height="33" rx="3" fill="${b.color}"/><path d="M345 ${140-progress*45}h30v10h-30z" fill="#c3a77a"/><path d="M329 228h62v55h-62z" fill="${b.color}"/><text x="360" y="262" text-anchor="middle" fill="#283342" font-size="18" font-family="serif">${['I','II','III','IV','V'][b.tier-1]}</text><path d="M331 292h56" stroke="${b.color}"/><path d="M329 212v-3" stroke="#fff" stroke-width="4" opacity=".6"/></g><text x="520" y="222" text-anchor="middle" fill="${b.color}" font-family="Shippori Mincho B1 Medium" font-size="28">${progress>.3?'乾杯！':'乾杯を贈ろう'}</text><text x="520" y="257" text-anchor="middle" fill="#fff" font-size="22">${b.price.toLocaleString('ja-JP')}</text><text x="520" y="282" text-anchor="middle" fill="#b6c0ce" font-size="12" letter-spacing="2">POINTS / BOTTLE</text><text x="360" y="366" text-anchor="middle" fill="#e7dfd2" font-size="17" font-family="Shippori Mincho B1 Medium">キャストとの時間に、ありがとうを。</text></svg>`;
}
export function champagnePreview(id:string):Buffer {
 return Buffer.from(new Resvg(champagneSvg(id),{font:{fontFiles:fonts,loadSystemFonts:false}}).render().asPng());
}
export async function champagneAnimation(id:string):Promise<Buffer> {
 let result=cache.get(id);
 if(!result){result=(async()=>{
  const frames:Buffer[]=[];
  for(let frame=0;frame<8;frame++){
   const png=new Resvg(champagneSvg(id,frame/7),{font:{fontFiles:fonts,loadSystemFonts:false}}).render().asPng();
   frames.push(await sharp(png).ensureAlpha().raw().toBuffer());
  }
  return sharp(Buffer.concat(frames),{raw:{width:W,height:H*8,channels:4,pageHeight:H}}).gif({loop:1,delay:[180,100,100,100,120,150,180,1600],colours:96}).toBuffer();
 })();cache.set(id,result);result.catch(()=>cache.delete(id));}
 return result;
}
