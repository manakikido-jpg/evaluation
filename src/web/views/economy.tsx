import type { Child } from 'hono/jsx';
import type { GuildConfig } from '../../config.js';
import type { AdminSession, CoinTx } from '../../db/schema.js';
import { COIN_REASON_LABEL } from '../../services/economy.js';
import { flowOf, type Distribution, type EconomyOverview, type FlowLine } from '../../services/economyStats.js';
import { TREND_RANGES, type TrendRange } from '../../services/stats.js';
import { fmtDateTime } from '../format.js';
import type { EconomyAlert, EconomyEvent } from '../../db/schema.js';
import { EVENT_KINDS, EVENT_TICKET_MAX, eventEffect, eventState } from '../../services/economyEvents.js';
import { TicketSelect } from './gacha.js';
import { PRICE_LEVEL, type GachaLedger, type MemberLedger, type PriceGuide, type SuspectPair } from '../../services/economyWatch.js';
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
  watch?: Watch;
  flash?: string;
}) {
  const { overview: o, dist: d, cfg } = props;
  const f = props.flash && Object.hasOwn(ECONOMY_FLASH, props.flash) ? ECONOMY_FLASH[props.flash] : undefined;
  const e = cfg.economy;
  const coin = `${e.currencyEmoji}${e.currencyName}`;
  const points = o.buckets.map((b) => ({ label: b.label, title: b.title }));
  const who = (id: string) => <a href={`/economy/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const guji = props.session.level === 'guji';
  return (
    <Layout title="経済" session={props.session} nav="economy" scripts={['charts.js']}>
      <h1>🪙 経済（{coin}の流れ）</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
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

      <nav class="jump card" aria-label="このページの項目">
        <a href="#economy-supply">📊 出回っている量</a>
        <a href="#economy-flow">🔁 配った・収入</a>
        <a href="#economy-spread">👛 かたより</a>
        <a href="#economy-big">💥 大きな出入り</a>
        <a href="#economy-events">🎉 イベント</a>
        <a href="#economy-gacha">🎲 物御籤の収支</a>
        <a href="#economy-guide">🎯 値段の目安</a>
        <a href="#economy-suspects">🕵 サブ垢の疑い</a>
        <a href="#economy-alerts">⚠ 警告</a>
        <a href="#economy-watch">⚙ 見守りの設定</a>
      </nav>

      <section class="card anchor" id="economy-supply">
        <h2>出回っている{e.currencyName}の量</h2>
        <p class="note">各区切りの終わりに、メンバーが持っていた{e.currencyName}の合計です。</p>
        <LineChart points={points} values={o.buckets.map((b) => b.supply)} unit="枚" label={`出回っている${e.currencyName}の量の推移`} />
      </section>

      <section class="card anchor" id="economy-flow">
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

      <section class="card anchor" id="economy-spread">
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

      <section class="card anchor" id="economy-big">
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
      {props.watch && <WatchSections watch={props.watch} cfg={cfg} guji={guji} who={who} csrf={props.session.csrfToken} />}
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

export const ECONOMY_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  event_created: { text: '🎉 イベントを作りました。始まると BOT が自動で効かせます（知らせるチャンネルを選んでいれば、始まり・終わりを知らせます）。', kind: 'ok' },
  event_cancelled: { text: 'イベントをやめました（1 分以内に元に戻ります）。', kind: 'ok' },
  event_invalid: {
    text: 'イベントの入力を確かめてください（名前・始まりと終わり・値: 通話ボーナスは 110〜1000%、セールは 1〜90% 引き。終わりは始まりより後で、今より後）。',
    kind: 'warn',
  },
  watch_saved: { text: '見守りの設定を保存しました（BOT には 1 分以内に反映されます）。', kind: 'ok' },
  watch_invalid: { text: '見守りの設定の入力を確かめてください（お賽銭は 1〜20%）。', kind: 'warn' },
};

type Watch = {
  suspects: SuspectPair[];
  guide: PriceGuide;
  gacha: GachaLedger;
  alerts: EconomyAlert[];
  events: EconomyEvent[];
  channels: { id: string; name: string; category: string | null }[];
  now: Date;
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const STATE_LABEL = { upcoming: '⏳ これから', active: '🟢 開催中', ended: '終わった', cancelled: 'やめた' } as const;
/** 日本時間の datetime-local の値 */
const jstLocal = (d: Date) => new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
const jstText = (d: Date) => jstLocal(d).replace('T', ' ');

function ChannelSelect(props: { name: string; channels: Watch['channels']; selected?: string; empty: string }) {
  return (
    <select name={props.name}>
      <option value="">{props.empty}</option>
      {props.channels.map((ch) => (
        <option value={ch.id} selected={props.selected === ch.id}>
          {ch.category ? `${ch.category} / ` : ''}#{ch.name}
        </option>
      ))}
    </select>
  );
}

function WatchSections(props: { watch: Watch; cfg: GuildConfig; guji: boolean; who: (id: string) => Child; csrf: string }) {
  const { watch: w, cfg, guji, who } = props;
  const e = cfg.economy;
  const o = cfg.economyOps;
  const CsrfField = () => <input type="hidden" name="_csrf" value={props.csrf} />;
  return (
    <>
      <section class="card anchor" id="economy-events">
        <h2>🎉 期間限定イベント（ボーナス週間・セール）</h2>
        <p class="note">
          決めた期間だけ、通話でもらえる{e.currencyName}を増やしたり、授与品・物御籤を安くしたりします。始まり・終わりは BOT が自動で効かせます（1 分以内）。同じ種類が重なったら大きいほうが効きます。
        </p>
        <p class="note">
          🎫 <strong>通話で券</strong>: 期間中、その日（日本時間）の通話の合計が「値」の分数になった人に、選んだ券を配って DM で知らせます（1 人 1 日 1 回・位のロールを持っている人だけ）。配る日の 0:00〜23:59 にすると、その日だけになります。数えるのは「通話の記録」の時間（AFK・除外した通話はのぞく）で、始まる前のその日の分も入ります。
        </p>
        {w.events.length === 0 ? (
          <p class="empty">まだイベントはありません。</p>
        ) : (
          <table class="compact">
            <tbody>
              {w.events.map((ev) => {
                const st = eventState(ev, w.now);
                return (
                  <tr class={st === 'ended' || st === 'cancelled' ? 'muted' : ''}>
                    <td>{STATE_LABEL[st]}</td>
                    <td>
                      {EVENT_KINDS[ev.kind].emoji} <strong>{ev.title}</strong>
                    </td>
                    <td>{eventEffect(ev, e.currencyName)}</td>
                    <td class="nowrap">
                      {jstText(ev.startsAt)} 〜 {jstText(ev.endsAt)}
                    </td>
                    <td>
                      {guji && (st === 'upcoming' || st === 'active') && (
                        <form method="post" action={`/economy/events/${ev.id}/cancel`} class="inline">
                          <CsrfField />
                          <button type="submit">やめる</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {guji && (
          <form method="post" action="/economy/events" class="fields">
            <CsrfField />
            <label class="field">
              <span>種類</span>
              <select name="kind" required>
                {(Object.keys(EVENT_KINDS) as (keyof typeof EVENT_KINDS)[]).map((k) => (
                  <option value={k}>
                    {EVENT_KINDS[k].emoji} {EVENT_KINDS[k].label}（{EVENT_KINDS[k].unit}）
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>値（通話ボーナスは 200 で 2 倍・セールは 30 で 30% 引き・通話で券は 10 で 10 分）</span>
              <input type="number" name="value" min={1} max={1000} value="200" required />
            </label>
            <label class="field">
              <span>通話で券: 配る券</span>
              <TicketSelect name="ticket" selected="gacha_free" />
            </label>
            <label class="field">
              <span>通話で券: 枚数</span>
              <input type="number" name="ticketCount" min={1} max={EVENT_TICKET_MAX} value="1" required />
            </label>
            <label class="field">
              <span>名前（お知らせに出る）</span>
              <input type="text" name="title" maxlength={60} placeholder="例: 通話 2 倍週間" required />
            </label>
            <label class="field">
              <span>始まり（日本時間）</span>
              <input type="datetime-local" name="startsAt" value={jstLocal(w.now)} required />
            </label>
            <label class="field">
              <span>終わり（日本時間）</span>
              <input type="datetime-local" name="endsAt" value={jstLocal(new Date(w.now.getTime() + 7 * 86_400_000))} required />
            </label>
            <label class="field">
              <span>始まり・終わりを知らせる</span>
              <ChannelSelect name="announce" channels={w.channels} empty="知らせない" />
            </label>
            <button type="submit" class="ok">
              作る
            </button>
          </form>
        )}
      </section>

      <div class="grid2">
        <section class="card anchor" id="economy-gacha">
          <h2>🎁 物御籤の収支（この期間）</h2>
          <table class="compact">
            <tbody>
              <Row k="引かれた回数" v={`${fmt(w.gacha.draws)} 回`} />
              <Row k={`使われた${e.currencyName}（払い戻しを引く）`} v={`${fmt(w.gacha.income)} 枚`} />
              <Row k={`当たりで出た${e.currencyName}・おすそ分け`} v={`− ${fmt(w.gacha.coinsOut)} 枚`} />
              <Row k="当たりで出た授与品（値段の合計）" v={`− ${fmt(w.gacha.shopValue)} 枚`} />
              <tr class="total">
                <td>差し引き（鯖から見て）</td>
                <td class="num">{signed(w.gacha.net)} 枚</td>
              </tr>
            </tbody>
          </table>
          <p class="note">
            ほかに券・札が {fmt(w.gacha.tickets)} 枚、ロールが {fmt(w.gacha.roles)} 回出ています（{e.currencyName}では数えられないもの）。差し引きがマイナスだと、物御籤で{e.currencyName}が増えています。
          </p>
        </section>
        <section class="card anchor" id="economy-guide">
          <h2>🎯 値段の目安</h2>
          <p class="note">
            {w.guide.earners
              ? `稼いでいる人（4 週で 1 枚以上もらった ${fmt(w.guide.earners)} 人）の、1 週間にもらう量のまん中は ${fmt(w.guide.weeklyMedian)} 枚（1 日 ${fmt(Math.round(w.guide.weeklyMedian / 7))} 枚）。値段がその何日分かです。`
              : 'まだ稼いでいる人がいないので、目安は出せません。'}
          </p>
          <table class="compact">
            <thead>
              <tr>
                <th>品</th>
                <th class="num">値段</th>
                <th class="num">何日分</th>
                <th>目安</th>
              </tr>
            </thead>
            <tbody>
              {w.guide.items.map((i) => (
                <tr>
                  <td>{i.name}</td>
                  <td class="num">{fmt(i.price)}</td>
                  <td class="num">{i.days === null ? '—' : fmt(i.days)}</td>
                  <td class={`level-${i.level}`}>{PRICE_LEVEL[i.level]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div class="grid2">
        <section class="card anchor" id="economy-suspects">
          <h2>🕵 サブアカウントの疑い（この期間）</h2>
          <p class="note">同じ相手への贈り物・市場の買い物が多い組です。入ったばかりの人が受け取った・3 回以上・合計が多い、のどれかに当てはまるものを出しています。疑いがあるだけなので、決めつけずに確かめてください。</p>
          {w.suspects.length === 0 ? (
            <p class="empty">当てはまる組はありません。</p>
          ) : (
            <table class="compact">
              <tbody>
                {w.suspects.map((p) => (
                  <tr>
                    <td>{p.kind === 'gift' ? '💝 贈り物' : '🏪 市場'}</td>
                    <td>
                      {who(p.fromId)} → {who(p.toId)}
                    </td>
                    <td class="num">
                      {fmt(p.count)} 回・{fmt(p.total)} 枚
                    </td>
                    <td class="wrap note">{p.reasons.join('・')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section class="card anchor" id="economy-alerts">
          <h2>⚠ 最近の警告・お賽銭</h2>
          {w.alerts.length === 0 ? (
            <p class="empty">まだありません。</p>
          ) : (
            <table class="compact">
              <tbody>
                {w.alerts.map((a) => (
                  <tr>
                    <td>{fmtDateTime(a.createdAt)}</td>
                    <td>{a.memberId ? who(a.memberId) : ''}</td>
                    <td>{a.kind === 'earn' ? '24 時間でたくさんもらった' : a.kind === 'spend' ? '24 時間でたくさん使った' : '🪙 お賽銭'}</td>
                    <td class="num">{fmt(a.amount)} 枚</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section class="card anchor" id="economy-watch">
        <h2>⚙ 見守りの設定</h2>
        <p class="note">
          いまの設定: 週ごとのお知らせ {o.reportEnabled ? `毎週${WEEKDAYS[o.reportWeekday]}曜 ${o.reportHour} 時` : 'なし'} ／ 警告 {o.alertsEnabled ? `もらった ${fmt(o.alertEarn24h)}・使った ${fmt(o.alertSpend24h)} 枚以上（24 時間）` : 'なし'}{' '}
          ／ お賽銭 {o.saisenEnabled ? `${fmt(o.saisenThreshold)} 枚を超えた分の ${o.saisenPercent}%（週 1 回）` : 'なし'}。知らせる先: {o.channelId ? (w.channels.find((c) => c.id === o.channelId)?.name ?? o.channelId) : '#記録'}
        </p>
        {guji && (
          <form method="post" action="/economy/settings" class="fields">
            <CsrfField />
            <label class="field check">
              <input type="checkbox" name="reportEnabled" value="yes" checked={o.reportEnabled} />
              <span>📊 週ごとのお知らせ（配った量・収入・かたより・物御籤・疑いのある組）</span>
            </label>
            <label class="field">
              <span>曜日</span>
              <select name="reportWeekday">
                {WEEKDAYS.map((d, i) => (
                  <option value={String(i)} selected={o.reportWeekday === i}>
                    {d}曜
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>時（日本時間）</span>
              <input type="number" name="reportHour" min={0} max={23} value={String(o.reportHour)} required />
            </label>
            <label class="field">
              <span>お知らせ・警告を出すチャンネル</span>
              <ChannelSelect name="channelId" channels={w.channels} selected={o.channelId} empty="#記録（決めない）" />
            </label>
            <label class="field check">
              <input type="checkbox" name="alertsEnabled" value="yes" checked={o.alertsEnabled} />
              <span>⚠ 動きが多い人を知らせる（1 人 1 日 1 回。贈り物・市場の売り上げも入れる・運営の調整は入れない）</span>
            </label>
            <label class="field">
              <span>24 時間でもらった量がこれ以上（0 で知らせない）</span>
              <input type="number" name="alertEarn24h" min={0} value={String(o.alertEarn24h)} required />
            </label>
            <label class="field">
              <span>24 時間で使った量がこれ以上（0 で知らせない）</span>
              <input type="number" name="alertSpend24h" min={0} value={String(o.alertSpend24h)} required />
            </label>
            <label class="field check">
              <input type="checkbox" name="saisenEnabled" value="yes" checked={o.saisenEnabled} />
              <span>🪙 お賽銭（持ちすぎた分を週 1 回、少しだけ納めてもらう。本人に DM。強すぎると不満が出るので、はじめは止めてあります）</span>
            </label>
            <label class="field">
              <span>この量を超えた分に</span>
              <input type="number" name="saisenThreshold" min={0} value={String(o.saisenThreshold)} required />
            </label>
            <label class="field">
              <span>何 %（1〜20）</span>
              <input type="number" name="saisenPercent" min={1} max={20} value={String(o.saisenPercent)} required />
            </label>
            <button type="submit" class="ok">
              保存
            </button>
          </form>
        )}
      </section>
    </>
  );
}

/** 1 人ずつの収支 */
export function MemberLedgerPage(props: { session: AdminSession; cfg: GuildConfig; memberId: string; range: TrendRange; ledger: MemberLedger; names: Map<string, string> }) {
  const { ledger: l, cfg } = props;
  const e = cfg.economy;
  const name = props.names.get(props.memberId) ?? props.memberId;
  const points = l.days.map((d) => ({ label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`, title: d.date }));
  const who = (id: string) => <a href={`/economy/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const Table = (p: { rows: MemberLedger['earnedBy']; empty: string }) =>
    p.rows.length === 0 ? (
      <p class="empty">{p.empty}</p>
    ) : (
      <table class="compact">
        <tbody>
          {p.rows.map((r) => (
            <tr>
              <td>{r.label}</td>
              <td class="num">{fmt(r.count)} 回</td>
              <td class="num">{fmt(r.amount)} 枚</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <Layout title={`収支: ${name}`} session={props.session} nav="economy" scripts={['charts.js']}>
      <p>
        <a href="/economy">← 経済</a> ／ <a href={`/members/${props.memberId}`}>{name} のページ</a>
      </p>
      <h1>📒 {name} の収支</h1>
      <nav class="tabs" aria-label="期間">
        {(['30d', '90d'] as TrendRange[]).map((r) => (
          <a href={`/economy/members/${props.memberId}?range=${r}`} class={r === props.range ? 'on' : ''}>
            {r === '30d' ? '30 日' : '3 か月'}
          </a>
        ))}
      </nav>
      <div class="stats">
        <Stat label={`いまの${e.currencyName}`} value={fmt(l.balance)} unit="枚" />
        <Stat label="この期間にもらった" value={fmt(l.earned)} unit="枚" />
        <Stat label="この期間に使った" value={fmt(l.spent)} unit="枚" />
        <Stat label="これまでに貯めた" value={fmt(l.lifetimeEarned)} unit="枚" />
      </div>
      <section class="card">
        <h2>日ごと（もらった・上／使った・下）</h2>
        <ColumnChart
          points={points}
          up={{ name: 'もらった', values: l.days.map((d) => d.earned) }}
          down={{ name: '使った', values: l.days.map((d) => d.spent) }}
          unit="枚"
          label="もらった（上）と使った（下）"
        />
      </section>
      <div class="grid2">
        <section class="card">
          <h2>もらった理由</h2>
          <Table rows={l.earnedBy} empty="この期間はありません。" />
        </section>
        <section class="card">
          <h2>使った理由</h2>
          <Table rows={l.spentBy} empty="この期間はありません。" />
        </section>
      </div>
      <section class="card">
        <h2>🤝 よくやり取りした相手（贈り物・市場）</h2>
        {l.partners.length === 0 ? (
          <p class="empty">この期間はありません。</p>
        ) : (
          <table class="compact">
            <thead>
              <tr>
                <th>相手</th>
                <th class="num">渡した</th>
                <th class="num">受け取った</th>
              </tr>
            </thead>
            <tbody>
              {l.partners.map((p) => (
                <tr>
                  <td>{who(p.memberId)}</td>
                  <td class="num">{fmt(p.sent)} 枚</td>
                  <td class="num">{fmt(p.received)} 枚</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  );
}
