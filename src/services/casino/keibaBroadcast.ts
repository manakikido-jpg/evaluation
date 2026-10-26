import { type KbState } from './tables/keiba.js';

/** 保存済みの走行だけを映像へ渡す。抽選や払戻はここでは行わない。 */
export function keibaBroadcast(s: KbState, tableId: number, now: number) {
  const run = s.run;
  if (s.phase === 'betting' || !run) return undefined;
  // 追加前の保存データは、表示用の時計から映像の到達時刻を復元する。
  const seconds = (text: string) => text.split(':').reduce((n, v) => n * 60 + Number(v), 0);
  const leader = seconds(run.times[0]!);
  const finishMs = run.finishMs ?? s.horses.map(h => seconds(run.times[run.order.indexOf(h.no)]!) / leader * run.showMs);
  const key = `${s.race.n}:${run.start}`;
  return {
    demo: false as const,
    race: s.race,
    horses: s.horses.map(h => ({ no: h.no, name: h.name, coat: h.coat, silk: h.silk, outfit:h.outfit })),
    frames: run.frames, lanes: run.lanes, frameMs: run.frameMs, finishMs, order: run.order,
    durationMs: Math.max((run.frames[0]!.length - 1) * run.frameMs, ...finishMs) + 2000,
    calls: run.calls,
    photoFinish: run.order.length>1 && Math.abs(finishMs[run.order[0]!-1]!-finishMs[run.order[1]!-1]!)*leader/run.showMs<.05,
    live: { key, start: run.start, now, confirmed: s.phase === 'result', url: `/casino/keiba/watch/${tableId}/state?race=${encodeURIComponent(key)}` },
    results: s.phase === 'result' ? run.order.map((no, i) => ({ no, time: run.times[i]!, margin: run.margins[i]! })) : [],
  };
}
