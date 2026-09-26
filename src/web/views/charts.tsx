/**
 * 管理画面のグラフ（サーバーで SVG を作る。JavaScript なし）。
 * 色は style.css の --series-1・--series-2（ライト・ダークそれぞれ色覚の多様性を確かめ済み）。
 * 各区切りにマウスを乗せると値が出る（<title>）。同じ数字は「表で見る」にも出す。
 */

export type ChartPoint = { label: string; title: string };

const W = 720;
const H = 220;
const M = { top: 16, right: 56, bottom: 28, left: 48 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** CSS が読めなかったとき（古い CSS が残っているときなど）の色。ふだんは style.css の色が上書きする */
const C = { s1: '#c8102e', s2: '#2a78d6', grid: '#eadfe1', muted: '#7a6d71' };

/** 0 から max までのきりのよい目盛り */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  // 目盛りが 5 本以下になる、いちばん細かい 1・2・5 の刻み
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw)!;
  const stepInt = Math.max(1, step);
  const top = Math.ceil(max / stepInt) * stepInt;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += stepInt) out.push(Math.round(v * 100) / 100 || 0);
  return out;
}

/** 目盛りの名前は重ならないよう間引く（最後は必ず出す） */
function XLabels(props: { points: ChartPoint[]; x: (i: number) => number }) {
  const n = props.points.length;
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <g class="xlabels">
      {props.points.map((p, i) =>
        (n - 1 - i) % every === 0 ? (
          <text x={props.x(i)} y={H - 8} text-anchor="middle" fill={C.muted} font-size="12">
            {p.label}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** 角の丸い棒（データの端だけ 4px 丸く、根元は四角） */
function barPath(x: number, w: number, base: number, end: number): string {
  const h = Math.abs(base - end);
  const r = Math.min(4, w / 2, h);
  if (end <= base) {
    return `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + r}V${base}Z`;
  }
  return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`;
}

/** 折れ線（1 系列）。人数の推移など */
export function LineChart(props: { points: ChartPoint[]; values: number[]; unit: string; label: string }) {
  const { points, values } = props;
  const n = points.length;
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks.at(-1)!;
  const band = PW / n;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PH - (v / top) * PH;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const last = values.at(-1) ?? 0;
  return (
    <div class="chart-wrap">
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${props.label}。最新 ${fmt(last)}${props.unit}`}>
        {ticks.map((t) => (
          <g>
            <line class="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text class="ytick" x={M.left - 8} y={y(t) + 4} text-anchor="end" fill={C.muted} font-size="12">
              {fmt(t)}
            </text>
          </g>
        ))}
        <path class="area s1" d={area} fill={C.s1} fill-opacity="0.1" />
        <path class="line s1" d={line} fill="none" stroke={C.s1} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle class="dot s1" cx={x(n - 1)} cy={y(last)} r={4} fill={C.s1} />
        <text class="endlabel" x={x(n - 1) + 10} y={y(last) + 4} fill={C.muted} font-size="12">
          {fmt(last)}
          {props.unit}
        </text>
        <XLabels points={points} x={x} />
        {points.map((p, i) => (
          <rect class="hit" x={M.left + band * i} y={M.top} width={band} height={PH} fill="transparent">
            <title>{`${p.title}: ${fmt(values[i]!)}${props.unit}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/**
 * 縦棒。down を渡すと、up を上・down を下に伸ばす（入った／抜けた）。
 * 軸は 1 本（上下で同じ目盛り）。
 */
export function ColumnChart(props: {
  points: ChartPoint[];
  up: { name: string; values: number[] };
  down?: { name: string; values: number[] };
  unit: string;
  label: string;
  /** 値の見せ方（通話の「時間」など） */
  format?: (v: number) => string;
}) {
  const { points, up, down } = props;
  const f = props.format ?? fmt;
  const n = points.length;
  const upTicks = niceTicks(Math.max(...up.values, 0));
  const downMax = down ? Math.max(...down.values, 0) : 0;
  // 上下で同じ目盛りの幅にする
  const step = upTicks[1]! - upTicks[0]!;
  const downTop = down ? Math.max(step, Math.ceil(downMax / step) * step) : 0;
  const upTop = upTicks.at(-1)!;
  const span = upTop + downTop;
  const band = PW / n;
  const w = Math.min(24, band * 0.6);
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + ((upTop - v) / span) * PH;
  const ticks: number[] = [];
  for (let v = -downTop; v <= upTop + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100 || 0);
  return (
    <div class="chart-wrap">
      {down && (
        <p class="legend">
          <span class="key">
            <i class="swatch s1" />
            {up.name}
          </span>
          <span class="key">
            <i class="swatch s2" />
            {down.name}
          </span>
        </p>
      )}
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label}>
        {ticks.map((t) => (
          <g>
            <line class={t === 0 ? 'base' : 'grid'} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.muted : C.grid} />
            <text class="ytick" x={M.left - 8} y={y(t) + 4} text-anchor="end" fill={C.muted} font-size="12">
              {t > 0 && down ? `+${f(t)}` : t < 0 ? `−${f(-t)}` : f(t)}
            </text>
          </g>
        ))}
        {up.values.map((v, i) => (v > 0 ? <path class="bar s1" d={barPath(x(i) - w / 2, w, y(0), y(v))} fill={C.s1} /> : null))}
        {down?.values.map((v, i) => (v > 0 ? <path class="bar s2" d={barPath(x(i) - w / 2, w, y(0), y(-v))} fill={C.s2} /> : null))}
        <XLabels points={points} x={x} />
        {points.map((p, i) => (
          <rect class="hit" x={M.left + band * i} y={M.top} width={band} height={PH} fill="transparent">
            <title>{`${p.title}: ${up.name} ${f(up.values[i]!)}${props.unit}${down ? ` ／ ${down.name} ${f(down.values[i]!)}${props.unit}` : ''}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
