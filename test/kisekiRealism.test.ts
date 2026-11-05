import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {kisekiDigitPattern,kisekiDigits} from '../src/services/casino/kiseki/presentation.js';
import {verifyKiseki} from '../src/services/casino/kiseki/verification.js';
const source=readFileSync(new URL('../src/web/public/kiseki-realism.js',import.meta.url),'utf8');
function fixture(supported=true){
 let time=0,hidden=false,motion='normal',light=false,active=true,sequence=0;const timers=new Map<number,{at:number;fn:()=>void}>(),sounds:any[]=[],vibrations:unknown[]=[],levels=new Map(),storage=new Map();
 const element=()=>({textContent:'',hidden:true,disabled:false,value:'',dataset:{} as Record<string,string>});
 const stats=element(),audio=element(),note=element(),rest=element(),haptics=element(),banner=element(),prefs=Object.keys({density:0,operationsVolume:0,effectsVolume:0,bgmVolume:0,contact:0,haptics:0,rest:0}).map(key=>({...element(),dataset:{ktPref:key}}));let awarded=false;
 const machine={dataset:{kisekiPhase:'normal',spinning:'false',paid:'150',ktRole:'middleGold',ktPattern:'odd'} as Record<string,string>,querySelector:(selector:string)=>selector==='[data-gt-lcd-award]'?(awarded?{}:null):selector==='[data-kt-phase-announcement]'?banner:null,querySelectorAll:()=>['2','4','6'].map(textContent=>({textContent,classList:{contains:()=>false}}))};
 const root={classList:{contains:()=>active},dataset:{revision:'1'},querySelector:(selector:string)=>({'.kt-machine':machine,'[data-kt-pref="haptics"]':haptics,'[data-kt-haptics-note]':note,'[data-kt-session-stats]':stats,'[data-kt-audio-state]':audio,'[data-kt-break-note]':rest} as Record<string,any>)[selector]??null,querySelectorAll:()=>prefs};
 const bank:any={urls:{lever:'lever','bgm-gg':'gg','bgm-pgg':'pgg'},enabled:true,context:{state:'running',baseLatency:.01,outputLatency:.02},setGroupLevel:(key:string,value:number)=>levels.set(key,value),stopGroup:()=>{},play:async(key:string,options:unknown)=>{sounds.push({key,options});}};
 const window:any={};runInNewContext(source,{window,localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},navigator:supported?{vibrate:(value:unknown)=>vibrations.push(value)}:{},setTimeout:(fn:()=>void,ms:number)=>{const id=++sequence;timers.set(id,{at:time+ms,fn});return id;},clearTimeout:(id:number)=>timers.delete(id)});
 const director=new window.KisekiRealismDirector({bank,root:()=>root,motion:()=>motion,hidden:()=>hidden,light:()=>light,now:()=>time});
 const advance=(ms:number)=>{const end=time+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;};
 return {director,bank,root,machine,stats,audio,note,rest,haptics,banner,sounds,vibrations,levels,storage,timers,advance,hide:(value=true)=>hidden=value,reduce:()=>motion='instant',light:()=>light=true,award:()=>awarded=true,inactive:()=>active=false};
}

it('最後に止める数字だけを確定役に対応させ、先に止めた数字と非当選の非ゾロ目を保つ',()=>{
 for(let game=1;game<40;game++)for(const lastIndex of [0,1,2])for(const role of ['none','blue','middleBlue','fake','middleGold','diagonal','gaia','god','red','sp'] as const){
  const before=kisekiDigits(game,[1,7,13],true),after=kisekiDigits(game,[1,7,13],false,lastIndex,role);
  for(const index of [0,1,2].filter(i=>i!==lastIndex))expect(after[index]).toBe(before[index]);expect(new Set(after).size).toBeGreaterThan(1);
  if(['blue','middleBlue','fake'].includes(role))expect(after[lastIndex]!%2).toBe(0);
  if(['middleGold','diagonal','gaia'].includes(role))expect(after[lastIndex]!%2).toBe(1);
 }
 expect(kisekiDigitPattern([1,2,3])).toBe('ascending');expect(kisekiDigitPattern([5,4,3])).toBe('descending');expect(kisekiDigitPattern([1,null,3])).toBe('spinning');expect(kisekiDigitPattern([1,3,5])).toBe('odd');expect(kisekiDigitPattern([2,4,6])).toBe('even');expect(kisekiDigitPattern([2,2,3])).toBe('pair');
});
it('BGMを先読み対象から外し、個別音量と設定値を安全に反映する',()=>{
 const f=fixture();f.director.sync();expect(f.bank.eagerKeys).toEqual(['lever']);expect(f.bank.maxNodes).toBe(28);expect(f.levels.get('bgm')).toBe(.5);expect(f.levels.get('play')).toBe(1);
 f.director.preference('operationsVolume','0');expect(f.levels.get('play')).toBe(0);expect(f.levels.get('motor')).toBe(0);
 f.director.preference('density','quiet');expect(f.director.density()).toBe(.3);f.director.preference('density','unknown');f.director.preference('__proto__','bad');expect(f.director.density()).toBe(.3);
 expect(f.audio.textContent).toContain('10ms');expect(f.audio.textContent).toContain('20ms');expect([...f.storage.keys()]).toEqual(['kiseki-realism']);
});
it('払出し150は15回の音、リプレイは返却音とし、失敗応答では再生/集計しない',()=>{
 const f=fixture();f.director.update({action:'stop',index:2,ok:true});f.advance(1000);expect(f.sounds.filter(s=>s.key==='kt-payout-tick')).toHaveLength(15);expect(f.director.results).toHaveLength(1);
 f.sounds.length=0;f.root.dataset.revision='2';f.machine.dataset.ktRole='blue';f.machine.dataset.paid='30';f.director.update({action:'stop',index:2,ok:true});f.advance(1000);expect(f.sounds.filter(s=>s.key==='replay')).toHaveLength(1);expect(f.sounds.filter(s=>s.key==='kt-payout-tick')).toHaveLength(0);
 f.sounds.length=0;f.root.dataset.revision='3';f.director.update({action:'stop',index:2,ok:false});f.advance(1000);expect(f.sounds).toHaveLength(0);expect(f.director.results).toHaveLength(2);
});
it('非表示・消音・低減で残るタイマー/位相告知を消し、古い払出音を復帰後に鳴らさない',()=>{
 for(const cancel of ['hidden','mute','reduced'] as const){const f=fixture();f.director.update({before:{dataset:{kisekiPhase:'gg'}},action:'stop',index:2,ok:true});f.advance(45);const count=f.sounds.length;
  if(cancel==='hidden')f.hide();if(cancel==='mute')f.bank.enabled=false;if(cancel==='reduced')f.reduce();f.director.sync();expect(f.director.timers.size).toBe(0);expect(f.banner.textContent).toBe('');f.advance(3000);expect(f.sounds).toHaveLength(count);
 }
});
it('GOD等の告知中は小役音や払出音を重ねず、振動は対応端末の明示ONだけ',()=>{
 const f=fixture();f.award();f.director.update({action:'stop',index:2,ok:true});expect(f.sounds).toHaveLength(0);expect(f.vibrations).toHaveLength(0);
 f.director.preference('haptics','on');f.root.dataset.revision='2';f.director.update({action:'stop',index:2,ok:true});expect(f.vibrations).toEqual([[18,25,25]]);
 const no=fixture(false);no.director.sync();expect(no.haptics.disabled).toBe(true);expect(no.note.textContent).toContain('対応していません');
});
it('休憩目安は表示中の時間だけを数え、記録は直近120件、ゲームの送信は行わない',()=>{
 const f=fixture();f.director.preference('rest','30');f.advance(1800000);f.director.sync();expect(f.rest.hidden).toBe(false);f.director.dismissBreak();expect(f.rest.hidden).toBe(true);
 f.hide();f.director.sync();f.advance(3600000);f.hide(false);f.director.sync();expect(f.director.visibleMs).toBe(1800000);
 for(let i=0;i<250;i++){f.root.dataset.revision=String(i);f.machine.dataset.paid='0';f.director.update({action:'stop',index:2,ok:true});}
 expect(f.director.results).toHaveLength(120);expect(f.director.timers.size).toBeLessThan(20);expect(f.stats.textContent).toContain('120ゲーム');
});
it('ローカル検証で自動補助/目押し/旧自動の抽選・収支・権利が一致し、保存再開の整合性も守る',()=>{
 const modes=['assist','timing','legacy'] as const,results=modes.map(mode=>verifyKiseki({games:180,draws:10000,seed:1126,mode}));
 for(const result of results){expect(result.realWalletUsed).toBe(false);expect(result.invariants).toBe(true);expect(result.returned-result.input).toBe(result.netPoints);}
 const withoutMode=({mode,...rest}:typeof results[number])=>rest;expect(withoutMode(results[0]!)).toEqual(withoutMode(results[1]!));expect(withoutMode(results[0]!)).toEqual(withoutMode(results[2]!));
 for(const value of [0,-1,1.5,20001])expect(()=>verifyKiseki({games:value})).toThrow();
});
