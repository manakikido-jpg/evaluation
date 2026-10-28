import {describe, expect, it} from 'vitest';
import {freshFloor, trialView} from '../src/services/casino/gaisen/trial.js';
import {lever, stop} from '../src/services/casino/gaisen/engine.js';
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
});
