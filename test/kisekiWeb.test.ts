import {beforeEach,afterEach,it,expect} from 'vitest';
import {eq} from 'drizzle-orm';
import {makeDb,cfg,ROLE} from './helpers.js';
import type {Db} from '../src/db/client.js';
import {settings} from '../src/db/schema.js';
import {createWebApp} from '../src/web/app.js';
import {createSession,findSession} from '../src/web/sessions.js';
import {recordJoin} from '../src/services/members.js';
import {addCoins,walletOf} from '../src/services/economy.js';
import {lever,scenario} from '../src/services/casino/kiseki/engine.js';
import {readTrial,TRIAL_KEY} from '../src/services/casino/kiseki/trial.js';
import {readTrial as readGaisen,TRIAL_KEY as OLD_KEY,TRIAL_V2_KEY} from '../src/services/casino/gaisen/trial.js';
const now=new Date('2026-11-05T03:00:00Z'),id='760000000000000001',user={id,username:'sample',displayName:'試遊の運営',avatarUrl:null},path='/economy/kiseki-trial';
let db:Db,close:()=>Promise<void>,app:ReturnType<typeof createWebApp>,token:string,csrf:string;
const headers=(t=token)=>({cookie:'shamusho_session='+t,origin:'https://example.test','sec-fetch-site':'same-origin'});
beforeEach(async()=>{({db,close}=await makeDb());await recordJoin(db,{...user,roleIds:[ROLE.guji],isBot:false,joinedAt:now});await addCoins(db,id,3210,'adjust');app=createWebApp({db,cfg:()=>cfg,api:{memberRoles:async()=>[ROLE.guji]}as never,discord:{guildChannels:async()=>[]}as never,baseUrl:'https://example.test',now:()=>now});token=await createSession(db,user,{level:'guji',pages:null},now);csrf=(await findSession(db,token,now))!.csrfToken;});afterEach(async()=>close());
async function post(action:string,extra:Record<string,string>={},js=true){return app.request(path,{method:'POST',headers:{...headers(),...(js?{'X-Gaisen-Update':'1'}:{})},body:new URLSearchParams({_csrf:csrf,revision:String((await readTrial(db,now)).revision),machine:'1',action,...extra})});}
it('個別音量・振動・休憩・診断を備え、回転中は確定役をデータ属性へ出さない',async()=>{
 await post('seat');await post('lever');const html=await(await app.request(path,{headers:headers()})).text();
 for(const text of ['kiseki-direction.js?v=','kiseki-realism.js?v=','gaisen-diagnostics.js?v=','data-gt-diagnostic-build=','data-kt-pref="density"','data-kt-pref="operationsVolume"','data-kt-pref="effectsVolume"','data-kt-pref="bgmVolume"','data-kt-pref="haptics"','data-kt-pref="rest"','data-gt-diagnostic-toggle','data-kt-audio-state','data-kt-break-note','data-kt-replay-win'])expect(html).toContain(text);
 expect(html).toContain('data-kt-role=""');expect(html).toContain('data-kt-pattern="spinning"');expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>|onclick=|style=/);
 expect((await walletOf(db,id)).balance).toBe(3210);
});
it('カジノ管理に別入口を置き、凱旋の2版・財布・保存キーを変えずに軌跡を遊べる',async()=>{
 expect((await(await app.request('/economy/casino',{headers:headers()})).text())).toContain(path);
 const old=await readGaisen(db,now),v2=await readGaisen(db,now,'trial-2');
 expect((await post('seat')).status).toBe(200);expect((await post('lever')).status).toBe(200);for(const index of ['0','1','2'])expect((await post('stop',{index})).status).toBe(200);
 expect((await readTrial(db,now)).machines[0]!.state.spins).toBe(1);expect(await readGaisen(db,now)).toEqual(old);expect(await readGaisen(db,now,'trial-2')).toEqual(v2);
 expect((await db.select().from(settings).where(eq(settings.key,OLD_KEY)))).toHaveLength(0);expect((await db.select().from(settings).where(eq(settings.key,TRIAL_V2_KEY)))).toHaveLength(0);expect((await db.select().from(settings).where(eq(settings.key,TRIAL_KEY)))).toHaveLength(1);expect((await walletOf(db,id)).balance).toBe(3210);
});
it('認証・経済ページ権限・CSRF・本人操作・revisionをすべて検査する',async()=>{
 for(const url of [path,path+'/guide'])expect((await app.request(url)).status).toBe(302);
 const limited=await createSession(db,user,{level:'shinshoku',pages:['members']},now);for(const url of [path,path+'/guide'])expect((await app.request(url,{headers:headers(limited)})).status).toBe(403);
 expect((await app.request(path,{method:'POST',headers:headers(),body:new URLSearchParams({action:'seat',machine:'1',revision:'0'})})).status).toBe(403);expect((await post('lever')).status).toBe(403);expect((await post('seat')).status).toBe(200);
 const other={...user,id:'760000000000000002'},t=await createSession(db,other,{level:'shinshoku',pages:['economy']},now),s=(await findSession(db,t,now))!;
 expect((await app.request(path,{method:'POST',headers:headers(t),body:new URLSearchParams({_csrf:s.csrfToken,action:'lever',machine:'1',revision:'1'})})).status).toBe(403);
 const rev=String((await readTrial(db,now)).revision),body=()=>new URLSearchParams({_csrf:csrf,action:'lever',machine:'1',revision:rev});const replies=await Promise.all([0,1].map(()=>app.request(path,{method:'POST',headers:{...headers(),'X-Gaisen-Update':'1'},body:body()})));expect(replies.map(r=>r.status).sort()).toEqual([200,409]);expect((await readTrial(db,now)).machines[0]!.state.input).toBe(30);
});
it('ガイドは20コマ/11役を独自画像で示し、台の状態も期限も変更しない',async()=>{
 await post('seat');const before=await readTrial(db,now),r=await app.request(path+'/guide',{headers:headers()});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');const html=await r.text();expect((html.match(/scope="row"/g)||[])).toHaveLength(20);expect((html.match(/class="gt-pattern"/g)||[])).toHaveLength(11);expect(html).toContain('PGG50G＋GG3ストック');expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>|onclick=|style=/);expect(await readTrial(db,now)).toEqual(before);
});
it('非JSフォームも動き、更新ヘッダーはHTMLを返す。不正STOP・再送・回転中の場面変更は保存しない',async()=>{
 const seat=await post('seat',{},false);expect(seat.status).toBe(303);expect(seat.headers.get('location')).toBe(path);expect((await post('lever')).status).toBe(200);const before=await readTrial(db,now);
 expect((await post('scenario',{scenario:'pgg'})).status).toBe(400);expect((await post('stop',{index:'3'})).status).toBe(400);expect(await readTrial(db,now)).toEqual(before);
 expect((await post('stop',{index:'0'})).status).toBe(200);const partial=await readTrial(db,now);expect((await post('stop',{index:'0'})).status).toBe(400);expect(await readTrial(db,now)).toEqual(partial);
 const html=await(await app.request(path,{headers:headers()})).text();expect(html).toContain('data-spinning="true"');expect(html).not.toMatch(/"(plan|loops|mode|omenLeft)":/);expect(html).toContain('gaisen-trial.js?v=');expect(html).toContain('kiseki-trial.css?v=');
 for(const index of ['1','2'])expect((await post('stop',{index})).status).toBe(200);
});

it('風景は公開G数だけで切り替わり、内部モードを映さず、閲覧で保存を変えない',async()=>{
 await post('seat');const f=await readTrial(db,now),state=f.machines[0]!.state;
 for(const [normalGames,name] of [[0,'spring'],[40,'garden'],[80,'ruins']] as const){
  state.normalGames=normalGames;
  for(const mode of ['low','high'] as const){state.mode=mode;await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_KEY));
   const html=await(await app.request(path,{headers:headers()})).text();
   expect(html).toContain(`data-landscape="${name}"`);expect(html).toContain(`kiseki-media-${name}-800.webp?v=`);expect(html).toContain(`kiseki-media-${name}-1440.webp?v=`);
   expect(html).toContain('kiseki-media-altar-1200.webp?v=');expect(html).not.toContain('data-gt-lcd-navigation');expect(html).not.toMatch(/onclick=|style=/);
   expect(await readTrial(db,now)).toEqual(f);
  }
 }
 for(const file of ['cue-wind','cue-glint','cue-thunder','cue-gates','win-gg','win-god','win-sgg']){const r=await app.request(`/static/kiseki-media-${file}.mp3`);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('audio/mpeg');expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);}
 for(const file of ['spring-800','spring-1440','garden-800','ruins-800','altar-1200','apron-1200','marquee-720','symbol-gold7','symbol-red7','symbol-blue7','symbol-god','symbol-flower','symbol-crest']){const r=await app.request(`/static/kiseki-media-${file}.webp`);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('image/webp');}
});
it('公開された押し順だけを三神のメダルへ表示し、右からの停止と再読込でも位置を維持する',async()=>{
 await post('seat');const f=await readTrial(db,now);f.machines[0]!.state=scenario(1,'gg');lever(f.machines[0]!.state,n=>n-1,'bell');await db.update(settings).set({value:f}).where(eq(settings.key,TRIAL_KEY));
 const read=async()=>await(await app.request(path,{headers:headers()})).text();let html=await read();
 const altar=html.slice(html.indexOf('class="kt-altar"'),html.indexOf('class="gt-reel-shelf"'));
 expect(altar).toContain('押し順ナビ：右→中→左');expect(altar).toMatch(/data-gt-lcd-position="2" data-gt-lcd-next="true"[^>]*><i[^>]*><\/i><b>1<\/b>/);
 expect((await post('stop',{index:'2'})).status).toBe(200);html=await read();expect(html).toMatch(/is-stopped" data-gt-lcd-position="2"/);expect(html).toContain('data-gt-lcd-position="1" data-gt-lcd-next="true"');
 for(const index of ['1','0'])expect((await post('stop',{index})).status).toBe(200);
 html=await read();expect(html).not.toContain('data-gt-lcd-navigation');expect(html).toContain('払出150ポイント');expect(html).toContain('kiseki-media-altar-1200.webp');
});

it('目押し位置を検査して記録し、再読込と再送でも停止窓と残高を保つ',async()=>{
 await post('seat');await post('lever',{control:'timing'});const before=await readTrial(db,now);
 for(const position of ['','-1','20','1.5','NaN','Infinity','0x10',' 1']){expect((await post('stop',{index:'0',position})).status).toBe(400);expect(await readTrial(db,now)).toEqual(before);}
 expect((await post('stop',{index:'0',position:'19'})).status).toBe(200);const partial=await readTrial(db,now);expect(partial.machines[0]!.state.pending!.reelStops![0]!.input).toBe(19);
 const html=await(await app.request(path,{headers:headers()})).text();expect(html).toContain('is-timed-stop');expect(html).toContain('kiseki-live.js?v=');expect(html).toContain('data-kt-bgm');expect(html).not.toMatch(/onclick=|style=|"(?:plan|mode|loops|omenLeft)":/);expect(await readTrial(db,now)).toEqual(partial);
 expect((await post('stop',{index:'0',position:'0'})).status).toBe(400);expect(await readTrial(db,now)).toEqual(partial);
 for(const index of ['1','2'])expect((await post('stop',{index,position:'19'})).status).toBe(200);
 expect((await walletOf(db,id)).balance).toBe(3210);
});
it('GG/PGG/SGGに別の背景と音源を配信し、閲覧で区間やポイントを書き換えない',async()=>{
 await post('seat');
 for(const phase of ['gg','pgg','sgg']){await post('scenario',{scenario:phase});const before=await readTrial(db,now),html=await(await app.request(path,{headers:headers()})).text();expect(html).toContain(`kiseki-media-scene-${phase}.webp?v=`);expect(html).toContain(`data-kt-theme="${phase}"`);expect(await readTrial(db,now)).toEqual(before);}
 for(const key of ['bgm-gg','bgm-pgg','bgm-sgg','gg','god','sgg']){const r=await app.request(`/static/kiseki-media-${key}.mp3`);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('audio/mpeg');expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(10000);}
 for(const key of ['gg','pgg','sgg']){const r=await app.request(`/static/kiseki-media-scene-${key}.webp`);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('image/webp');}
});
