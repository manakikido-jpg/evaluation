import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/gaisen-audio.js',import.meta.url),'utf8');
function fixture(motor=false,limiter=false){
 let clock=0,calls=0,defer=false,unlock=false;let resumeDone:(()=>void)|null=null;const pending:Array<()=>void>=[],started:any[]=[],contexts:any[]=[],compressors:any[]=[],fail=new Set<string>();
 class Context{
  currentTime=0;destination={};closed=false;state='running';
  constructor(){contexts.push(this);}
  async resume(){if(unlock){this.state='suspended';await new Promise<void>(r=>resumeDone=()=>{this.state='running';r();});}} async close(){this.closed=true;}
  async decodeAudioData(buffer:ArrayBuffer){return {buffer};}
  createDynamicsCompressor(){if(!limiter)return undefined;const node:any={connect(){}};for(const key of ['threshold','knee','ratio','attack','release'])node[key]={value:0};compressors.push(node);return node;}
  createGain(){return {gain:{value:0,setTargetAtTime(value:number){this.value=value;}},connect(){},disconnect(){}};}
  createBufferSource(){const node={buffer:null as any,stopped:false,onended:null as null|(()=>void),connect(){},disconnect(){},start(){started.push(node);},stop(){this.stopped=true;this.onended?.();}};return node;}
 }
 const window:any={};
 runInNewContext(source,{window,AudioContext:Context,performance:{now:()=>clock},fetch:async(url:string)=>{calls++;if(defer)await new Promise<void>(r=>pending.push(r));return {ok:!fail.has(url),arrayBuffer:async()=>new ArrayBuffer(8)};}});
 const bank=new window.GaisenSampleBank({lever:'/lever.mp3',god:'/god.mp3',...(motor?{'reel-motor':'/motor.mp3'}:{})});
 return {bank,started,contexts,compressors,fail,calls:()=>calls,delay:()=>{defer=true;},waitUnlock:()=>{unlock=true;},unlock:()=>{resumeDone?.();},release:()=>pending.splice(0).forEach(r=>r()),tick:(ms:number)=>{clock+=ms;},ready:()=>Promise.all([...bank.loading.values()])};
}
describe('新台の別生成音源',()=>{
 it('音OFFでは音源取得もAudioContext作成も行わず、ON後は取得/復号を再利用する',async()=>{
  const f=fixture();f.bank.prepare();await f.bank.play('lever');expect(f.calls()).toBe(0);expect(f.contexts).toHaveLength(0);
  f.bank.setEnabled(true);f.bank.prepare();await f.ready();await f.bank.play('lever');f.bank.prepare();await f.bank.play('lever');expect(f.calls()).toBe(2);expect(f.started).toHaveLength(2);
 });
 it('ミュートで再生中と読み込み待ちの音を止め、再ONしても古い音を鳴らさない',async()=>{
  const f=fixture();f.delay();f.bank.setEnabled(true);f.bank.prepare();const old=f.bank.play('god');f.bank.setEnabled(false);f.bank.setEnabled(true);f.bank.prepare();f.release();await old;await f.ready();expect(f.started).toHaveLength(0);
  await f.bank.play('lever');expect(f.started).toHaveLength(1);f.bank.setEnabled(false);expect(f.started[0].stopped).toBe(true);expect(f.bank.nodes.size).toBe(0);
 });
 it('ロードが180msを超えた操作音は遅れて鳴らさず、次の操作はキャッシュから鳴る',async()=>{
  const f=fixture();f.delay();f.bank.setEnabled(true);f.bank.prepare();const play=f.bank.play('lever');f.tick(181);f.release();await play;await f.ready();expect(f.started).toHaveLength(0);await f.bank.play('lever');expect(f.started).toHaveLength(1);
 });
 it('スキップは当選音だけを止め、停止・払出などの音を混同しない',async()=>{
  const f=fixture();f.bank.setEnabled(true);f.bank.prepare();await f.ready();await f.bank.play('lever');await f.bank.play('god',{group:'win'});f.bank.stopGroup('win');expect(f.started.map(n=>n.stopped)).toEqual([false,true]);f.bank.stopAll();expect(f.started.every(n=>n.stopped)).toBe(true);
 });
 it('終了した当選のロード完了後や音源のないキーで音を再生しない',async()=>{
  const f=fixture();f.delay();f.bank.setEnabled(true);f.bank.prepare();const play=f.bank.play('god',{group:'win'});f.bank.stopGroup('win');f.release();await play;await f.ready();await f.bank.play('missing');expect(f.started).toHaveLength(0);
 });
 it('音源の取得に失敗しても例外を投げず、ほかの音を続けて再生できる',async()=>{
  const f=fixture();f.fail.add('/god.mp3');f.bank.setEnabled(true);f.bank.prepare();await f.ready();await f.bank.play('god');expect(f.started).toHaveLength(0);await f.bank.play('lever');expect(f.started).toHaveLength(1);
 });
 it('音量変更を再生中にも適用し、MP3に設定した音量を重ねる',async()=>{
  const f=fixture();f.bank.setEnabled(true);f.bank.prepare();await f.ready();await f.bank.play('lever',{level:.5});f.bank.setVolume(.3);expect([...f.bank.nodes.values()][0].gain.gain.value).toBeCloseTo(.15);
 });
 it('回転音は一つのループを使い、回転中の本数で音量を変え、最後の停止で止める',async()=>{
  const f=fixture(true);f.bank.setEnabled(true);f.bank.prepare();await f.ready();f.bank.setMotor(3);await f.bank.motorLoading;
  expect(f.started).toHaveLength(1);expect(f.started[0].loop).toBe(true);expect(f.started[0].loopStart).toBe(.25);expect(f.started[0].loopEnd).toBe(2.25);
  const entry=[...f.bank.nodes.values()][0];expect(entry.level).toBeCloseTo(.16);
  f.bank.setMotor(2);f.bank.setMotor(1);expect(f.started).toHaveLength(1);expect(entry.level).toBeCloseTo(.09);
  f.bank.setVolume(.5);expect(entry.gain.gain.value).toBeCloseTo(.045);f.bank.setMotor(0);expect(f.started[0].stopped).toBe(true);expect(f.bank.motor).toBeNull();
 });
 it('回転音のロード待ち中に全停止・ミュートしたら後から回り始めない',async()=>{
  for(const cancel of ['stop','mute']){const f=fixture(true);f.delay();f.bank.setEnabled(true);f.bank.prepare();f.bank.setMotor(3);const waiting=f.bank.motorLoading;
   if(cancel==='stop')f.bank.setMotor(0);else f.bank.setEnabled(false);f.release();await waiting;await f.ready();expect(f.started).toHaveLength(0);}
 });
 it('ロード中に回転本数が変わっても最新の本数で一つだけ始まる',async()=>{
  const f=fixture(true);f.delay();f.bank.setEnabled(true);f.bank.prepare();f.bank.setMotor(3);f.bank.setMotor(1);f.release();await f.ready();await f.bank.motorLoading;await f.bank.motorLoading;
  expect(f.started).toHaveLength(1);expect([...f.bank.nodes.values()][0].level).toBeCloseTo(.09);f.bank.stopAll();expect(f.started[0].stopped).toBe(true);
 });

 it('音の開始許可待ちで遅れた操作音は鳴らさず、許可後の操作だけ鳴る',async()=>{
  const f=fixture();f.waitUnlock();f.bank.setEnabled(true);f.bank.prepare();await f.ready();const old=f.bank.play('lever');f.tick(200);f.unlock();await old;expect(f.started).toHaveLength(0);await f.bank.play('lever');expect(f.started).toHaveLength(1);
 });
 it('AudioContextが中断中なら操作音を鳴らさない',async()=>{
  const f=fixture();f.bank.setEnabled(true);f.bank.prepare();await f.ready();f.contexts[0].state='interrupted';await f.bank.play('lever');expect(f.started).toHaveLength(0);
 });

 it('当選音を優先して回転音・操作音を抑え、終了後は現在の音量へ戻す',async()=>{
  const f=fixture(true);f.bank.setEnabled(true);f.bank.prepare();await f.ready();f.bank.setMotor(3);await f.bank.motorLoading;await f.bank.play('lever');
  const motor=[...f.bank.nodes.values()].find(e=>e.group==='motor');await f.bank.play('god',{group:'win'});const play=[...f.bank.nodes.values()].find(e=>e.group==='play');expect(play.gain.gain.value).toBeCloseTo(.65*.65*.35);expect(motor.gain.gain.value).toBeCloseTo(.65*.16*.14);
  f.bank.setVolume(.3);f.bank.stopGroup('win');expect(play.gain.gain.value).toBeCloseTo(.3*.65);expect(motor.gain.gain.value).toBeCloseTo(.3*.16*.65);
 });
 it('同時に重なった操作音の音量を抑え、片方が終われば戻す',async()=>{
  const f=fixture();f.bank.setEnabled(true);f.bank.prepare();await f.ready();await f.bank.play('lever');await f.bank.play('lever');for(const entry of f.bank.nodes.values())expect(entry.gain.gain.value).toBeCloseTo(.65*.65/Math.sqrt(2));f.started[0].stop();expect([...f.bank.nodes.values()][0].gain.gain.value).toBeCloseTo(.65*.65);
 });

 it('払出音の間は操作と回転音を抑え、払出が終わると戻す',async()=>{
  const f=fixture(true);f.bank.urls.payout='/payout.mp3';f.bank.setEnabled(true);f.bank.prepare();await f.ready();f.bank.setMotor(3);await f.bank.motorLoading;await f.bank.play('lever');await f.bank.play('payout');
  const motor=[...f.bank.nodes.values()].find(e=>e.group==='motor'),operation=[...f.bank.nodes.values()].find(e=>e.priority===1);expect(motor.gain.gain.value).toBeCloseTo(.65*.16*.35);expect(operation.gain.gain.value).toBeCloseTo(.65*.65*.7);f.started.at(-1).stop();expect(operation.gain.gain.value).toBeCloseTo(.65*.65);
 });
 it('重なりのピークを抑える出力を一度だけ作り、ミュートで閉じて再ONで作り直す',async()=>{
  const f=fixture(false,true);f.bank.setEnabled(true);f.bank.prepare();f.bank.prepare();expect(f.compressors).toHaveLength(1);expect(f.compressors[0].threshold.value).toBe(-8);expect(f.compressors[0].ratio.value).toBe(8);f.bank.setEnabled(false);expect(f.contexts[0].closed).toBe(true);f.bank.setEnabled(true);f.bank.prepare();expect(f.compressors).toHaveLength(2);
 });

});
