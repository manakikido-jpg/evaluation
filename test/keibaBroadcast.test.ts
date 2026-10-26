import { describe, expect, it } from 'vitest';
import { keibaBroadcast } from '../src/services/casino/keibaBroadcast.js';
// @ts-expect-error 実際のブラウザ用の再生制限を検証する。
import { replayLimit, sampleReplay } from '../src/web/public/keiba-replay.js';
import { broadcastFixture } from './keibaBroadcastFixture.js';
describe('保存した実レースの3D観戦',()=>{
  it('受付中は走行を作らず、保存した馬/コマ/到達時刻/着順を使う',()=>{
    const {betting,racing}=broadcastFixture(),before=structuredClone(racing);
    expect(keibaBroadcast(betting,7,0)).toBeUndefined();
    const d=keibaBroadcast(racing,7,racing.run!.start+1000)!;
    expect(d.demo).toBe(false);expect(d.frames).toEqual(racing.run!.frames);expect(d.finishMs).toEqual(racing.run!.finishMs);
    expect(d.order).toEqual(racing.run!.order);expect(d.race.dist).toBe(2400);expect(d.horses.map(h=>h.name)).toEqual(racing.horses.map(h=>h.name));
    expect(d.results).toEqual([]);expect(d.live.confirmed).toBe(false);expect(racing).toEqual(before);
    expect(sampleReplay(d,d.durationMs).order).toEqual(racing.run!.order);
  });
  it('確定後だけ時計と着差を出し、旧保存データも再抽選せず読める',()=>{
    const {racing}=broadcastFixture();racing.phase='result';delete racing.run!.finishMs;
    const d=keibaBroadcast(racing,7,0)!;
    expect(d.live.confirmed).toBe(true);expect(d.finishMs.every(Number.isFinite)).toBe(true);
    expect(Math.min(...d.finishMs)).toBeCloseTo(racing.run!.showMs);
    expect(d.results.map(r=>r.no)).toEqual(racing.run!.order);expect(d.results[0]!.time).toBe(racing.run!.times[0]);
  });
  it('時計の違う端末もサーバー時刻で制限し、確定前の未来に進めない',()=>{
    const {racing}=broadcastFixture(),d=keibaBroadcast(racing,7,0)!;
    expect(replayLimit(d,d.live.start-1000)).toBe(0);
    expect(replayLimit(d,d.live.start+2345)).toBe(2345);
    expect(replayLimit(d,d.live.start+1e9)).toBe(d.durationMs);
    d.live.confirmed=true;expect(replayLimit(d,d.live.start)).toBe(d.durationMs);
  });
});
