import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';
import {STRIPS,LEGACY_STRIPS,PAYLINES,REFERENCE_COMBINATIONS,ROLES,effectiveRole,stopPlan,rows,drawRole,DRAW_SIZE,type KisekiRole} from '../src/services/casino/kiseki/rules.js';
import {newKiseki,lever,stop,scenario} from '../src/services/casino/kiseki/engine.js';
import {NORMAL_MODES,NORMAL_MODE_NAMES,normalModeOf,modeGroup,planKisekiDigits,REACH_PATTERNS,kisekiStage} from '../src/services/casino/kiseki/presentation.js';
import {freshFloor,trialView} from '../src/services/casino/kiseki/trial.js';
const last=(n:number)=>n-1;
it('資料08の20コマの順と、有効1LINE・見た目の停止型から得る配当を照合する',()=>{
 expect(STRIPS[0]).toEqual(['gold7','crest','red7','blue7','god','gold7','crest','flower','blue7','god','gold7','crest','red7','blue7','god','gold7','crest','red7','blue7','god']);
 expect(STRIPS[1]).toEqual(Array.from({length:4},()=>['red7','gold7','blue7','gold7','god']).flat());
 expect(STRIPS[2]).toEqual(['blue7','crest','red7','gold7','god','blue7','crest','red7','gold7','god','blue7','crest','red7','gold7','god','blue7','crest','flower','gold7','god']);
 expect(PAYLINES).toEqual([[1,0,1]]);expect(new Set(REFERENCE_COMBINATIONS.map(a=>a.slice(0,3).join())).size).toBe(REFERENCE_COMBINATIONS.length);
 for(const [positions,role]of [[[4,4,4],'god'],[[2,0,2],'red'],[[2,0,4],'sp'],[[4,2,2],'bell'],[[4,0,2],'small'],[[1,3,4],'gaia'],[[4,3,1],'blue']] as const)expect(effectiveRole([...positions])).toBe(role);
 for(const role of Object.keys(ROLES) as KisekiRole[]){const p=stopPlan(role);expect(effectiveRole(p)).toBe(role);const s=newKiseki();lever(s,last,role,true);for(const i of s.pending!.order.slice())stop(s,i,last,7);expect(effectiveRole(s.lastPositions)).toBe(role);expect(s.lastPaid).toBe(ROLES[role].units*10);}
});
it('旧配列の回転途中を旧仕様で完了し、次のゲームからだけ新配列へ切り替える',()=>{
 const f=freshFloor(0),m=f.machines[0]!;m.owner='u';const s=m.state;lever(s,last,'god',true);delete s.reelSet;delete s.normalMode;delete s.pending!.lcdDigits;s.pending!.plan=stopPlan('god','legacy');s.pending!.positions=[0,null,null];s.pending!.stops=[0];s.pending!.reelStops=[{input:0,position:0,slip:0,assisted:false},null,null];
 const before=JSON.parse(JSON.stringify(f));expect(trialView(f,'u').own!.reels[0]).toEqual(rows(0,0,'legacy'));expect(LEGACY_STRIPS[0]![0]).toBe('god');expect(JSON.parse(JSON.stringify(f))).toEqual(before);
 for(const i of [1,2])stop(s,i,last,19);expect(s.lastPositions[0]).toBe(0);expect(s.lastPaid).toBe(150);expect(s.reelSet).toBeUndefined();expect(trialView(f,'u').own!.reels[0]).toEqual(rows(0,0,'legacy'));
 const balance=s.balance;lever(s,last,'blue',true);expect(s.reelSet).toBe('reference');for(const i of [0,1,2])stop(s,i,last,19);expect(s.balance).toBe(balance);expect(trialView(f,'u').own!.reels).toEqual(s.lastPositions.map((p,i)=>rows(i,p)));expect(trialView(JSON.parse(JSON.stringify(f)),'u')).toEqual(trialView(f,'u'));
});
it('旧3段階を読めるまま表6モードを持ち、未公表の移行率は試遊用モデルとして扱う',()=>{
 expect(NORMAL_MODES.map(m=>NORMAL_MODE_NAMES[m])).toEqual(['低確A','低確B','通常','天国準備','天国','超天国']);expect(normalModeOf({mode:'low'})).toBe('lowA');expect(normalModeOf({mode:'high'})).toBe('heaven');
 const s=newKiseki(),rng=(n:number)=>n===4?0:n-1;for(const mode of NORMAL_MODES.slice(1)){lever(s,rng,'middleGold');for(const i of [0,1,2])stop(s,i,rng);expect(s.normalMode).toBe(mode);expect(s.mode).toBe(modeGroup(mode));}
});
it('0/8/Vを表示し、リーチ目は本前兆中に限定し、止めた液晶を最後まで保つ',()=>{
 const highHints=new Set<string>();for(let n=1;n<=1000;n++){const s=newKiseki();s.spins=n;s.mode='high';s.normalMode='heaven';highHints.add(planKisekiDigits(s,'none').join(','));}expect(highHints.has('V,5,V')).toBe(true);
 const glyphs=new Set(),reaches=new Set(REACH_PATTERNS.map(p=>p.join(',')));let found=false;
 for(let n=1;n<=1000;n++){const s=newKiseki();s.spins=n;const digits=planKisekiDigits(s,'none');digits.forEach(d=>glyphs.add(d));expect(reaches.has(digits.join(','))).toBe(false);expect(digits[0]==='V'&&digits[2]==='V').toBe(false);expect(digits.every(d=>d===digits[0])).toBe(false);s.omenAwards=1;s.omenLeft=3;if(planKisekiDigits(s,'none').join(',')==='3,1,5')found=true;}
 expect([...glyphs]).toEqual(expect.arrayContaining([0,8,'V']));expect(found).toBe(true);
 const f=freshFloor(0);f.machines[0]!.owner='u';const s=f.machines[0]!.state;lever(s,last,'none',true);const seen=new Map();for(const i of [2,0,1]){stop(s,i,last,19);const v=trialView(f,'u').own!;for(const [i,value]of seen)expect(v.digits[i]).toBe(value);seen.set(i,v.digits[i]);}expect(trialView(JSON.parse(JSON.stringify(f)),'u').own!.digits).toEqual(s.lastDigits);
});
it('Z-ZONEのレア黄7も発生し、通常の失敗5回まで続き、黄7の間は減算しない',()=>{
 let edge=0;for(const r of ['god','red','sp','diagonal','middleGold'] as const){expect(drawRole(()=>edge,true)).toBe(r);edge+=Math.round(DRAW_SIZE/ROLES[r].denominator);}
 const s=scenario(1,'zzone');for(let n=0;n<5;n++){lever(s,last,'bell');for(const i of s.pending!.order.slice())stop(s,i,last);expect(s.phase).toBe('zzone');expect(s.left).toBe(5-n);lever(s,last,'none');for(const i of [0,1,2])stop(s,i,last);expect(s.phase).toBe(n===4?'gg':'zzone');if(n<4)expect(s.left).toBe(4-n);expect(s.zRun).toBe(0);}
});
it('資料の通常/GG/ガイア/Zのステージを分け、通常風景だけからモードを確定できない',()=>{
 const normal=new Set();for(const mode of NORMAL_MODES)for(let n=0;n<100;n++){const s=newKiseki();s.normalMode=mode;s.mode=modeGroup(mode);s.normalGames=n*20;normal.add(kisekiStage(s));}expect([...normal]).toEqual(expect.arrayContaining(['apollon','aphrodite','artemis','acropolis','athena']));
 for(const [phase,key]of [['pgg','god'],['gaia','gaia'],['zzone','zzone'],['zgame','zgame'],['sgg','sgg']] as const)expect(kisekiStage(scenario(1,phase))).toBe(key);
 const zero=scenario(1,'gg');zero.stocks=0;expect(kisekiStage(zero)).toBe('olympus');
});

it('回転帯の目押し位置は新配列の順で取り、旧配列と凱旋は従来の向きを維持する',()=>{
 const source=readFileSync(new URL('../src/web/public/gaisen-trial.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf(' function timingPosition('),source.indexOf(' function clearTiming('));
 for(const set of ['reference','legacy','gaisen'])for(let cell=0;cell<40;cell++){
  const button={dataset:{gtKey:'stop-0'}},animation={animationName:'gt-reel-roll'},strip={getAnimations:()=>[animation],querySelector:()=>({getBoundingClientRect:()=>({height:40})})};
  const machine={dataset:{reelSet:set}},r={querySelector:(q:string)=>q.includes('data-timing')?machine:q==='.kt-machine'?(set==='gaisen'?null:machine):{querySelector:()=>strip}};
  const value=runInNewContext(fn+';timingPosition(button)',{button,root:()=>r,control:'timing',actualMotion:()=> 'normal',document:{hidden:false},getComputedStyle:()=>({transform:'matrix'}),DOMMatrixReadOnly:class{m42=-(cell-1)*40;}});
  expect(value.position).toBe(set==='reference'?cell%20:19-cell%20);expect(value.animation).toBe(animation);
 }
});
