import type { CasinoGame } from '../../config.js';
import type { CasinoGameRow } from '../../db/schema.js';
import { CASINO_LABEL, type CasinoStat } from '../../services/casino/casino.js';
import { RANK_RANGES, type MyDay, type MyGame, type RankRange, type RankRow } from '../../services/casino/memberStats.js';
import { CasinoLayout, type CasinoMe } from './casino.js';

/**
 * 📊 カジノの記録（メンバーが見る）: 自分の成績・勝ち額ランキング・今日の人気・大当たり。
 * グラフはサーバーで作る SVG（JavaScript なし。値は <title> と表でも見られる）
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const gameName = (g: string) => `${CASINO_LABEL[g as CasinoGame]?.emoji ?? '🎲'} ${CASINO_LABEL[g as CasinoGame]?.name ?? g}`;
const Net = (p: { n: number }) => (p.n > 0 ? <b class="c-win">+{fmt(p.n)}</b> : p.n < 0 ? <b class="c-lose">{fmt(p.n)}</b> : <b class="c-even">±0</b>);

export type CasinoStatsProps = {
  me: CasinoMe;
  daily: MyDay[];
  games: MyGame[];
  best: CasinoGameRow[];
  range: RankRange;
  ranking: { top: RankRow[]; me?: RankRow; players: number };
  popular: CasinoStat[];
  bigWins: CasinoGameRow[];
  multipliers: CasinoGameRow[];
  names: Map<string, string>;
};

/** 日ごとの勝ち負けの棒（上が勝ち・下が負け） */
function NetBars(p: { days: MyDay[] }) {
  const W = 720;
  const H = 160;
  const mid = H / 2;
  const max = Math.max(1, ...p.days.map((d) => Math.abs(d.net)));
  const step = W / p.days.length;
  const bw = Math.max(2, step - 4);
  return (
    <svg class="c-chart" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="日ごとの勝ち負け（30 日）">
      <line class="c-chart-axis" x1="0" x2={String(W)} y1={String(mid)} y2={String(mid)} />
      {p.days.map((d, i) => {
        const h = Math.round((Math.abs(d.net) / max) * (mid - 6));
        const x = i * step + (step - bw) / 2;
        return (
          <g>
            <title>
              {d.date}: {signed(d.net)}（賭けた {fmt(d.wagered)}）
            </title>
            {/* 押しやすいように、見えない広い当たりを置く */}
            <rect class="c-chart-hit" x={x.toFixed(1)} y="0" width={step.toFixed(1)} height={String(H)} />
            {d.net !== 0 && <rect class={d.net > 0 ? 'c-chart-up' : 'c-chart-down'} x={x.toFixed(1)} y={String(d.net > 0 ? mid - h : mid)} width={bw.toFixed(1)} height={String(Math.max(1, h))} rx="2" />}
            {i % 5 === 0 && (
              <text class="c-chart-label" x={(x + bw / 2).toFixed(1)} y={String(H + 14)} text-anchor="middle">
                {md(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function CasinoStatsPage(p: CasinoStatsProps) {
  const name = (id: string) => (id === p.me.session.userId ? `${p.names.get(id) ?? 'あなた'}（あなた）` : (p.names.get(id) ?? 'だれか'));
  const total = p.daily.reduce((n, d) => n + d.net, 0);
  const wagered = p.daily.reduce((n, d) => n + d.wagered, 0);
  const today = p.daily.at(-1);
  const played = p.daily.filter((d) => d.net !== 0 || d.wagered > 0);
  return (
    <CasinoLayout title="記録" me={p.me} back>
      <h1 class="c-section">📊 カジノの記録</h1>

      <section class="c-panel">
        <h2>🙋 あなたの成績（30 日）</h2>
        <div class="c-stat-row">
          <div class="c-stat">
            <span class="c-muted">勝ち負け（30 日）</span>
            <Net n={total} />
          </div>
          <div class="c-stat">
            <span class="c-muted">今日</span>
            <Net n={today?.net ?? 0} />
          </div>
          <div class="c-stat">
            <span class="c-muted">賭けた合計（30 日）</span>
            <b>{fmt(wagered)}</b>
          </div>
        </div>
        {played.length === 0 ? (
          <p class="c-muted">この 30 日はまだ遊んでいません。</p>
        ) : (
          <>
            <NetBars days={p.daily} />
            <p class="c-muted c-note">上は勝った日、下は負けた日。棒に指を置く（マウスを乗せる）と、その日の数字が出ます。</p>
            <details class="c-details">
              <summary>日ごとの表で見る</summary>
              <table class="c-stable">
                <thead>
                  <tr>
                    <th>日</th>
                    <th class="num">勝ち負け</th>
                    <th class="num">賭けた</th>
                  </tr>
                </thead>
                <tbody>
                  {[...played].reverse().map((d) => (
                    <tr>
                      <td>{d.date}</td>
                      <td class="num">
                        <Net n={d.net} />
                      </td>
                      <td class="num">{fmt(d.wagered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <div class="c-two">
        <section class="c-panel">
          <h2>🎲 ゲームごと（30 日）</h2>
          {p.games.length === 0 ? (
            <p class="c-muted">まだありません。</p>
          ) : (
            <ul class="c-list">
              {p.games.map((g) => (
                <li>
                  <span>
                    {gameName(g.game)}
                    <small class="c-muted">
                      {' '}
                      {g.plays > 0 ? `${fmt(g.plays)} 回・` : ''}賭けた {fmt(g.wagered)}
                    </small>
                  </span>
                  <Net n={g.net} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="c-panel">
          <h2>✨ あなたのいちばんの当たり</h2>
          {p.best.length === 0 ? (
            <p class="c-muted">まだありません。</p>
          ) : (
            <ul class="c-list">
              {p.best.map((g) => (
                <li>
                  <span>
                    {gameName(g.game)}
                    <small class="c-muted">
                      {' '}
                      {fmt(g.bet)} → {fmt(g.payout)}
                      {g.bet > 0 ? `（×${(g.payout / g.bet).toFixed(1)}）` : ''}
                    </small>
                  </span>
                  <b class="c-win">+{fmt(g.payout - g.bet)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section class="c-panel">
        <h2>🏆 勝ち額ランキング（{RANK_RANGES[p.range]}）</h2>
        <nav class="c-tabs" aria-label="期間">
          {(Object.keys(RANK_RANGES) as RankRange[]).map((r) => (
            <a href={`/casino/stats?r=${r}`} class={r === p.range ? 'on' : ''} aria-current={r === p.range ? 'page' : undefined}>
              {RANK_RANGES[r]}
            </a>
          ))}
        </nav>
        {p.ranking.top.length === 0 ? (
          <p class="c-muted">まだ勝ち越した人はいません。</p>
        ) : (
          <ol class="c-list c-ranking">
            {p.ranking.top.map((r) => (
              <li class={r.memberId === p.me.session.userId ? 'me' : ''}>
                <span>
                  <b class="c-rank-no">{r.rank}</b> {name(r.memberId)}
                </span>
                <b class="c-win">+{fmt(r.net)}</b>
              </li>
            ))}
          </ol>
        )}
        <p class="c-muted c-note">
          {p.ranking.me
            ? `あなたは ${p.ranking.players} 人中 ${p.ranking.me.rank} 位（${signed(p.ranking.me.net)}）。`
            : `${RANK_RANGES[p.range]}はまだ遊んでいません（遊んだ人 ${p.ranking.players} 人）。`}
          勝ち負けは、賭けた銭と戻った銭の差です（どのゲームも合わせて）。
        </p>
      </section>

      <div class="c-two">
        <section class="c-panel">
          <h2>🔥 今日の人気</h2>
          {p.popular.length === 0 ? (
            <p class="c-muted">今日はまだだれも遊んでいません。</p>
          ) : (
            <ul class="c-list">
              {p.popular.map((s) => (
                <li>
                  <span>{gameName(s.game)}</span>
                  <span class="c-muted">
                    {fmt(s.players)} 人・{fmt(s.plays)} 回
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="c-panel">
          <h2>🎉 大当たり（7 日・大きい順）</h2>
          {p.bigWins.length === 0 ? (
            <p class="c-muted">まだありません。最初の大当たりはあなたかも。</p>
          ) : (
            <ul class="c-list">
              {p.bigWins.map((w) => (
                <li>
                  <span>
                    {CASINO_LABEL[w.game as CasinoGame]?.emoji} {name(w.memberId)}
                    <small class="c-muted"> ×{w.bet > 0 ? (w.payout / w.bet).toFixed(1) : '—'}</small>
                  </span>
                  <b class="c-win">+{fmt(w.payout - w.bet)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section class="c-panel">
        <h2>💥 高い倍率の当たり（30 日）</h2>
        {p.multipliers.length === 0 ? (
          <p class="c-muted">賭けの 10 倍以上の当たりは、まだありません。</p>
        ) : (
          <ul class="c-list">
            {p.multipliers.map((w) => (
              <li>
                <span>
                  {gameName(w.game)} ・ {name(w.memberId)}
                  <small class="c-muted">
                    {' '}
                    {fmt(w.bet)} → {fmt(w.payout)}
                  </small>
                </span>
                <b class="c-win">×{(w.payout / w.bet).toFixed(1)}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CasinoLayout>
  );
}
