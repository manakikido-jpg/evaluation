import {BET,lever,newGaisen,stop,type Setting} from './engine.js';
/** 同じseedで再現できる試算。自然抽選のみ、通常は左→中→右、ナビ時だけ従う。 */
export function simulateGaisen(setting:Setting,games:number,seed:number){
 if(!Number.isSafeInteger(games)||games<1||games>1000000)throw Error('試算は1〜100万ゲームです。');
 let n=seed>>>0;const rng=(max:number)=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return Math.floor(n/4294967296*max);};
 const s=newGaisen(setting);let minNet=0,maxNet=0,refills=0;const phases:Record<string,number>={};
 for(let i=0;i<games;i++){
  if(s.balance<BET){s.balance+=100000;refills++;}
  phases[s.phase]=(phases[s.phase]??0)+1;lever(s,rng);const p=s.pending!;
  const order=p.hold?[1]:p.role==='bell'&&['gg','sgg','gzone'].includes(p.phase)?p.order.slice():[0,1,2];
  for(const reel of order)stop(s,reel,rng);
  const net=s.output-s.input;minNet=Math.min(minNet,net);maxNet=Math.max(maxNet,net);
 }
 return {setting,games,seed,input:s.input,output:s.output,returnPercent:Number((s.output/s.input*100).toFixed(3)),net:s.output-s.input,minNet,maxNet,refills,phases,god:s.gods,ggFirsts:s.firsts,sgg:s.sggs,unfinished:{phase:s.phase,ggLeft:s.ggLeft,stocks:s.stocks},provisional:true};
}
