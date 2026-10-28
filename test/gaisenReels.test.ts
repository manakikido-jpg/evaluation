import {describe, expect, it} from 'vitest';
import {freshFloor, trialView} from '../src/services/casino/gaisen/trial.js';
import {lever, stop, ORDERS} from '../src/services/casino/gaisen/engine.js';
import {reelPresentation} from '../src/web/views/gaisenReels.js';

describe('神殿の3リール表示', () => {
  function fixture() {
    const floor = freshFloor(0);
    floor.machines[0]!.owner = 'sample';
    return {state: floor.machines[0]!.state, view: () => trialView(floor, 'sample').own!};
  }
  it('未停止の役が異なっても同じ回転帯を表示し、停止予定の結果を漏らさない', () => {
    const a = fixture(), b = fixture();
    lever(a.state, () => 0, 'god'); lever(b.state, () => 0, 'none');
    expect(reelPresentation(a.view())).toEqual(reelPresentation(b.view()));
    expect(reelPresentation(a.view()).every(r => r.spinning && r.strip.length === 18)).toBe(true);
  });
  it('右→左→中で押しても対応するリールだけ停止し、各停止窓に3段が残る', () => {
    const f = fixture(); lever(f.state, () => 0, 'red7');
    stop(f.state, 2, () => 0);
    const first = reelPresentation(f.view());
    expect(first.map(r => r.spinning)).toEqual([true, true, false]);
    expect(first[2]!.rows[1]).toBe('red7'); expect(first[2]!.strip).toHaveLength(3);
    stop(f.state, 0, () => 0);
    expect(reelPresentation(f.view()).map(r => r.spinning)).toEqual([false, true, false]);
    stop(f.state, 1, () => 0);
    expect(reelPresentation(f.view()).map(r => r.spinning)).toEqual([false, false, false]);
    expect(reelPresentation(f.view()).map(r => r.digit)).toEqual(['S','G','G']);
  });
  it('表示を作り直しても停止絵柄と試遊残高を変更しない', () => {
    const f = fixture(); lever(f.state, () => 0, 'replay'); stop(f.state, 0, () => 0);
    const before = structuredClone(f.state), shown = reelPresentation(f.view());
    expect(reelPresentation(structuredClone(f.view()))).toEqual(shown);
    expect(f.state).toEqual(before);
  });
  it('G-STOPのHOLDでは左右を停止済みとして扱い、数字演出を保持する', () => {
    const f = fixture(); f.state.phase = 'gstop'; f.state.hold = 'V';
    lever(f.state, () => 1, 'none');
    const reels = reelPresentation(f.view());
    expect(reels.map(r => r.spinning)).toEqual([false, true, false]);
    expect(reels.map(r => r.digit)).toEqual(['V','✦','V']);
  });
  it('黄7の全押し順36通りで、払出150のときだけ中段が揃い、停止済みの帯を変えない', () => {
    for (const expected of ORDERS) for (const actual of ORDERS) {
      const f = fixture(); lever(f.state, () => 0, 'bell'); f.state.pending!.order = [...expected];
      const stopped = new Map<number,string>();
      for (const index of actual) {
        stop(f.state, index, () => 1);
        const view = f.view();
        for (const [i,symbol] of stopped) expect(view.reels[i]).toBe(symbol);
        stopped.set(index, view.reels[index]!);
      }
      const match = actual.every((index,i) => index === expected[i]);
      expect(f.state.lastPaid).toBe(match ? 150 : 0);
      expect(reelPresentation(f.view()).every(r => r.rows[1] === 'gold7')).toBe(match);
      expect(f.state.balance).toBe(match ? 100120 : 99970);
      expect(reelPresentation(f.view())).toEqual(reelPresentation(structuredClone(f.view())));
    }
  });
  it('G-STOPで数字が揃っても下部にGODや金7の揃いを作らない', () => {
    const f = fixture(); f.state.phase='gstop'; f.state.gstopLeft=5;
    lever(f.state, () => 1, 'none');
    for (const i of [0,1,2]) stop(f.state,i,()=>0);
    expect(f.state.display).toEqual(['1','1','1']);
    expect(f.state.lastPaid).toBe(0);
    expect(f.view().reelPhase).toBe('gstop');
    expect(reelPresentation(f.view()).map(r=>r.rows[1])).toEqual(['blue7','crest','flower']);
  });
  it('G-STOPの鏡が変わっても停止済みの下部リールを変えない', () => {
    const f = fixture(); f.state.phase='gstop'; f.state.gstopLeft=5;
    lever(f.state, () => 0, 'none'); stop(f.state,0,()=>0);
    const left = f.view().reels[0]; stop(f.state,1,()=>1);
    expect(f.view().reels[0]).toBe(left);
  });
  it('旧保存の回転中と払出0の結果を、残高を書き換えずに表示する', () => {
    const f=fixture(); lever(f.state,()=>0,'bell'); stop(f.state,2,()=>1);
    const partial=structuredClone(f.state);
    expect(f.view().reels).toEqual([null,null,'青7']); expect(f.state).toEqual(partial);
    stop(f.state,0,()=>1); stop(f.state,1,()=>1);
    delete f.state.reelDisplay; delete f.state.reelPhase;
    const before=structuredClone(f.state);
    expect(reelPresentation(f.view()).every(r=>r.rows[1]==='gold7')).toBe(false);
    expect(f.state).toEqual(before);
  });
  it('リプレイ/赤7/GOD/3枚役の表示と従来の払出を保つ', () => {
    for(const [role,symbol,paid] of [['replay','blue7',30],['red7','red7',0],['god','god',150],['smallBell','crest',30]] as const){
      const f=fixture();lever(f.state,()=>0,role);for(const i of [0,1,2])stop(f.state,i,()=>1);
      expect(f.state.lastPaid).toBe(paid);expect(reelPresentation(f.view()).every(r=>r.rows[1]===symbol)).toBe(true);
    }
  });
});
