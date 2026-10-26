/** 既存レースの1000=ゴール、lane/10=mという記録形式を読む。 */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function trackPoint(distance, lane = 0) {
  const s = ((distance % 2000) + 2000) % 2000, r = 400 / Math.PI + lane;
  if (s < 100) return { x: 200 + s, z: r };
  if (s < 500) { const a = Math.PI / 2 - (s - 100) * Math.PI / 400; return { x: 300 + r * Math.cos(a), z: r * Math.sin(a) }; }
  if (s < 1100) return { x: 300 - (s - 500), z: -r };
  if (s < 1500) { const a = -Math.PI / 2 - (s - 1100) * Math.PI / 400; return { x: -300 + r * Math.cos(a), z: r * Math.sin(a) }; }
  return { x: -300 + s - 1500, z: r };
}
export function sampleReplay(data, elapsed) {
  const ms = clamp(elapsed, 0, data.durationMs), k = ms / data.frameMs;
  const interpolate = rows => rows.map(values => {
    const a = Math.min(values.length - 1, Math.floor(k)), b = Math.min(values.length - 1, a + 1);
    return values[a] + (values[b] - values[a]) * (k - Math.floor(k));
  });
  const frames = interpolate(data.frames), lanes = interpolate(data.lanes), start = ((-data.race.dist % 2000) + 2000) % 2000;
  const positions = data.horses.map((h, i) => {
    const finished = ms >= data.finishMs[i];
    const progress = finished ? Math.max(1, frames[i] / 1000) : Math.min(.999999, frames[i] / 1000);
    const distance = start + progress * data.race.dist, lane = lanes[i] / 10;
    const point = trackPoint(distance, lane), next = trackPoint(distance + .1, lane);
    return { no: h.no, progress, lane, finished, x: point.x, z: point.z, heading: -Math.atan2(next.z - point.z, next.x - point.x) };
  });
  const order = [...positions].sort((a, b) => a.finished && b.finished ? data.order.indexOf(a.no) - data.order.indexOf(b.no) : a.finished ? -1 : b.finished ? 1 : b.progress - a.progress).map(p => p.no);
  return { positions, order, remaining: Math.max(0, Math.ceil(data.race.dist * (1 - Math.max(...positions.map(p => p.progress))))), complete: ms >= Math.max(...data.finishMs) };
}
