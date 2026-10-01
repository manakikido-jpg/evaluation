import type { CasinoConfig, CasinoGame } from '../../config.js';
import { CASINO_GAMES } from '../../config.js';
import type { CasinoMatch } from '../../db/schema.js';
import { CASINO_LABEL, type CasinoStat } from '../../services/casino/casino.js';
import { Layout, type SessionView } from './layout.js';
import { BarList, ColumnChart, LineChart, type ChartPoint } from './charts.js';
import type { CasinoDay, SettingStat } from '../../services/casino/report.js';
import { combinedOdds, type MachineDay } from '../../services/casino/slotFloor.js';
import { RANDOM_SETTING_ODDS, roleOdds, SETTING_KEYS, slotRtp, type SlotSetting } from '../../services/casino/slots.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');

export const CASINO_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '🎰 カジノの設定を保存しました（1 分以内に反映されます）。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（最低の賭けは最高以下に）。', kind: 'warn' },
  no_role_picked: { text: '「決めたロールがある人だけ」にするときは、ロールを選んでください。', kind: 'warn' },
  role_made: { text: '🎰 カジノのロールを用意して、入れる人をそのロールにしました。Discord でメンバーにロールを渡してください。', kind: 'ok' },
  role_failed: { text: 'ロールを作れませんでした。BOT に「ロールの管理」の権限があるか確かめてください。', kind: 'warn' },
};

export const CASINO_RANGES = { '1d': { label: '今日から 24 時間', days: 1 }, '7d': { label: '7 日', days: 7 }, '30d': { label: '30 日', days: 30 } } as const;
export type CasinoRange = keyof typeof CASINO_RANGES;

export function CasinoAdminPage(p: {
  session: SessionView;
  casino: CasinoConfig;
  coinName: string;
  url: string;
  range: CasinoRange;
  stats: CasinoStat[];
  matches: { plays: number; pot: number };
  recentMatches: CasinoMatch[];
  names: Map<string, string>;
  players7d: number;
  flash?: string;
  guji: boolean;
  daily: CasinoDay[];
  floor: MachineDay[];
  /** 今日のおまかせの設定（台の番号 → 設定） */
  picks: Record<string, number>;
  settingStats: SettingStat[];
  roles: { id: string; name: string }[];
}) {
  const f = p.flash && Object.hasOwn(CASINO_FLASH, p.flash) ? CASINO_FLASH[p.flash] : undefined;
  const c = p.casino;
  const total = p.stats.reduce((a, s) => ({ plays: a.plays + s.plays, wagered: a.wagered + s.wagered, paid: a.paid + s.paid }), { plays: 0, wagered: 0, paid: 0 });
  const name = (id: string | null) => (id ? (p.names.get(id) ?? id) : '—');
  return (
    <Layout title="カジノ" session={p.session} nav="casino">
      <h1>🎰 カジノ</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <section class="card">
        <h2>メンバーの入口</h2>
        <p>
          <code>{p.url}</code>
        </p>
        <p class="note">
          メンバーはここから Discord でログインして遊びます（{accessText(c)}）。運営の画面（秘密の入口・ID とパスワード）とは別のログインで、こちらから運営の画面には入れません。Discord の
          「/カジノ」でもこのリンクが出ます。
        </p>
        <p class="note">
          いま: {c.enabled ? '🟢 開いている' : '🌙 お休み'}・1 回 {fmt(c.minBet)}〜{fmt(c.maxBet)} {p.coinName}・1 日の上限 {c.dailyBetLimit > 0 ? `${fmt(c.dailyBetLimit)} ${p.coinName}` : 'なし'}・7 日で遊んだ人 {fmt(p.players7d)} 人
        </p>
      </section>

      <section class="card">
        <h2>📊 収支（{CASINO_RANGES[p.range].label}）</h2>
        <p class="tabs">
          {(Object.keys(CASINO_RANGES) as CasinoRange[]).map((r) => (
            <a href={`/economy/casino?range=${r}`} class={r === p.range ? 'on' : ''}>
              {CASINO_RANGES[r].label}
            </a>
          ))}
        </p>
        <p class="note">「胴元の収支」はメンバーが賭けた合計から戻した合計を引いたもの（プラスなら銭がサーバーから減った＝出回る銭が減った）。</p>
        <table class="compact">
          <thead>
            <tr>
              <th>ゲーム</th>
              <th class="num">回数</th>
              <th class="num">遊んだ人</th>
              <th class="num">賭けた</th>
              <th class="num">戻した</th>
              <th class="num">胴元の収支</th>
              <th class="num">戻り率</th>
            </tr>
          </thead>
          <tbody>
            {p.stats.map((s) => (
              <tr>
                <td>
                  {CASINO_LABEL[s.game as CasinoGame]?.emoji} {CASINO_LABEL[s.game as CasinoGame]?.name ?? s.game}
                </td>
                <td class="num">{fmt(s.plays)}</td>
                <td class="num">{fmt(s.players)}</td>
                <td class="num">{fmt(s.wagered)}</td>
                <td class="num">{fmt(s.paid)}</td>
                <td class="num">{fmt(s.wagered - s.paid)}</td>
                <td class="num">{s.wagered ? `${Math.round((s.paid / s.wagered) * 1000) / 10}%` : '—'}</td>
              </tr>
            ))}
            <tr>
              <th>合計（1 人で遊ぶもの）</th>
              <th class="num">{fmt(total.plays)}</th>
              <th></th>
              <th class="num">{fmt(total.wagered)}</th>
              <th class="num">{fmt(total.paid)}</th>
              <th class="num">{fmt(total.wagered - total.paid)}</th>
              <th class="num">{total.wagered ? `${Math.round((total.paid / total.wagered) * 1000) / 10}%` : '—'}</th>
            </tr>
          </tbody>
        </table>
        <p class="note">
          ⚔ メンバー対戦: {fmt(p.matches.plays)} 回・動いた銭 {fmt(p.matches.pot)} {p.coinName}（メンバー同士のやりとりなので、胴元の収支はありません）
        </p>
        {p.recentMatches.length > 0 && (
          <table class="compact">
            <tbody>
              {p.recentMatches.map((m) => (
                <tr>
                  <td>#{m.id}</td>
                  <td>
                    ⚫ {name(m.hostId)} vs ⚪ {name(m.guestId)}
                  </td>
                  <td class="num">{fmt(m.bet)}</td>
                  <td>{m.winnerId ? `🏆 ${name(m.winnerId)}` : '引き分け'}</td>
                  <td>{m.endReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CasinoCharts daily={p.daily} stats={p.stats} coinName={p.coinName} range={CASINO_RANGES[p.range].label} />
      <SlotMachines casino={c} floor={p.floor} picks={p.picks} settingStats={p.settingStats} coinName={p.coinName} />

      {p.guji && (
        <section class="card">
          <h2>⚙ 設定（宮司）</h2>
          <form method="post" action="/economy/casino" class="fields">
            <input type="hidden" name="_csrf" value={p.session.csrfToken} />
            <label class="field check">
              <input type="checkbox" name="enabled" value="yes" checked={c.enabled} />
              <span>カジノを開ける（止めるとメンバーには「お休み」と出ます。途中のゲームは開けたときに続けられます）</span>
            </label>
            <fieldset class="perms access-fieldset">
              <legend>入れる人</legend>
              <label class="check">
                <input type="radio" name="access" value="role" checked={Boolean(c.accessRoleId)} /> 決めたロールがある人だけ：
                <select name="accessRoleId">
                  <option value="">（ロールを選ぶ）</option>
                  {p.roles.map((r) => (
                    <option value={r.id} selected={r.id === c.accessRoleId}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="check">
                <input type="radio" name="access" value="rank" checked={!c.accessRoleId && c.requireRank} /> 位のロール（🔰参拝者 など）がある人
              </label>
              <label class="check">
                <input type="radio" name="access" value="all" checked={!c.accessRoleId && !c.requireRank} /> サーバーにいる人ならだれでも
              </label>
              <p class="note">「🎰 カジノ」のようなロールを作って、入れたい人にだけ Discord で渡す使い方ができます（下の「🎰 カジノ ロールを用意する」で作れます）。ロールを外された人は、10 分以内にカジノからログアウトされます。</p>
            </fieldset>
            <label class="field">
              <span>1 回に賭けられる最低（{p.coinName}）</span>
              <input type="number" name="minBet" min={1} max={1000000} value={String(c.minBet)} required />
            </label>
            <label class="field">
              <span>1 回に賭けられる最高（{p.coinName}）</span>
              <input type="number" name="maxBet" min={1} max={1000000} value={String(c.maxBet)} required />
            </label>
            <label class="field">
              <span>🎡 ルーレットの 1 か所に賭けられる最高（0 で上の最高と同じ。10 か所まで置けるので、合計はこの 10 倍まで）</span>
              <input type="number" name="rouletteMaxBet" min={0} max={10000000} value={String(c.rouletteMaxBet)} required />
            </label>
            <label class="field">
              <span>1 日（日本時間）に賭けられる合計（0 で上限なし。大きく賭けられるようにしたら、こちらも上げてください）</span>
              <input type="number" name="dailyBetLimit" min={0} max={100000000} value={String(c.dailyBetLimit)} required />
            </label>
            <fieldset class="perms">
              <legend>遊べるゲーム</legend>
              {CASINO_GAMES.map((g) => (
                <label class="check">
                  <input type="checkbox" name="games" value={g} checked={c.games.includes(g)} /> {CASINO_LABEL[g].emoji} {CASINO_LABEL[g].name}
                </label>
              ))}
            </fieldset>
            <fieldset class="perms slot-fieldset">
              <legend>🎰 スロットの台と設定</legend>
              <label class="field">
                <span>台の数（1〜20）</span>
                <input type="number" name="slotCount" min={1} max={20} value={String(c.slotMachines.length)} required />
              </label>
              <div class="slot-settings">
                {Array.from({ length: c.slotMachines.length }, (_, i) => (
                  <SlotSelect i={i} value={c.slotMachines[i]} />
                ))}
              </div>
              {c.slotMachines.length < 20 && (
                <details class="slot-more">
                  <summary>
                    {c.slotMachines.length + 1} 番台〜20 番台（台の数を増やしたときの設定）
                  </summary>
                  <div class="slot-settings">
                    {Array.from({ length: 20 - c.slotMachines.length }, (_, k) => (
                      <SlotSelect i={c.slotMachines.length + k} value={undefined} />
                    ))}
                  </div>
                </details>
              )}
              <p class="note">
                おまかせは毎日（日本時間）、その日に最初に回されたときに設定を引きます（設定 1: {RANDOM_SETTING_ODDS[1]}%・2: {RANDOM_SETTING_ODDS[2]}%・3: {RANDOM_SETTING_ODDS[3]}%・4: {RANDOM_SETTING_ODDS[4]}%・5:{' '}
                {RANDOM_SETTING_ODDS[5]}%・6: {RANDOM_SETTING_ODDS[6]}%）。かっこの中は戻り率。設定 4 以上は 100% を超えるので、メンバーが平均で増やせます。
              </p>
            </fieldset>
            <button type="submit" class="ok">
              保存
            </button>
          </form>
          <form method="post" action="/economy/casino/role" class="inline-form">
            <input type="hidden" name="_csrf" value={p.session.csrfToken} />
            <button type="submit">🎰 カジノ ロールを用意する（なければ作る）・入れる人をそのロールにする</button>
          </form>
        </section>
      )}
    </Layout>
  );
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const sign = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 日ごとのグラフ（30 日）と、ゲームごとの賭けた額。表でも見られる */
function CasinoCharts(p: { daily: CasinoDay[]; stats: CasinoStat[]; coinName: string; range: string }) {
  const points: ChartPoint[] = p.daily.map((d) => ({ label: md(d.date), title: d.date }));
  const house = p.daily.map((d) => d.wagered - d.paid);
  const total = house.reduce((a, b) => a + b, 0);
  const wagered = p.daily.reduce((a, d) => a + d.wagered, 0);
  const paid = p.daily.reduce((a, d) => a + d.paid, 0);
  return (
    <section class="card">
      <h2>📈 グラフ（30 日）</h2>
      <div class="stats">
        <div class="stat">
          <div class="label">胴元の収支（30 日）</div>
          <div class="value">
            {sign(total)}
            <small>{p.coinName}</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">賭けた合計（30 日）</div>
          <div class="value">
            {fmt(wagered)}
            <small>{p.coinName}</small>
          </div>
        </div>
        <div class="stat">
          <div class="label">戻り率（30 日）</div>
          <div class="value">{wagered ? pct(paid / wagered) : '—'}</div>
        </div>
      </div>
      <h3>日ごとの胴元の収支</h3>
      <p class="note">上はメンバーから入った（胴元のもうけ）、下はメンバーに出た（胴元の持ち出し）。</p>
      <ColumnChart
        points={points}
        up={{ name: '胴元のもうけ', values: house.map((v) => Math.max(0, v)) }}
        down={{ name: '胴元の持ち出し', values: house.map((v) => Math.max(0, -v)) }}
        unit={` ${p.coinName}`}
        label="日ごとの胴元の収支（30 日）"
      />
      <h3>日ごとの賭けた合計</h3>
      <LineChart points={points} values={p.daily.map((d) => d.wagered)} unit={` ${p.coinName}`} label="日ごとの賭けた合計（30 日）" />
      <h3>日ごとの遊んだ人</h3>
      <LineChart points={points} values={p.daily.map((d) => d.players)} unit=" 人" label="日ごとの遊んだ人（30 日）" />
      <h3>ゲームごとの賭けた額（{p.range}）</h3>
      {p.stats.length ? (
        <BarList rows={[...p.stats].sort((a, b) => b.wagered - a.wagered).map((s) => ({ name: `${CASINO_LABEL[s.game as CasinoGame]?.emoji ?? ''} ${CASINO_LABEL[s.game as CasinoGame]?.name ?? s.game}`, value: s.wagered }))} unit={` ${p.coinName}`} label="ゲームごとの賭けた額" />
      ) : (
        <p class="note">まだ遊ばれていません。</p>
      )}
      <details>
        <summary>表で見る（日ごと）</summary>
        <table class="compact">
          <thead>
            <tr>
              <th>日</th>
              <th class="num">回数</th>
              <th class="num">遊んだ人</th>
              <th class="num">賭けた</th>
              <th class="num">戻した</th>
              <th class="num">胴元の収支</th>
            </tr>
          </thead>
          <tbody>
            {[...p.daily].reverse().map((d) => (
              <tr>
                <td>{d.date}</td>
                <td class="num">{fmt(d.plays)}</td>
                <td class="num">{fmt(d.players)}</td>
                <td class="num">{fmt(d.wagered)}</td>
                <td class="num">{fmt(d.paid)}</td>
                <td class="num">{sign(d.wagered - d.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** スロットの台（今日の設定とデータ）と、設定ごとの結果（30 日） */
function SlotMachines(p: { casino: CasinoConfig; floor: MachineDay[]; picks: Record<string, number>; settingStats: SettingStat[]; coinName: string }) {
  const settingOf = (i: number) => {
    const conf = p.casino.slotMachines[i];
    if (conf !== 'random' && conf !== undefined) return `設定 ${conf}`;
    const got = p.picks[String(i + 1)];
    return got ? `おまかせ → 今日は 設定 ${got}` : 'おまかせ（今日はまだ決まっていない）';
  };
  return (
    <section class="card">
      <h2>🎰 スロットの台（今日）</h2>
      <p class="note">設定はメンバーには見えません（データから推理して台を選びます）。差枚はその台でメンバーが増やした（＋）・減らした（−）銭の合計。</p>
      <table class="compact">
        <thead>
          <tr>
            <th>台</th>
            <th>設定</th>
            <th class="num">総回転</th>
            <th class="num">BIG</th>
            <th class="num">REG</th>
            <th class="num">合成</th>
            <th class="num">差枚</th>
          </tr>
        </thead>
        <tbody>
          {p.floor.map((d, i) => (
            <tr>
              <td>{i + 1} 番台</td>
              <td>{settingOf(i)}</td>
              <td class="num">{fmt(d.games)}</td>
              <td class="num">{d.big}</td>
              <td class="num">{d.reg}</td>
              <td class="num">{combinedOdds(d) ? `1/${combinedOdds(d)!.toFixed(1)}` : '—'}</td>
              <td class="num">{sign(d.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>設定ごとの結果（30 日）と理論値</h3>
      <table class="compact">
        <thead>
          <tr>
            <th>設定</th>
            <th class="num">回転</th>
            <th class="num">BIG（実際／理論）</th>
            <th class="num">REG（実際／理論）</th>
            <th class="num">戻り率（実際／理論）</th>
          </tr>
        </thead>
        <tbody>
          {SETTING_KEYS.map((k) => {
            const r = p.settingStats.find((x) => x.setting === k);
            const odds = (n: number | undefined) => (r && n ? `1/${(r.plays / n).toFixed(0)}` : '—');
            return (
              <tr>
                <td>設定 {k}</td>
                <td class="num">{fmt(r?.plays ?? 0)}</td>
                <td class="num">
                  {odds(r?.big)}／1/{roleOdds('big', k as SlotSetting).toFixed(0)}
                </td>
                <td class="num">
                  {odds(r?.reg)}／1/{roleOdds('reg', k as SlotSetting).toFixed(0)}
                </td>
                <td class="num">
                  {r?.wagered ? pct(r.paid / r.wagered) : '—'}／{pct(slotRtp(k as SlotSetting))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="note">回転が少ないうちは、実際の数字は理論値から大きくずれます（数千回転でだいたい近づきます）。</p>
    </section>
  );
}

/** 1 台の設定の選び方 */
function SlotSelect(p: { i: number; value: number | 'random' | undefined }) {
  return (
    <label class="field">
      <span>{p.i + 1} 番台</span>
      <select name={`slot_${p.i + 1}`}>
        <option value="random" selected={(p.value ?? 'random') === 'random'}>
          おまかせ（日替わり）
        </option>
        {SETTING_KEYS.map((k) => (
          <option value={String(k)} selected={p.value === k}>
            設定 {k}（{pct(slotRtp(k))}）
          </option>
        ))}
      </select>
    </label>
  );
}

/** 入れる人の説明 */
const accessText = (c: CasinoConfig) =>
  c.accessRoleId ? `「${c.accessRoleName ?? 'カジノ'}」のロールがある人だけ` : c.requireRank ? '位のロールがある人だけ' : 'サーバーにいる人ならだれでも';
