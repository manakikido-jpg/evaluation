/**
 * 管理画面のグラフ（サーバーで SVG を作る。JavaScript なし）。
 * 色は style.css の --series-1・--series-2（ライト・ダークそれぞれ色覚の多様性を確かめ済み）。
 * 各区切りにマウスを乗せると値が出る（charts.js のカード。JavaScript がなければ <title>）。同じ数字は「表で見る」にも出す。
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

/** マウスを乗せたときのカード（charts.js）: 1 行目が見出し、あとは 1 行ずつ */
const tip = (head: string, lines: string[]) => [head, ...lines].join('\n');

/** 7 日の平均など、棒に重ねる線（null は線を切る） */
export type AvgLine = { name: string; values: (number | null)[] };

/** 平均の線（棒の上に重ねる） */
function AvgPath(props: { avg?: AvgLine; x: (i: number) => number; y: (v: number) => number }) {
  if (!props.avg) return null;
  let d = '';
  let pen = false;
  props.avg.values.forEach((v, i) => {
    if (v === null || v === undefined) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${props.x(i).toFixed(1)},${props.y(v).toFixed(1)}`;
    pen = true;
  });
  return <path class="avgline" d={d} fill="none" stroke={C.muted} stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" />;
}

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
          <rect class="hit" x={M.left + band * i} y={M.top} width={band} height={PH} fill="transparent" data-tip={tip(p.title, [`${fmt(values[i]!)}${props.unit}`])}>
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
  /** 上の棒に重ねる平均の線 */
  avg?: AvgLine;
}) {
  const { points, up, down } = props;
  const f = props.format ?? fmt;
  const n = points.length;
  const upTicks = niceTicks(Math.max(...up.values, ...(props.avg?.values.filter((v): v is number => v !== null) ?? []), 0));
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
      {(down || props.avg) && (
        <p class="legend">
          <span class="key">
            <i class="swatch s1" />
            {up.name}
          </span>
          {down && (
            <span class="key">
              <i class="swatch s2" />
              {down.name}
            </span>
          )}
          {props.avg && (
            <span class="key">
              <i class="swatch avg" />
              {props.avg.name}
            </span>
          )}
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
        <AvgPath avg={props.avg} x={x} y={y} />
        <XLabels points={points} x={x} />
        {points.map((p, i) => (
          <rect
            class="hit"
            x={M.left + band * i}
            y={M.top}
            width={band}
            height={PH}
            fill="transparent"
            data-tip={tip(p.title, [`${up.name} ${f(up.values[i]!)}${props.unit}`, ...(down ? [`${down.name} ${f(down.values[i]!)}${props.unit}`] : []), ...(props.avg && props.avg.values[i] != null ? [`${props.avg.name} ${f(props.avg.values[i]!)}${props.unit}`] : [])])}
          >
            <title>{`${p.title}: ${up.name} ${f(up.values[i]!)}${props.unit}${down ? ` ／ ${down.name} ${f(down.values[i]!)}${props.unit}` : ''}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/**
 * 横棒（1 系列）。カテゴリごとの時間など、名前が長いものの比べっこに。
 * 名前は左、値は棒の先に（文字の色で）。
 */
export function BarList(props: { rows: { name: string; value: number }[]; unit: string; label: string; format?: (v: number) => string }) {
  const f = props.format ?? fmt;
  const rows = props.rows;
  const ROW = 28;
  const L = 170;
  const R = 110;
  const top = Math.max(...rows.map((r) => r.value), 0) || 1;
  const h = ROW * rows.length + 8;
  const bw = W - L - R;
  const bar = 14;
  return (
    <div class="chart-wrap">
      <svg class="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={props.label}>
        {rows.map((r, i) => {
          const y = 4 + i * ROW + (ROW - bar) / 2;
          const len = Math.max(r.value > 0 ? 2 : 0, (r.value / top) * bw);
          const rr = Math.min(4, bar / 2, len);
          const d = len
            ? `M${L},${y}H${L + len - rr}Q${L + len},${y} ${L + len},${y + rr}V${y + bar - rr}Q${L + len},${y + bar} ${L + len - rr},${y + bar}H${L}Z`
            : '';
          return (
            <g>
              <text x={L - 8} y={y + bar - 3} text-anchor="end" fill={C.muted} font-size="12">
                {r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name}
              </text>
              {d && <path class="bar s1" d={d} fill={C.s1} />}
              <text class="barvalue" x={L + len + 6} y={y + bar - 3} fill={C.muted} font-size="12">
                {f(r.value)}
                {props.unit}
              </text>
              <rect class="hit" x={0} y={4 + i * ROW} width={W} height={ROW} fill="transparent" data-tip={tip(r.name, [`${f(r.value)}${props.unit}`])}>
                <title>{`${r.name}: ${f(r.value)}${props.unit}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** 系列の色（s1・s2・s3）。s3 は「不明」などの灰色 */
const SC: Record<string, string> = { s1: C.s1, s2: C.s2, s3: C.muted };
export type Series = { name: string; cls: 's1' | 's2' | 's3'; values: number[] };

function Legend(props: { series: { name: string; cls: string }[] }) {
  return (
    <p class="legend">
      {props.series.map((s) => (
        <span class="key">
          <i class={`swatch ${s.cls}`} />
          {s.name}
        </span>
      ))}
    </p>
  );
}

/** 積み上げの縦棒（入った人の男性・女性・不明など）。区切りの合計を棒の上に出す */
export function StackedColumnChart(props: { points: ChartPoint[]; series: Series[]; unit: string; label: string; avg?: AvgLine }) {
  const { points, series } = props;
  const n = points.length;
  const totals = points.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, ...(props.avg?.values.filter((v): v is number => v !== null) ?? []), 0));
  const top = ticks.at(-1)!;
  const band = PW / n;
  const w = Math.min(24, band * 0.6);
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PH - (v / top) * PH;
  return (
    <div class="chart-wrap">
      <Legend series={props.avg ? [...series, { name: props.avg.name, cls: 'avg' }] : series} />
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label}>
        {ticks.map((t) => (
          <g>
            <line class={t === 0 ? 'base' : 'grid'} x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.muted : C.grid} />
            <text class="ytick" x={M.left - 8} y={y(t) + 4} text-anchor="end" fill={C.muted} font-size="12">
              {fmt(t)}
            </text>
          </g>
        ))}
        {points.map((_, i) => {
          let base = 0;
          const segs = series.map((s, k) => {
            const v = s.values[i] ?? 0;
            const from = base;
            base += v;
            if (v <= 0) return null;
            // いちばん上の段だけ角を丸く。段のあいだは 2px あける
            const isTop = series.slice(k + 1).every((r) => (r.values[i] ?? 0) <= 0);
            const y0 = y(from) - (from > 0 ? 1 : 0);
            const y1 = y(base) + (isTop ? 0 : 1);
            if (y0 - y1 < 0.5) return null;
            const d = isTop ? barPath(x(i) - w / 2, w, y0, y1) : `M${x(i) - w / 2},${y0}V${y1}H${x(i) + w / 2}V${y0}Z`;
            return <path class={`bar ${s.cls}`} d={d} fill={SC[s.cls]} />;
          });
          return <g>{segs}</g>;
        })}
        <AvgPath avg={props.avg} x={x} y={y} />
        <XLabels points={points} x={x} />
        {points.map((p, i) => (
          <rect
            class="hit"
            x={M.left + band * i}
            y={M.top}
            width={band}
            height={PH}
            fill="transparent"
            data-tip={tip(p.title, [`合計 ${fmt(totals[i]!)}${props.unit}`, ...series.map((s) => `${s.name} ${fmt(s.values[i] ?? 0)}${props.unit}${totals[i] ? `（${Math.round(((s.values[i] ?? 0) / totals[i]!) * 100)}%）` : ''}`), ...(props.avg && props.avg.values[i] != null ? [`${props.avg.name} ${fmt(props.avg.values[i]!)}${props.unit}`] : [])])}
          >
            <title>{`${p.title}: 合計 ${fmt(totals[i]!)}${props.unit}（${series.map((s) => `${s.name} ${fmt(s.values[i] ?? 0)}`).join('・')}）`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** 折れ線（いくつかの系列。null は線を切る）。割合（%）の推移など */
export function MultiLineChart(props: { points: ChartPoint[]; series: { name: string; cls: 's1' | 's2' | 's3'; values: (number | null)[] }[]; unit: string; label: string; max?: number; format?: (v: number) => string }) {
  const { points, series } = props;
  const f = props.format ?? fmt;
  const n = points.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const ticks = props.max !== undefined ? [0, props.max / 4, props.max / 2, (props.max * 3) / 4, props.max] : niceTicks(Math.max(...all, 0));
  const top = ticks.at(-1)!;
  const band = PW / n;
  const x = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PH - (v / top) * PH;
  const pathOf = (vals: (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return (
    <div class="chart-wrap">
      <Legend series={series} />
      <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label}>
        {ticks.map((t) => (
          <g>
            <line class="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text class="ytick" x={M.left - 8} y={y(t) + 4} text-anchor="end" fill={C.muted} font-size="12">
              {f(t)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const lastI = s.values.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
          return (
            <g>
              <path class={`line ${s.cls}`} d={pathOf(s.values)} fill="none" stroke={SC[s.cls]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              {lastI >= 0 && (
                <>
                  <circle class={`dot ${s.cls}`} cx={x(lastI)} cy={y(s.values[lastI]!)} r={4} fill={SC[s.cls]} />
                  <text class="endlabel" x={x(lastI) + 8} y={y(s.values[lastI]!) + 4} fill={C.muted} font-size="12">
                    {f(s.values[lastI]!)}
                    {props.unit}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <XLabels points={points} x={x} />
        {points.map((p, i) => (
          <rect class="hit" x={M.left + band * i} y={M.top} width={band} height={PH} fill="transparent" data-tip={tip(p.title, series.map((s) => `${s.name} ${s.values[i] === null ? '—' : `${f(s.values[i]!)}${props.unit}`}`))}>
            <title>{`${p.title}: ${series.map((s) => `${s.name} ${s.values[i] === null ? '—' : `${f(s.values[i]!)}${props.unit}`}`).join('・')}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** 100% の横棒（行ごと: 男性・女性・不明の割合）。人数と % は文字で横に出す */
export function ShareBars(props: { rows: { name: string; unit?: string; parts: { name: string; cls: 's1' | 's2' | 's3'; value: number }[] }[]; label: string }) {
  const ROW = 34;
  const L = 150;
  const R = 230;
  const bw = W - L - R;
  const bar = 16;
  const h = ROW * props.rows.length + 8;
  const legend = props.rows[0]?.parts.map((p) => ({ name: p.name, cls: p.cls })) ?? [];
  return (
    <div class="chart-wrap">
      <Legend series={legend} />
      <svg class="chart" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={props.label}>
        {props.rows.map((r, i) => {
          const total = r.parts.reduce((s, p) => s + p.value, 0);
          const y = 4 + i * ROW + (ROW - bar) / 2;
          let at = L;
          const text = r.parts
            .filter((p) => p.value > 0)
            .map((p) => `${p.name} ${fmt(p.value)}（${Math.round((p.value / (total || 1)) * 100)}%）`)
            .join(' ');
          return (
            <g>
              <text x={L - 8} y={y + bar - 3} text-anchor="end" fill={C.muted} font-size="12">
                {r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name}
              </text>
              {total > 0 &&
                r.parts.map((p) => {
                  const len = (p.value / total) * bw;
                  const x0 = at;
                  at += len;
                  return len >= 1 ? <rect class={`bar ${p.cls}`} x={x0 + (x0 > L ? 1 : 0)} y={y} width={Math.max(0.5, len - (x0 > L ? 1 : 0))} height={bar} rx={2} fill={SC[p.cls]} /> : null;
                })}
              <text class="barvalue" x={L + bw + 8} y={y + bar - 3} fill={C.muted} font-size="12">
                {fmt(total)}
                {r.unit ?? '人'}
                {total > 0 &&
                  r.parts
                    .filter((p) => p.cls !== 's3')
                    .map((p) => `・${p.name.slice(0, 1)} ${Math.round((p.value / total) * 100)}%`)
                    .join('')}
              </text>
              <rect class="hit" x={0} y={4 + i * ROW} width={W} height={ROW} fill="transparent" data-tip={tip(r.name, [`合計 ${fmt(total)}${r.unit ?? '人'}`, ...r.parts.map((p) => `${p.name} ${fmt(p.value)}${r.unit ?? '人'}（${Math.round((p.value / (total || 1)) * 100)}%）`)])}>
                <title>{`${r.name}: ${text || 'なし'}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * ヒートマップ（曜日 × 時など）。濃いほど多い（1 色の濃淡）。数字はマウスを乗せると出る。
 * rows: 行の名前 / cols: 列の名前（間引いて出す）
 */
export function Heatmap(props: { rows: string[]; cols: string[]; values: number[][]; unit: string; label: string; format?: (v: number) => string }) {
  const f = props.format ?? fmt;
  const L = 40;
  const T = 8;
  const cw = (W - L - 8) / props.cols.length;
  const ch = 24;
  const h = T + ch * props.rows.length + 24;
  const max = Math.max(...props.values.flat(), 0) || 1;
  // 薄い色でも見えるように 0.08〜1
  const op = (v: number) => (v <= 0 ? 0 : 0.08 + 0.92 * (v / max));
  return (
    <div class="chart-wrap">
      <svg class="chart heat" viewBox={`0 0 ${W} ${h}`} role="img" aria-label={props.label}>
        {props.rows.map((r, i) => (
          <g>
            <text x={L - 8} y={T + ch * i + ch / 2 + 4} text-anchor="end" fill={C.muted} font-size="12">
              {r}
            </text>
            {props.cols.map((c, j) => {
              const v = props.values[i]?.[j] ?? 0;
              return (
                <rect class="cell" x={L + cw * j + 1} y={T + ch * i + 1} width={cw - 2} height={ch - 2} rx={3} fill={C.s1} fill-opacity={op(v)} data-tip={tip(`${r}曜 ${c}台`, [`${f(v)}${props.unit}`])}>
                  <title>{`${r} ${c}: ${f(v)}${props.unit}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
        {props.cols.map((c, j) =>
          j % 3 === 0 ? (
            <text x={L + cw * j + cw / 2} y={h - 8} text-anchor="middle" fill={C.muted} font-size="12">
              {c}
            </text>
          ) : null,
        )}
      </svg>
      <p class="legend heat-legend">
        少ない <span class="heat-scale" aria-hidden="true" /> 多い（いちばん多いところ {f(max)}
        {props.unit}）
      </p>
    </div>
  );
}
