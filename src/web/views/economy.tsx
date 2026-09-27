import type { GuildConfig } from '../../config.js';
import type { AdminSession, CoinTx } from '../../db/schema.js';
import { COIN_REASON_LABEL } from '../../services/economy.js';
import { flowOf, type Distribution, type EconomyOverview, type FlowLine } from '../../services/economyStats.js';
import { TREND_RANGES, type TrendRange } from '../../services/stats.js';
import { fmtDateTime } from '../format.js';
import { ColumnChart, LineChart } from './charts.js';
import { Layout } from './layout.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');

const FLOW_LABEL = { issue: '配った', income: '鯖の収入', admin: '運営の調整', transfer: 'メンバー間' } as const;

export function EconomyPage(props: {
  session: AdminSession;
  cfg: GuildConfig;
  range: TrendRange;
  overview: EconomyOverview;
  dist: Distribution;
  big: CoinTx[];
  sales: { itemId: number; name: string; count: number; total: number }[];
  names: Map<string, string>;
}) {
  const { overview: o, dist: d, cfg } = props;
  const e = cfg.economy;
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const points = o.buckets.map((b) => ({ label: b.label, title: b.title }));
  const who = (id: string) => <a href={`/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const guji = props.session.level === 'guji';
  return (
    <Layout title="経済" session={props.session} nav="economy">
      <h1>経済（{coin}の流れ）</h1>
      <p class="note">
        鯖の中の{e.currencyName}が、どこから出て（配った）、どこに使われて戻ったか（鯖の収入）をまとめています。{e.currencyName}は鯖の中だけのもので、本物のお金では買えません。日付は日本時間です。
      </p>
      <nav class="tabs" aria-label="期間">
        {(Object.keys(TREND_RANGES) as TrendRange[]).map((r) => (
          <a href={`/economy?range=${r}`} class={r === props.range ? 'on' : ''} aria-current={r === props.range ? 'page' : undefined}>
            {TREND_RANGES[r].label}
          </a>
        ))}
      </nav>

      <div class="stats">
        <Stat label={`いま出回っている${e.currencyName}`} value={fmt(o.supply)} unit="枚" />
        <Stat label="この期間に配った" value={fmt(o.issued)} unit="枚" />
        <Stat label="この期間の鯖の収入" value={fmt(o.income)} unit="枚" />
        <Stat label="出回る量の増減" value={signed(o.net)} unit="枚" />
      </div>
      <p class={o.issued > 0 && o.income / o.issued < 0.5 ? 'flash warn' : 'note'}>
        {o.issued === 0
          ? 'この期間はまだ配っていません。'
          : `配った量のうち ${pct(o.income, o.issued)} が鯖の収入として戻っています。`}
        {o.issued > 0 && o.income / o.issued < 0.5
          ? ` 戻る量が少ないと${e.currencyName}が余っていき、物の値打ちが下がります（インフレ）。授与品・物御籤の値段を上げる、配る量を減らす、などを考えてください。`
          : ''}
      </p>

      <section class="card">
        <h2>出回っている{e.currencyName}の量</h2>
        <p class="note">各区切りの終わりに、メンバーが持っていた{e.currencyName}の合計です。</p>
        <LineChart points={points} values={o.buckets.map((b) => b.supply)} unit="枚" label={`出回っている${e.currencyName}の量の推移`} />
      </section>

      <section class="card">
        <h2>配った（上）と鯖の収入（下）</h2>
        <ColumnChart
          points={points}
          up={{ name: '配った', values: o.buckets.map((b) => Math.max(0, b.issued)) }}
          down={{ name: '鯖の収入', values: o.buckets.map((b) => Math.max(0, b.income)) }}
          unit="枚"
          label="配った銭（上）と鯖の収入（下）"
        />
      </section>

      <div class="grid2">
        <section class="card">
          <h2>💴 鯖の収入の内訳</h2>
          <FlowTable lines={o.incomeLines} total={o.income} empty="この期間の収入はありません。" />
          <p class="note">払い戻した分は引いてあります。市場は売り買いの差（手数料）だけが収入です。</p>
        </section>
        <section class="card">
          <h2>🎁 配った内訳</h2>
          <FlowTable lines={o.issueLines} total={o.issued} empty="この期間に配ったものはありません。" />
        </section>
      </div>

      <div class="grid2">
        <section class="card">
          <h2>🛠 運営の調整</h2>
          <FlowTable lines={o.adminLines} total={o.admin} empty="この期間の調整はありません。" signedTotal />
          <p class="note">
            管理画面から送った・減らした分（{guji ? <a href="/settings">設定</a> : '設定'}の「みんなに送る」、物御籤の「🎁 全員にプレゼント」の{e.currencyName}、メンバーのページ）。
          </p>
        </section>
        <section class="card">
          <h2>🤝 メンバー間の行き来</h2>
          <table class="compact">
            <tbody>
              <tr>
                <td>贈り物で贈られた</td>
                <td class="num">{fmt(o.giftVolume)} 枚</td>
              </tr>
              <tr>
                <td>市場で売れた（手数料を引いた額）</td>
                <td class="num">{fmt(Math.max(0, o.marketVolume))} 枚</td>
              </tr>
            </tbody>
          </table>
          <p class="note">人から人へ動くだけなので、出回る量は変わりません（市場の手数料だけ鯖の収入）。</p>
        </section>
      </div>

      <section class="card">
        <h2>👛 持っている量のかたより</h2>
        <div class="stats">
          <Stat label="持っている人" value={fmt(d.holders)} unit="人" />
          <Stat label="平均" value={fmt(d.average)} unit="枚" />
          <Stat label="まん中の人（中央値）" value={fmt(d.median)} unit="枚" />
          <Stat label="上位 10% が持つ割合" value={pct(d.top10Share, 1)} unit="" />
        </div>
        <p class={d.gini >= 0.6 ? 'flash warn' : 'note'}>
          かたより（ジニ係数）: <strong>{d.gini}</strong>（0 = みんな同じ、1 = 1 人が全部）。
          {d.gini >= 0.6 ? '一部の人に集まっています。新しい人が追いつけるよう、配る量やイベントを考えてください。' : ''}
          平均より中央値がずっと小さいときは、少数の人がたくさん持っています。
        </p>
        <div class="grid2">
          <table class="compact">
            <thead>
              <tr>
                <th>持っている量</th>
                <th class="num">人数</th>
                <th class="num">合計</th>
              </tr>
            </thead>
            <tbody>
              {d.bands.map((b) => (
                <tr>
                  <td>{b.label}</td>
                  <td class="num">{fmt(b.members)}</td>
                  <td class="num">{fmt(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table class="compact">
            <thead>
              <tr>
                <th>多く持っている人</th>
                <th class="num">いま</th>
                <th class="num">これまでに貯めた</th>
              </tr>
            </thead>
            <tbody>
              {d.top.map((t) => (
                <tr>
                  <td>{who(t.memberId)}</td>
                  <td class="num">{fmt(t.balance)}</td>
                  <td class="num">{fmt(t.lifetimeEarned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid2">
        <section class="card">
          <h2>🏮 よく受けられた授与品</h2>
          {props.sales.length === 0 ? (
            <p class="empty">この期間はありません。</p>
          ) : (
            <table class="compact">
              <thead>
                <tr>
                  <th>品</th>
                  <th class="num">数</th>
                  <th class="num">{e.currencyName}</th>
                </tr>
              </thead>
              <tbody>
                {props.sales.map((s) => (
                  <tr>
                    <td>{s.name}</td>
                    <td class="num">{fmt(s.count)}</td>
                    <td class="num">{fmt(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section class="card">
          <h2>⚙ いまの値段・配る量</h2>
          <table class="compact">
            <tbody>
              <Row k="通話 10 分ごと" v={`${fmt(e.voicePer10Min)} 枚（1 日 ${fmt(e.voiceDailyCap)} 枚まで）`} />
              <Row k="朱印を押す／頂く" v={`${fmt(e.shuinGive)} ／ ${fmt(e.shuinReceive)} 枚`} />
              <Row k="初期配布" v={`${fmt(e.joinBonus)} 枚`} />
              <Row k="招待のお礼" v={`${fmt(e.inviteReward)} 枚`} />
              <Row k="免罪符" v={`${fmt(e.menzaifuPrice)} 枚`} />
              <Row k="物御籤" v={cfg.gacha.enabled ? `1 回 ${fmt(cfg.gacha.price)} 枚` : '止めている'} />
              <Row k="市場の手数料" v={`${cfg.market.feePercent}%`} />
              <Row k="贈り物" v={`1 回 ${fmt(e.giftMin)}〜${fmt(e.giftMax)} 枚・1 日 ${fmt(e.giftDailyLimit)} 枚まで`} />
            </tbody>
          </table>
          {guji && (
            <p>
              <a href="/settings">設定で変える →</a> ／ <a href="/shop">授与品の値段 →</a> ／ <a href="/gacha">物御籤 →</a>
            </p>
          )}
        </section>
      </div>

      <section class="card">
        <h2>大きな出入り（この期間）</h2>
        {props.big.length === 0 ? (
          <p class="empty">この期間の出入りはありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {props.big.map((t) => (
                <tr>
                  <td>{fmtDateTime(t.at)}</td>
                  <td>{who(t.memberId)}</td>
                  <td>{COIN_REASON_LABEL[t.reason] ?? t.reason}</td>
                  <td class="note">{FLOW_LABEL[flowOf(t.reason)]}</td>
                  <td class="num">{signed(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}

function Stat(props: { label: string; value: string; unit: string }) {
  return (
    <div class="stat">
      <div class="label">{props.label}</div>
      <div class="value">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
    </div>
  );
}

function Row(props: { k: string; v: string }) {
  return (
    <tr>
      <td>{props.k}</td>
      <td class="num">{props.v}</td>
    </tr>
  );
}

function FlowTable(props: { lines: FlowLine[]; total: number; empty: string; signedTotal?: boolean }) {
  if (props.lines.length === 0) return <p class="empty">{props.empty}</p>;
  const show = props.signedTotal ? signed : fmt;
  return (
    <table class="compact">
      <thead>
        <tr>
          <th>理由</th>
          <th class="num">回数</th>
          <th class="num">人数</th>
          <th class="num">枚数</th>
          <th class="num">割合</th>
        </tr>
      </thead>
      <tbody>
        {props.lines.map((l) => (
          <tr>
            <td>{l.label}</td>
            <td class="num">{fmt(l.count)}</td>
            <td class="num">{fmt(l.members)}</td>
            <td class="num">{show(l.amount)}</td>
            <td class="num">{props.signedTotal ? '' : pct(l.amount, props.total)}</td>
          </tr>
        ))}
        <tr class="total">
          <td>合計</td>
          <td></td>
          <td></td>
          <td class="num">{show(props.total)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  );
}
