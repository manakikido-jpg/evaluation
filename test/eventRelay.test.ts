import { describe, expect, it, vi } from 'vitest';
import OpusScript from 'opusscript';
import { SpeechPool, type SpeechWorker } from '../src/readAloud/pool.js';
import { EventRelay, type RelayFactory, type RelayTransport } from '../src/readAloud/relay.js';
import { RelayMixer, RELAY_FRAME_BYTES } from '../src/readAloud/relayAudio.js';
const worker = (): SpeechWorker => ({ ready: () => true, connect: vi.fn(async () => {}), speak: vi.fn(async () => {}), stop: vi.fn(), disconnect: vi.fn() });
const plan = { source: 'stage', targets: ['a','b','c','d','e','f'], actor: 'staff' };
const fakeTransport = (): RelayTransport => ({ botIds: ['bot1'], start: vi.fn(async () => {}), close: vi.fn(async () => {}), metrics: () => ({ packets: 0, lastPacketAt: null }) });
function deferred() { let resolve!: () => void, reject!: (e: Error) => void; const promise = new Promise<void>((ok,no) => { resolve=ok;reject=no; });return {promise,resolve,reject}; }
const pcm = (value: number) => { const b = Buffer.alloc(RELAY_FRAME_BYTES); for(let i=0;i<b.length;i+=2)b.writeInt16LE(value,i);return b; };
describe('中継と読み上げのBOT予約',()=>{
 it('10体から7体をまとめて確保し、残り3体で読み上げを続けられる',async()=>{
  const workers=Array.from({length:10},worker),pool=new SpeechPool(workers,20);
  const lease=pool.reserve(7,['stage',...plan.targets])!;expect(lease.indices).toEqual([0,1,2,3,4,5,6]);
  expect(await pool.start('a')).toBe('busy');expect(await pool.start('stage')).toBe('busy');
  expect(await Promise.all(['other1','other2','other3','other4'].map(id=>pool.start(id)))).toEqual(['started','started','started','busy']);
  expect(workers.slice(0,7).every(w=>vi.mocked(w.connect).mock.calls.length===0)).toBe(true);
  lease.release();lease.release();expect(await pool.start('a')).toBe('started');pool.close();
 });
 it('対象VCやBOTが使用中なら奪わず、失敗時に部分予約を残さない',async()=>{
  const pool=new SpeechPool(Array.from({length:7},worker),20);await pool.start('a');
  expect(pool.reserve(7,['stage',...plan.targets])).toBeNull();expect(pool.active('a')).toBe(true);
  expect(pool.reserve(7,['stage','x','y','z','u','v','w'])).toBeNull();
  pool.stop('a');const lease=pool.reserve(7,['stage',...plan.targets])!;expect(lease).not.toBeNull();
  pool.close();expect(await pool.start('unrelated')).toBe('busy');lease.release();expect(await pool.start('a')).toBe('started');pool.close();
 });
 it('部屋の重複・上限・BOT不足を接続前に拒否する',async()=>{
  const factory=vi.fn(fakeTransport),relay=new EventRelay(new SpeechPool(Array.from({length:7},worker),20),factory);
  for(const targets of [[],['stage'],['a','a'],['a','b','c','d','e','f','g']])await expect(relay.start({...plan,targets})).rejects.toThrow();
  expect(factory).not.toHaveBeenCalled();
  const short=new EventRelay(new SpeechPool([worker()],20),factory);await expect(short.start({...plan,targets:['a']})).rejects.toThrow('空きBOT');
 });
 it('同時開始は1件だけ。開始中の停止は遅れてできた接続も閉じてから返却する',async()=>{
  const wait=deferred(),transport=fakeTransport(),pool=new SpeechPool(Array.from({length:7},worker),20);
  vi.mocked(transport.start).mockReturnValue(wait.promise);const factory=vi.fn(()=>transport),relay=new EventRelay(pool,factory);
  const start=relay.start(plan);const rejected=expect(start).rejects.toThrow('中止');
  await expect(relay.start(plan)).rejects.toThrow('準備中');expect(factory).toHaveBeenCalledTimes(1);
  const stopping=relay.stop();expect(relay.status()?.phase).toBe('stopping');expect(await pool.start('other')).toBe('busy');
  wait.resolve();await stopping;await rejected;expect(transport.close).toHaveBeenCalledTimes(2);expect(relay.status()).toBeNull();
  expect(await pool.start('a')).toBe('started');pool.close();
 });
 it('接続失敗や停止処理のエラーでも予約を返却し、再開できる',async()=>{
  const pool=new SpeechPool(Array.from({length:7},worker),20),bad=fakeTransport(),good=fakeTransport();
  vi.mocked(bad.start).mockRejectedValue(Error('connect failed'));vi.mocked(bad.close).mockRejectedValue(Error('close failed'));
  const factory=vi.fn<RelayFactory>().mockReturnValueOnce(bad).mockReturnValue(good),relay=new EventRelay(pool,factory);
  await expect(relay.start(plan)).rejects.toThrow('connect failed');expect(relay.status()).toBeNull();await relay.start(plan);expect(relay.status()?.phase).toBe('active');await relay.stop();
 });
 it('無関係なBOTの切断で止めず、割り当てたBOTの切断では全体を停止する',async()=>{
  const transport=fakeTransport(),relay=new EventRelay(new SpeechPool(Array.from({length:7},worker),20),()=>transport);
  await relay.start(plan);relay.lostBot('other');expect(relay.status()?.phase).toBe('active');relay.lostBot('bot1');await relay.stop();expect(relay.status()).toBeNull();
 });
});
describe('保存しないライブ音声の混合',()=>{
 it('許可した話者だけ混ぜ、同時発声を平均して大音量でも飽和させない',()=>{
  const m=new RelayMixer();m.add('a');m.add('b');m.push('unknown',pcm(30000));m.push('a',pcm(30000));m.push('b',pcm(10000));
  expect(m.take().readInt16LE()).toBe(20000);expect(m.take()).toEqual(Buffer.alloc(RELAY_FRAME_BYTES));
  m.push('a',pcm(-32768));m.push('b',pcm(-32768));expect(m.take().readInt16LE()).toBe(-32768);
 });
 it('分割フレーム、最大120ms、退出/客席移動時の破棄を扱う',()=>{
  const m=new RelayMixer();m.add('a');const b=pcm(42);m.push('a',b.subarray(0,1920));expect(m.take().readInt16LE()).toBe(0);m.push('a',b.subarray(1920));expect(m.take()).toEqual(b);
  for(let i=1;i<=100;i++)m.push('a',pcm(i));expect(m.take().readInt16LE()).toBe(95);
  for(let i=96;i<=100;i++)expect(m.take().readInt16LE()).toBe(i);expect(m.take().readInt16LE()).toBe(0);
  m.push('a',b);m.remove('a');expect(m.take().readInt16LE()).toBe(0);
  m.add('a');m.push('a',b);m.clear();expect(m.take().readInt16LE()).toBe(0);
 });
 it('不正サイズ・過大フレームを捨て、話者数も有限にする',()=>{
  const m=new RelayMixer();for(let i=0;i<20;i++)m.add(String(i));m.add('0');expect(()=>m.add('21')).toThrow('20人');
  m.push('0',Buffer.alloc(3,255));m.push('0',Buffer.alloc(RELAY_FRAME_BYTES*7,255));expect(m.take()).toEqual(Buffer.alloc(RELAY_FRAME_BYTES));
 });
 it('実際のOpusで2話者を復号→混合→再符号化できる',()=>{
  const encoders=[0,1].map(()=>new OpusScript(48000,2,OpusScript.Application.AUDIO));
  const decoders=[0,1].map(()=>new OpusScript(48000,2,OpusScript.Application.AUDIO));
  const output=new OpusScript(48000,2,OpusScript.Application.AUDIO),receiver=new OpusScript(48000,2,OpusScript.Application.AUDIO),m=new RelayMixer();m.add('0');m.add('1');
  try {
   for(let n=0;n<5;n++){
    for(let user=0;user<2;user++){
     const b=Buffer.alloc(RELAY_FRAME_BYTES);for(let i=0;i<960;i++){const value=Math.round(8000*Math.sin(2*Math.PI*(user?660:440)*(i+n*960)/48000));b.writeInt16LE(value,i*4);b.writeInt16LE(value,i*4+2);}
     m.push(String(user),decoders[user]!.decode(encoders[user]!.encode(b,960)));
    }
    const mixed=m.take(),packet=output.encode(mixed,960),decoded=receiver.decode(packet);
    expect(decoded.length).toBe(RELAY_FRAME_BYTES);expect([...decoded].some(x=>x!==0)).toBe(true);
   }
  }finally{for(const c of [...encoders,...decoders,output,receiver])c.delete();}
 });
});
