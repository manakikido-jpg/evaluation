import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../src/web/public/gaisen-audio.js',import.meta.url),'utf8');
function fixture(){
 let clock=0,calls=0,defer=false;const pending:Array<()=>void>=[],started:any[]=[],contexts:any[]=[],fail=new Set<string>();
 class Context{
  currentTime=0;destination={};closed=false;
  constructor(){contexts.push(this);}
  async resume(){} async close(){this.closed=true;}
  async decodeAudioData(buffer:ArrayBuffer){return {buffer};}
  createGain(){return {gain:{value:0,setTargetAtTime(value:number){this.value=value;}},connect(){},disconnect(){}};}
  createBufferSource(){const node={buffer:null as any,stopped:false,onended:null as null|(()=>void),connect(){},disconnect(){},start(){started.push(node);},stop(){this.stopped=true;this.onended?.();}};return node;}
 }
 const window:any={};
 runInNewContext(source,{window,AudioContext:Context,performance:{now:()=>clock},fetch:async(url:string)=>{calls++;if(defer)await new Promise<void>(r=>pending.push(r));return {ok:!fail.has(url),arrayBuffer:async()=>new ArrayBuffer(8)};}});
 const bank=new window.GaisenSampleBank({lever:'/lever.mp3',god:'/god.mp3'});
 return {bank,started,contexts,fail,calls:()=>calls,delay:()=>{defer=true;},release:()=>pending.splice(0).forEach(r=>r()),tick:(ms:number)=>{clock+=ms;},ready:()=>Promise.all([...bank.loading.values()])};
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
});
