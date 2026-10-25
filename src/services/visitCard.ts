import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { VISIT_BADGES, VISIT_ITEMS, type VisitData } from './visitProfile.js';

const fonts=['ShipporiMinchoB1-500.ttf','ShipporiMinchoB1-800.ttf'].map(f=>fileURLToPath(new URL('../../assets/fonts/'+f,import.meta.url)));
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const text=(x:number,y:number,s:string,size=24,color='#f9f1df')=>'<text x="'+x+'" y="'+y+'" font-family="Shippori Mincho B1 Medium" font-size="'+size+'" fill="'+color+'">'+esc(s)+'</text>';
const hours=(n:number)=>Math.floor(n/60)+'時間 '+n%60+'分';
const flower=(x:number,y:number,r:number,color:string)=>'<g transform="translate('+x+' '+y+')" fill="'+color+'">'+[0,72,144,216,288].map(a=>'<ellipse cy="-'+r*.55+'" rx="'+r*.32+'" ry="'+r*.58+'" transform="rotate('+a+')"/>').join('')+'<circle r="'+r*.15+'" fill="#efdaa0"/></g>';
export function visitCardSvg(data:VisitData,options:{privateView?:boolean;background?:string;frame?:string;avatar?:Uint8Array;preview?:boolean}={}){
 const bg=VISIT_ITEMS.find(i=>i.kind==='background'&&i.id===(options.background??data.profile.background))??VISIT_ITEMS[0];
 const frame=VISIT_ITEMS.find(i=>i.kind==='frame'&&i.id===(options.frame??data.profile.frame))??VISIT_ITEMS[5];
 const visible=options.privateView||data.profile.publicStats;
 const name=[...data.member.displayName].slice(0,22).join('');
 const title=visible?(data.profile.title==='rank'?data.rank.name:VISIT_BADGES.find(b=>b.id===data.profile.title)?.name??''):'';
 const progress=data.rank.next?Math.min(1,(data.minutes-data.rank.minutes)/(data.rank.next.minutes-data.rank.minutes)):1;
 let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="640" viewBox="0 0 1080 640"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="'+bg.colors[0]+'"/><stop offset="1" stop-color="'+bg.colors[1]+'"/></linearGradient><linearGradient id="line"><stop stop-color="'+frame.colors[0]+'"/><stop offset=".5" stop-color="#fff1c9"/><stop offset="1" stop-color="'+frame.colors[1]+'"/></linearGradient><clipPath id="avatar"><circle cx="112" cy="116" r="45"/></clipPath></defs><rect width="1080" height="640" rx="28" fill="url(#bg)"/>';
 // 自作の花・月・山並み。外部URLやスクリプトは画像へ埋めこまない。
 if(bg.id==='moon'||bg.id==='goldnight')svg+='<circle cx="925" cy="113" r="63" fill="#fae5a3" opacity=".8"/><circle cx="945" cy="94" r="58" fill="'+bg.colors[0]+'"/>';
 svg+='<path d="M0 535Q150 345 355 515T760 490T1080 420V640H0Z" fill="'+bg.colors[0]+'" opacity=".55"/>';
 for(let i=0;i<24;i++){const x=(i*173+42)%1080,y=(i*89+23)%640;svg+=flower(x,y,8+i%4*4,bg.id==='snow'?'#fff':frame.colors[0]);}
 svg+='<rect x="20" y="20" width="1040" height="600" rx="20" fill="none" stroke="url(#line)" stroke-width="'+(frame.id==='plain'?2:5)+'"/><rect x="31" y="31" width="1018" height="578" rx="16" fill="#111523" fill-opacity=".78" stroke="'+frame.colors[1]+'" stroke-opacity=".5"/>';
 if(frame.id!=='plain')for(const [x,y]of[[43,43],[1037,43],[43,597],[1037,597]])svg+=flower(x!,y!,24,frame.colors[0]);
 if(frame.id==='gold'||frame.id==='century')svg+='<path d="M65 60H370L390 45H690L710 60H1015M65 580H370L390 595H690L710 580H1015" fill="none" stroke="url(#line)" stroke-width="2"/>';
 svg+='<circle cx="112" cy="116" r="49" fill="'+frame.colors[0]+'"/><circle cx="112" cy="116" r="45" fill="#354152"/>';
 svg+=options.avatar?'<image href="data:image/png;base64,'+Buffer.from(options.avatar).toString('base64')+'" x="67" y="71" width="90" height="90" clip-path="url(#avatar)"/>':text(88,132,[...name][0]??'桜',43);
 svg+=text(180,86,'咲楽ノ宮 ─ 参拝の記録',18,frame.colors[0])+text(180,130,name,32)+text(180,165,title,20,frame.colors[0])+text(795,84,'SAKURA / PROFILE',15,frame.colors[0]);
 svg+='<path d="M65 193H1015" stroke="'+frame.colors[0]+'" opacity=".5"/>';
 if(visible){
  svg+=text(70,240,'参拝ランク',20,frame.colors[0])+text(70,297,'Lv.'+data.rank.level+'  '+data.rank.name,37);
  svg+=text(70,343,data.rank.next?'次の「'+data.rank.next.name+'」まで '+hours(data.rank.next.minutes-data.minutes):'最高ランクに到達しました',18);
  svg+='<rect x="70" y="366" width="480" height="7" rx="3" fill="#ffffff" opacity=".2"/><rect x="70" y="366" width="'+Math.round(480*progress)+'" height="7" rx="3" fill="'+frame.colors[0]+'"/>';
  svg+=text(70,419,'累計通話　'+hours(data.minutes),23)+text(70,459,'今月の通話　'+hours(data.monthMinutes),23)+text(70,499,'参拝日数　'+data.activeDays+'日',23);
  svg+=text(641,240,'ご縁のしるし',20,frame.colors[0]);
  const selected=data.profile.badges.filter(id=>data.badges.some(b=>b.badgeId===id)).slice(0,5);
  if(!selected.length)svg+=text(641,298,'バッジを選んで飾れます',19);
  selected.forEach((id,i)=>{const b=VISIT_BADGES.find(b=>b.id===id);if(!b)return;svg+=flower(664,281+i*48,14,frame.colors[0])+text(690,289+i*48,b.name,19);});
 }else svg+=text(70,303,'活動記録は非公開です',32)+text(70,350,'背景とフレームで、自分らしい一枚に。',21);
 svg+=text(70,564,options.preview?'着せ替えの見本 · 保存前のプレビュー':'一つひとつの語らいが、ご縁になる。',17,frame.colors[0]);
 svg+=text(760,564,'SAKURA NO MIYA',16,frame.colors[0]);
 return svg+'</svg>';
}
export function renderVisitCard(data:VisitData,options:Parameters<typeof visitCardSvg>[1]={}):Buffer{
 return Buffer.from(new Resvg(visitCardSvg(data,options),{font:{fontFiles:fonts,loadSystemFonts:false,defaultFontFamily:'Shippori Mincho B1 Medium'}}).render().asPng());
}
