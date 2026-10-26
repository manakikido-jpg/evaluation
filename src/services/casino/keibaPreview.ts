import { makeRace, seeded, simulate } from './keiba.js';
/** 映像確認用。実馬/銭/戦績には接続しない、固定種のサンプル。 */
export function createKeibaPreview() {
  const random = seeded(271026);
  const { race, horses } = makeRace(n => Math.floor(random() * n), 1, { name: '咲楽ノ宮 映像試走', dist: 1600, cls: 0 });
  race.surface = 0; race.weather = 0; race.going = 0;
  const names = ['サクラノミヤビ', 'ツキノカグラ', 'ハナアカリ', 'シロキツネ', 'ヨザクラノユメ', 'カミナリ', 'コマノカゼ', 'フジノヒカリ'];
  horses.forEach((h, i) => { h.name = names[i]!; h.coat = i % 6; });
  const sim = simulate(race, horses, seeded(72381), true);
  const frameMs = sim.frameSec! * 45_000 / Math.min(...sim.times);
  return { demo: true as const, race, horses: horses.map(h => ({ no: h.no, name: h.name, coat: h.coat, silk: h.silk })), frames: sim.frames!, lanes: sim.lanes!, frameMs, finishMs: sim.times.map(t => t * 45_000 / Math.min(...sim.times)), order: sim.order, durationMs: Math.max((sim.frames![0]!.length - 1) * frameMs, ...sim.times.map(t => t * 45_000 / Math.min(...sim.times))) + 2000 };
}
export type KeibaPreviewData = ReturnType<typeof createKeibaPreview>;
