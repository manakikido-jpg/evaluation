import type { AdminSession } from '../../db/schema.js';
import type { CasinoGame } from '../../config.js';
import { CASINO_LABEL } from '../../services/casino/casino.js';
import { FORTUNES } from '../../services/omikuji.js';
import type { ServerReportData } from '../../services/serverReport.js';
import { BarList, ColumnChart, MultiLineChart, ShareBars, SignedBarList, StackedColumnChart } from './charts.js';
import { Layout } from './layout.js';

/**
 * 📋 サーバーのようすのレポート（社務所Web の「推移」→「📋 レポート」）。
 * VPS の server-report.js と同じ数字を、グラフと表で見せる（名前・ID は出さない）。開くたびに、その時点の数字で作り直す
 */

const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');
const one = (n: number | undefined) => (n === undefined ? '―' : n.toLocaleString('ja-JP', { maximumFractionDigits: 1 }));
const hours = (min: number) => (min / 60).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const hrs = (min: number) => Math.round(min / 6) / 10;
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const ratio = (a: number, b: number) => (b ? `×${(Math.round((a / b) * 10) / 10).toLocaleString('ja-JP')}` : '―');
const md = (d: string) => d.slice(5).replace('-', '/');

/** 胴元の BOT だけが記録されるゲーム（メンバーどうしの勝ち負けは入らない） */
const BOT_SIDE = new Set(['poker', 'daifugo', 'mahjong', 'babanuki', 'life', 'versus']);
const gameName = (g: string) => `${CASINO_LABEL[g as CasinoGame]?.name ?? g}${BOT_SIDE.has(g) ? '（BOT 側）' : ''}`;
/** 通話の名前（カテゴリの飾りは外す） */
const roomName = (name: string) => name.split(' / ').at(-1) ?? name;
const DAY_OPTIONS = [7, 30, 90] as const;
/** 記録のキーを、画面の名前に */
const SHOP_NAME: Record<string, string> = { role: 'ロール', hanafubuki: '花吹雪', gift: '贈り物', ema_pin: '絵馬の奉納', omikuji_extra: 'おみくじもう 1 回', menzaifu: '免罪符', otoshidama: 'お年玉袋', mycolor: 'マイカラー', casino_boost: '大勝負の札', casino_boost_ex: '大勝負の札（極）', casino_style: 'カジノの着せかえ', name_change: '名前変更の札', koban_1000: '小判 1000', koban_3000: '小判 3000', koban_5000: '小判 5000', koban_10000: '小判 10000' };
const INVITE_NAME: Record<string, string> = { link: '招待リンク', admin: '運営が登録', unknown: '不明', answer: '申請の答え' };
const TICKET_NAME: Record<string, string> = { role: 'ロール', inquiry: 'お問い合わせ', soudan: '相談', stamp: 'スタンプ' };
const fortuneName = (k: string) => FORTUNES.find((f) => f.key === k)?.name ?? k;
const inviteName = (k: string) => INVITE_NAME[k] ?? (k.startsWith('shared:') ? k.slice(7) : k);

function Stat(props: { label: string; value: string; unit?: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div class="stat">
      <div class="label">{props.label}</div>
      <div class="value">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      {props.sub && <span class={`delta ${props.tone ?? ''}`}>{props.sub}</span>}
    </div>
  );
}

export function ServerReportPage(props: { session: AdminSession; d: ServerReportData; coinName: string }) {
  const d = props.d;
  const p = d.people;
  const a = d.active;
  const v = d.voice;
  const m = d.messages;
  const k = d.casino;
  const c = d.coin;
  const house = k.bet - k.paid;
  const rtp = pct(k.paid, k.bet);
  const topShare = pct(c.balanceMax, c.balanceTotal);
  const oneDay = a.daysBins[0]?.count ?? 0;
  const noRank = p.ranks.find((r) => r.name === '役職なし')?.count ?? 0;
  const wPoints = d.weekly.map((w) => ({ label: `${md(w.from)}〜`, title: `${md(w.from)}〜${md(w.to)}` }));
  const binPoints = (bins: { label: string }[]) => bins.map((b) => ({ label: b.label, title: b.label }));
  const slots = k.games.find((g) => g.game === 'slots');
  const othello = k.games.find((g) => g.game === 'othello');
  return (
    <Layout title="レポート" session={props.session} nav="stats" scripts={['charts.js']}>
      <h1>📋 サーバーのレポート</h1>
      <nav class="tabs stats-views" aria-label="見るもの">
        <a href="/stats?view=overview">📈 全体</a>
        <a href="/stats?view=gender">👫 男女</a>
        <a href="/stats?view=active">🌙 浮上・時間帯</a>
        <a href="/stats/report" class="on" aria-current="page">
          📋 レポート
        </a>
      </nav>
      <nav class="tabs" aria-label="期間">
        {DAY_OPTIONS.map((n) => (
          <a href={`/stats/report?days=${n}`} class={n === d.days ? 'on' : ''} aria-current={n === d.days ? 'page' : undefined}>
            {n} 日
          </a>
        ))}
      </nav>
      <p class="note">
        {d.from.replaceAll('-', '/')}〜{d.today.replaceAll('-', '/')}（{d.days} 日）。前の期間（{d.prevFrom.replaceAll('-', '/')}〜{d.prevTo.replaceAll('-', '/')}）とくらべます。開くたびに今の数字で作り直します。名前と ID は出しません。
      </p>

      <section class="card">
        <h2>ひと目でわかる数字</h2>
        <p>
          1 日に来る人は平均 <b>{one(a.dau)}</b> 人（前の期間 {one(a.dauPrev)} 人）、通話は <b>{ratio(v.minutes, v.minutesPrev)}</b>、発言は <b>{ratio(m.total, m.totalPrev)}</b> です。カジノの胴元の収支は <b>{signed(house)}</b> {props.coinName}、銭の <b>{one(topShare)}%</b> を 1 人が持っています。
        </p>
        <div class="stats">
          <Stat label="1 日あたりの浮上" value={one(a.dau)} unit="人" sub={`前の期間 ${one(a.dauPrev)} 人・${ratio(a.dau, a.dauPrev)}`} tone="up" />
          <Stat label="期間に浮上した人" value={fmt(a.people)} unit="人" sub={`前の期間 ${fmt(a.peoplePrev)} 人・${ratio(a.people, a.peoplePrev)}`} tone="up" />
          <Stat label="通話の合計" value={hours(v.minutes)} unit="時間" sub={`前の期間 ${hours(v.minutesPrev)} 時間・${ratio(v.minutes, v.minutesPrev)}`} tone="up" />
          <Stat label="発言の数" value={fmt(m.total)} unit="件" sub={`前の期間 ${fmt(m.totalPrev)} 件・${ratio(m.total, m.totalPrev)}`} tone="up" />
          <Stat label="押された朱印" value={fmt(d.shuin.stamps)} unit="個" sub={`前の期間 ${fmt(d.shuin.stampsPrev)} 個・${ratio(d.shuin.stamps, d.shuin.stampsPrev)}`} tone="up" />
          <Stat label="入った ／ 抜けた" value={`${fmt(p.joins)} ／ ${fmt(p.leaves)}`} unit="回" sub={`前の期間 入った ${fmt(p.joinsPrev)}・抜けた ${fmt(p.leavesPrev)}`} />
        </div>
        <p class="note">浮上 = その日に 1 回でも発言したか、通話（AFK をのぞく）にいた人。BOT は数えません。倍率は「この期間 ÷ 前の期間」。</p>
      </section>

      <section class="card">
        <h2>週ごとの推移（直近 {d.weeks} 週・月曜はじまり）</h2>
        <p class="note">いちばん右の週は、今日までの分です。退出した人もふくみます。</p>
        <h3>浮上した人</h3>
        <ColumnChart points={wPoints} up={{ name: '浮上した人', values: d.weekly.map((w) => w.active) }} unit="人" label="週ごとの浮上した人の数" />
        <h3>通話の合計（時間）</h3>
        <StackedColumnChart points={wPoints} series={[{ name: '縁側', cls: 's1', values: d.weekly.map((w) => hrs(w.engawaMinutes)) }, { name: 'ほかの通話', cls: 's2', values: d.weekly.map((w) => hrs(w.voiceMinutes - w.engawaMinutes)) }]} unit="時間" label="週ごとの通話の合計時間（縁側とほかの通話）" />
        <h3>発言の数</h3>
        <ColumnChart points={wPoints} up={{ name: '発言', values: d.weekly.map((w) => w.messages) }} unit="件" label="週ごとの発言の数" />
        <h3>押された朱印</h3>
        <ColumnChart points={wPoints} up={{ name: '朱印', values: d.weekly.map((w) => w.stamps) }} unit="個" label="週ごとの押された朱印の数" />
        <h3>入った人と抜けた人</h3>
        <ColumnChart points={wPoints} up={{ name: '入った', values: d.weekly.map((w) => w.joined) }} down={{ name: '抜けた', values: d.weekly.map((w) => w.left) }} unit="回" label="週ごとの入った人と抜けた人" />
      </section>

      <section class="card">
        <h2>にぎわう時間と曜日</h2>
        {d.hourly.days ? (
          <>
            <h3>時間帯ごとの人数（1 日あたりの平均・日本時間）</h3>
            <MultiLineChart
              points={d.hourly.rows.map((r) => ({ label: `${r.hour}時`, title: `${r.hour} 時` }))}
              series={[
                { name: '浮上', cls: 's1', values: d.hourly.rows.map((r) => Math.round(r.active * 10) / 10) },
                { name: '通話', cls: 's2', values: d.hourly.rows.map((r) => Math.round(r.voice * 10) / 10) },
                { name: '発言', cls: 's3', values: d.hourly.rows.map((r) => Math.round(r.talk * 10) / 10) },
              ]}
              unit="人"
              label="時間帯ごとの浮上・通話・発言の平均人数"
              format={(n) => one(n)}
            />
            <p class="note">記録のある日: {d.hourly.days} 日</p>
          </>
        ) : (
          <p class="note">時間帯の記録がまだありません。</p>
        )}
        <h3>曜日ごとの浮上（1 日あたりの平均）</h3>
        <ColumnChart points={a.weekday.map((w) => ({ label: w.day, title: `${w.day}曜日` }))} up={{ name: '浮上', values: a.weekday.map((w) => Math.round(w.avg * 10) / 10) }} unit="人" label="曜日ごとの浮上の平均人数" format={(n) => one(n)} />
      </section>

      <section class="card">
        <h2>どんな人がいるか</h2>
        <div class="stats">
          <Stat label="在籍" value={fmt(p.members)} unit="人" sub="BOT をのぞく" />
          <Stat label="入った人のうち、今もいる" value={one(pct(p.stayed, p.joinedPeople))} unit="%" sub={`${fmt(p.stayed)} ／ ${fmt(p.joinedPeople)} 人`} />
          <Stat label="在籍のうち浮上した" value={one(pct(a.activeMembers, p.members))} unit="%" sub="この期間に 1 回でも" />
          <Stat label="入り直した人" value={fmt(p.rejoined)} unit="人" sub="入った人のうち" />
        </div>
        <h3>男女の割合</h3>
        <ShareBars
          rows={[
            { name: '在籍', parts: [{ name: '男性', cls: 's1', value: p.gender.male }, { name: '女性', cls: 's2', value: p.gender.female }, { name: '不明', cls: 's3', value: p.gender.unknown }] },
            { name: '入った人', parts: [{ name: '男性', cls: 's1', value: p.joinedGender.male }, { name: '女性', cls: 's2', value: p.joinedGender.female }, { name: '不明', cls: 's3', value: p.joinedGender.unknown }] },
            { name: '浮上した人', parts: [{ name: '男性', cls: 's1', value: a.gender.male }, { name: '女性', cls: 's2', value: a.gender.female }, { name: '不明', cls: 's3', value: a.gender.unknown }] },
            { name: '通話した人', parts: [{ name: '男性', cls: 's1', value: v.gender.male.people }, { name: '女性', cls: 's2', value: v.gender.female.people }, { name: '不明', cls: 's3', value: v.gender.unknown.people }] },
            { name: '通話の時間', unit: '時間', parts: [{ name: '男性', cls: 's1', value: hrs(v.gender.male.minutes) }, { name: '女性', cls: 's2', value: hrs(v.gender.female.minutes) }, { name: '不明', cls: 's3', value: hrs(v.gender.unknown.minutes) }] },
            { name: '発言の数', unit: '件', parts: [{ name: '男性', cls: 's1', value: m.gender.male }, { name: '女性', cls: 's2', value: m.gender.female }, { name: '不明', cls: 's3', value: m.gender.unknown }] },
          ]}
          label="在籍・入った人・浮上・通話・発言の男女の割合"
        />
        <p class="note">男女は 男性・女性 のロールで分けています。ロールがない人は「不明」です。</p>
        <h3>役職（いちばん上の役職で 1 人 1 回）</h3>
        <BarList rows={p.ranks.filter((r) => r.count > 0).map((r) => ({ name: r.name, value: r.count, cls: r.name === '役職なし' ? 's3' : 's1' }))} unit="人" label="役職ごとの人数" />
        <h3>年齢区分</h3>
        <BarList rows={[{ name: '18 歳以上', value: p.adult }, { name: '18 歳未満', value: p.minor }, { name: '不明', value: p.ageUnknown, cls: 's3' }]} unit="人" label="年齢区分ごとの人数" />
      </section>

      <section class="card">
        <h2>よく来る人と、たまに来る人</h2>
        <p>
          来た日数の中央値は <b>{one(a.daysMedian)}</b> 日です。1 日だけ来た人が <b>{fmt(oneDay)}</b> 人いる一方で、通話が 50 時間をこえる人も <b>{fmt(v.bins.at(-1)?.count ?? 0)}</b> 人います。
        </p>
        <h3>この期間に来た日数（浮上した {fmt(a.people)} 人）</h3>
        <ColumnChart points={binPoints(a.daysBins)} up={{ name: '人数', values: a.daysBins.map((b) => b.count) }} unit="人" label="来た日数ごとの人数" />
        <h3>1 人あたりの通話の時間（通話した {fmt(v.people)} 人・中央値 {v.median === undefined ? '―' : hours(v.median)} 時間）</h3>
        <ColumnChart points={binPoints(v.bins.filter((b) => b.label !== '0'))} up={{ name: '人数', values: v.bins.filter((b) => b.label !== '0').map((b) => b.count) }} unit="人" label="通話の時間ごとの人数" />
        <h3>1 人あたりの発言の数（発言した {fmt(m.people)} 人・中央値 {one(m.median)} 件）</h3>
        <ColumnChart points={binPoints(m.bins.filter((b) => b.label !== '0'))} up={{ name: '人数', values: m.bins.filter((b) => b.label !== '0').map((b) => b.count) }} unit="人" label="発言の数ごとの人数" />
      </section>

      <section class="card">
        <h2>よく使われた場所</h2>
        <p>
          縁側の通話は <b>{hours(v.engawaMinutes)}</b> 時間・<b>{fmt(v.engawaPeople)}</b> 人です。
        </p>
        <h3>通話（時間の多い順に 10）</h3>
        <BarList rows={v.channels.map((ch) => ({ name: roomName(ch.name), value: hrs(ch.minutes), cls: ch.engawa ? 's1' : 's3', tip: `${fmt(ch.people)} 人` }))} unit="時間" label="よく使われた通話の時間" format={(n) => one(n)} />
        <h3>チャンネル（書き込みの多い順に 10）</h3>
        {m.channels.length ? <BarList rows={m.channels.map((ch) => ({ name: `#${ch.name}`, value: ch.count, tip: `${fmt(ch.people)} 人` }))} unit="件" label="よく書かれたチャンネルの件数" /> : <p class="note">書き込みの記録がありません。</p>}
        <p class="note">チャンネルは、書き込みの記録（90 日分を保存）から数えています。</p>
      </section>

      <section class="card">
        <h2>{props.coinName}（サーバーの通貨）の動き</h2>
        <div class="stats">
          <Stat label="この期間に増えた分" value={signed(c.plus - c.minus)} unit={props.coinName} sub={`増えた ${fmt(c.plus)}・減った ${fmt(c.minus)}`} />
          <Stat label="今いる人の残高の合計" value={fmt(c.balanceTotal)} unit={props.coinName} sub={`中央値 ${one(c.balanceMedian)}・上位 10% の境目 ${one(c.balanceP90)}`} />
          <Stat label="いちばん多く持っている人" value={fmt(c.balanceMax)} unit={props.coinName} sub={`全体の ${one(topShare)}%`} tone="down" />
        </div>
        <h3>増えた理由（多い順に 12）</h3>
        <BarList rows={c.in.slice(0, 12).map((r) => ({ name: r.label, value: r.amount, cls: 's2', tip: `${fmt(r.people)} 人` }))} unit={props.coinName} label="銭が増えた理由と金額" />
        <h3>減った理由（多い順に 12）</h3>
        <BarList rows={c.out.slice(0, 12).map((r) => ({ name: r.label, value: r.amount, tip: `${fmt(r.people)} 人` }))} unit={props.coinName} label="銭が減った理由と金額" />
        <p class="note">カジノの賭けと払い戻しもふくみます。BOT の分はのぞいています。</p>
      </section>

      <section class="card">
        <h2>カジノ</h2>
        <div class="stats">
          <Stat label="遊ばれた回数" value={fmt(k.plays)} unit="回" sub={`遊んだ人 ${fmt(k.players)} 人`} />
          <Stat label="胴元（サーバー）の収支" value={signed(house)} unit={props.coinName} sub="賭けた − 戻った" tone={house < 0 ? 'down' : 'up'} />
          <Stat label="戻り率" value={one(rtp)} unit="%" sub="100% をこえると胴元の負け" tone={rtp > 100 ? 'down' : 'up'} />
        </div>
        {k.games.length > 0 && (
          <>
            <h3>ゲームごとの胴元の収支（右は胴元の勝ち・左は胴元の負け）</h3>
            <SignedBarList rows={[...k.games].sort((x, y) => x.bet - x.paid - (y.bet - y.paid)).map((g) => ({ name: gameName(g.game), value: g.bet - g.paid, tip: `${fmt(g.plays)} 回・${fmt(g.players)} 人・戻り率 ${one(pct(g.paid, g.bet))}%` }))} unit={props.coinName} label="ゲームごとの胴元の収支" />
            <p class="note">「BOT 側」のゲームは、胴元の BOT が卓に入った分だけの記録です。メンバーどうしの勝ち負けは入っていません。</p>
            <div class="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ゲーム</th>
                    <th class="num">回数</th>
                    <th class="num">人</th>
                    <th class="num">賭けた</th>
                    <th class="num">戻った</th>
                    <th class="num">胴元</th>
                    <th class="num">戻り率</th>
                  </tr>
                </thead>
                <tbody>
                  {k.games.map((g) => (
                    <tr>
                      <td>{gameName(g.game)}</td>
                      <td class="num">{fmt(g.plays)}</td>
                      <td class="num">{fmt(g.players)}</td>
                      <td class="num">{fmt(g.bet)}</td>
                      <td class="num">{fmt(g.paid)}</td>
                      <td class="num">{signed(g.bet - g.paid)}</td>
                      <td class="num">{one(pct(g.paid, g.bet))}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section class="card">
        <h2>案内・キャスト・授与所など</h2>
        <div class="stats">
          <Stat label="案内" value={fmt(d.guide.count)} unit="件" sub={`完了 ${fmt(d.guide.done)}・完了まで中央値 ${one(d.guide.medianMinutes === undefined ? undefined : Math.round(d.guide.medianMinutes * 10) / 10)} 分・案内した人 ${d.guide.guides} 人`} />
          <Stat label="キャストの指名（終わった）" value={fmt(d.cast.done)} unit="件" sub={`申し込み ${fmt(d.cast.requests)}・指名した人 ${d.cast.customers} 人・キャスト ${d.cast.casts} 人`} />
          <Stat label="授与所" value={fmt(d.shop.count)} unit="件" sub={`買った人 ${d.shop.people} 人・合計 ${fmt(d.shop.total)}`} />
          <Stat label="物御籤" value={fmt(d.gacha.count)} unit="回" sub={`引いた人 ${d.gacha.people} 人`} />
          <Stat label="おみくじ" value={fmt(d.omikuji.count)} unit="回" sub={`引いた人 ${d.omikuji.people} 人`} />
          <Stat label="お問い合わせ" value={fmt(d.tickets.count)} unit="件" sub={d.tickets.types.map((t) => `${TICKET_NAME[t.type] ?? t.type} ${t.count}`).join('・') || 'なし'} />
        </div>
        {d.invites.sources.length > 0 && (
          <>
            <h3>入ってきた道（招待の記録）</h3>
            <BarList rows={d.invites.sources.map((s) => ({ name: inviteName(s.source), value: s.count }))} unit="人" label="入ってきた道ごとの人数" />
          </>
        )}
        {d.shop.kinds.length > 0 && (
          <>
            <h3>授与所でよく買われたもの</h3>
            <BarList rows={d.shop.kinds.slice(0, 10).map((s) => ({ name: SHOP_NAME[s.kind] ?? s.kind, value: s.count }))} unit="件" label="授与所でよく買われたもの" />
          </>
        )}
        {d.omikuji.fortunes.length > 0 && (
          <>
            <h3>おみくじの結果</h3>
            <BarList rows={[...d.omikuji.fortunes].sort((x, y) => FORTUNES.findIndex((f) => f.key === x.fortune) - FORTUNES.findIndex((f) => f.key === y.fortune)).map((f) => ({ name: fortuneName(f.fortune), value: f.count, cls: f.fortune.includes('kyo') ? ('s3' as const) : ('s1' as const) }))} unit="回" label="おみくじの結果ごとの回数" />
          </>
        )}
      </section>

      <section class="card">
        <h2>考えたいこと</h2>
        <ul>
          <li>
            <b>カジノの収支</b>: 胴元は {signed(house)} {props.coinName}（戻り率 {one(rtp)}%）。
            {slots && ` スロット ${one(pct(slots.paid, slots.bet))}%`}
            {othello && `・オセロ（CPU） ${one(pct(othello.paid, othello.bet))}%`}
          </li>
          <li>
            <b>銭のかたより</b>: 1 人が全体の {one(topShare)}% を持っています（中央値 {one(c.balanceMedian)}）。
          </li>
          <li>
            <b>1 日だけで来なくなる人</b>: {fmt(oneDay)} 人。役職なしの人は {fmt(noRank)} 人です。
          </li>
          <li>
            <b>年齢区分の不明</b>: {fmt(p.ageUnknown)} 人（在籍の {one(pct(p.ageUnknown, p.members))}%）。
          </li>
        </ul>
      </section>

      <details class="card">
        <summary>数え方と、読むときに気をつけること</summary>
        <ul class="note">
          <li>浮上 = その日に 1 回でも発言したか、通話（AFK をのぞく）にいた人。週ごとの推移は、もう退出した人もふくみます。</li>
          <li>通話の時間は、ミュートや 1 人でいた時間もふくみます（通話の銭がもらえる時間とはちがいます）。</li>
          <li>時間帯は、記録のある日の平均です。カジノは終わった回だけです。</li>
          <li>同じ数字は、VPS で <code>docker compose exec bot node dist/scripts/server-report.js</code> を打っても出せます（文で出ます）。</li>
        </ul>
      </details>
    </Layout>
  );
}
