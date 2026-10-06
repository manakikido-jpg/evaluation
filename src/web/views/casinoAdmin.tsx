import type { CasinoConfig, CasinoGame } from '../../config.js';
import { CASINO_GAMES } from '../../config.js';
import type { CasinoMatch, KeibaHorseRow } from '../../db/schema.js';
import { KB_APT, KB_CLASSES, KB_COATS, KB_STYLES, KB_SURFACES } from '../../services/casino/keiba.js';
import { CASINO_LABEL, type CasinoStat } from '../../services/casino/casino.js';
import { Layout, type SessionView } from './layout.js';
import { BarList, ColumnChart, LineChart, type ChartPoint } from './charts.js';
import type { CasinoDay, SettingStat } from '../../services/casino/report.js';
import { combinedOdds, type MachineDay } from '../../services/casino/slotFloor.js';
import { RANDOM_SETTING_ODDS, roleOdds, SETTING_KEYS, slotRtp, type SlotSetting } from '../../services/casino/slots.js';
import { AT_RTP_APPROX } from '../../services/casino/slotAt.js';
import { AT_ART_SLOTS, type ArtSlot } from '../../services/casino/slotArt.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');

export const CASINO_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '🎰 カジノの設定を保存しました（1 分以内に反映されます）。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（最低の賭けは最高以下に）。', kind: 'warn' },
  no_role_picked: { text: '「決めたロールがある人だけ」にするときは、ロールを選んでください。', kind: 'warn' },
  role_made: { text: '🎰 カジノのロールを用意して、入れる人をそのロールにしました。Discord でメンバーにロールを渡してください。', kind: 'ok' },
  role_failed: { text: 'ロールを作れませんでした。BOT に「ロールの管理」の権限があるか確かめてください。', kind: 'warn' },
  horse_saved: { text: '🏇 馬の名簿を変えました（次のレースから出ます）。', kind: 'ok' },
  horse_invalid: { text: '馬の名前は 1〜18 文字で入れてください。', kind: 'warn' },
  horse_taken: { text: 'その名前の馬はもういます（引退した馬とは同じ名前にできます）。', kind: 'warn' },
  art_saved: { text: '🦊 絵を保存しました（AT 機の画面はすぐ新しい絵になります）。', kind: 'ok' },
  art_partial: { text: '一部の絵は保存できませんでした（1 枚 4MB まで・PNG・WebP・JPEG・GIF）。保存できなかった欄は「まだ」のままです。', kind: 'warn' },
  art_deleted: { text: '🦊 絵を消しました（仮の絵に戻ります）。', kind: 'ok' },
  art_none: { text: '絵のファイルを選んでください。', kind: 'warn' },
  art_big: { text: '絵が大きすぎます（1 枚 4MB まで）。', kind: 'warn' },
  art_bad: { text: '絵として読めませんでした（PNG・WebP・JPEG・GIF）。', kind: 'warn' },
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
  /** AT の島の今日のおまかせの設定 */
  atPicks?: Record<string, number>;
  settingStats: SettingStat[];
  roles: { id: string; name: string }[];
  /** 🏇 競馬の名簿 */
  horses?: KeibaHorseRow[];
  /** お祝いを流すチャンネルを選ぶ */
  channels?: { id: string; name: string }[];
  /** 🦊 AT 機の入っている絵（key → URL。社務所で入れたもの） */
  art?: Record<string, string>;
  /** 🦊 GitHub のフォルダ（src/web/public/at/）に置いた絵 */
  fileArt?: Record<string, string>;
}) {
  const f = p.flash && Object.hasOwn(CASINO_FLASH, p.flash) ? CASINO_FLASH[p.flash] : undefined;
  const c = p.casino;
  const total = p.stats.reduce((a, s) => ({ plays: a.plays + s.plays, wagered: a.wagered + s.wagered, paid: a.paid + s.paid }), { plays: 0, wagered: 0, paid: 0 });
  const name = (id: string | null) => (id ? (p.names.get(id) ?? id) : '—');
  return (
    <Layout title="カジノ" session={p.session} nav="casino" scripts={['charts.js']}>
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
              <legend>🀄 咲楽ノ宮雀荘の賭け</legend>
              <label class="check">
                <input type="radio" name="mahjongBets" value="yes" checked={c.mahjongBets} /> 賭けられる（卓を立てる人が、参加費を賭けるか賭けないかを選ぶ）
              </label>
              <label class="check">
                <input type="radio" name="mahjongBets" value="no" checked={!c.mahjongBets} /> 賭けなし（どの卓も銭を動かさず、点数だけで遊ぶ）
              </label>
              <p class="note">賭けなしにしても、もう賭けて始まっている卓はそのまま最後まで進みます。</p>
            </fieldset>
            <fieldset class="perms">
              <legend>🏇 みんなでダービーの馬主</legend>
              <label class="field">
                <span>馬 1 頭の値段（0 で買えない。払った銭は胴元へ）</span>
                <input type="number" name="keibaHorsePrice" min={0} max={10000000} value={String(c.keibaHorsePrice)} required />
              </label>
              <label class="field">
                <span>1 人が持てる頭数（引退した馬は数えない）</span>
                <input type="number" name="keibaMaxOwned" min={0} max={20} value={String(c.keibaMaxOwned)} required />
              </label>
              <label class="field">
                <span>調教 1 回の値段（0 で調教できない）</span>
                <input type="number" name="keibaTrainPrice" min={0} max={1000000} value={String(c.keibaTrainPrice)} required />
              </label>
              <h3 class="sub">🎁 馬主への還元</h3>
              <label class="field">
                <span>賞金・出走手当の倍率（%。100 で「賭けた合計の数 %」のまま）</span>
                <input type="number" name="keibaPrizeMult" min={0} max={1000} value={String(c.keibaPrizeMult)} required />
              </label>
              <div class="field">
                <span>最低保証の 1 着賞金（賭けが少なくても、この額は出る。2〜5 着はその 4・2.6・2・1.4 割。胴元が出す）</span>
                <div class="purse-grid">
                  {KB_CLASSES.map((name, i) => (
                    <label>
                      <small>{name}</small>
                      <input type="number" name={`keibaPurse_${i}`} min={0} max={1000000} value={String(c.keibaPurse[i] ?? 0)} required />
                    </label>
                  ))}
                </div>
              </div>
              <label class="field">
                <span>最低保証で足す分を、1 人が 1 日に受け取れる上限（0 で上限なし）。最低保証は 2 人以上が賭けたレースだけ</span>
                <input type="number" name="keibaPurseDailyCap" min={0} max={100000000} value={String(c.keibaPurseDailyCap)} required />
              </label>
              <label class="field">
                <span>応援金（その馬の単勝・複勝に、馬主でない人が賭けた額の何 %。着順に関係なく馬主へ）</span>
                <input type="number" name="keibaFanPct" min={0} max={20} value={String(c.keibaFanPct)} required />
              </label>
              <label class="field">
                <span>血統ロイヤリティ（産駒が稼いだ賞金の何 % を親の馬主へ。胴元が出す）</span>
                <input type="number" name="keibaRoyaltyPct" min={0} max={50} value={String(c.keibaRoyaltyPct)} required />
              </label>
              <label class="field">
                <span>功労金（馬主が引退させるとき、1 勝につき。重賞の勝ちは 3 倍。胴元が出す）</span>
                <input type="number" name="keibaRetirePerWin" min={0} max={1000000} value={String(c.keibaRetirePerWin)} required />
              </label>
              <label class="field">
                <span>馬主の馬が勝ったときに、お祝いを流すチャンネル</span>
                <select name="keibaAnnounceChannelId">
                  <option value="none">流さない</option>
                  {(p.channels ?? []).map((ch) => (
                    <option value={ch.id} selected={ch.id === c.keibaAnnounceChannelId}>
                      #{ch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>🐴 馬主ロール（走れる馬を持っている人に付ける・いなくなったら外す）</span>
                <select name="keibaOwnerRoleId">
                  <option value="none">付けない</option>
                  {p.roles.map((r) => (
                    <option value={r.id} selected={r.id === c.keibaOwnerRoleId}>
                      @{r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>🏆 G1 馬主ロール（G1 を勝ったことがある人に付ける。外さない）</span>
                <select name="keibaG1RoleId">
                  <option value="none">付けない</option>
                  {p.roles.map((r) => (
                    <option value={r.id} selected={r.id === c.keibaG1RoleId}>
                      @{r.name}
                    </option>
                  ))}
                </select>
              </label>
              <p class="note">
                馬主の馬が 1〜5 着に入ると、そのレースでメンバーが賭けた合計の数 %（新馬・未勝利 3%・1〜3 勝クラス 4%・オープン 5%・G3 6%・G2 7%・G1 8%）を 50・20・13・10・7 の割合で、出走した馬主の馬には 1 頭 0.25% の出走手当も払います（合わせて胴元の取り分 10% の中から）。
              </p>
            </fieldset>
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
            <fieldset class="perms slot-fieldset" id="casino-at">
              <legend>🦊 AT 機（鬼斬り白狐）の島</legend>
              <label class="field check">
                <input type="checkbox" name="atOpen" value="yes" checked={c.atOpen} />
                <span>公開する（メンバーが遊べるようにする。外すと準備中になり、ホールにも出ません）</span>
              </label>
              <label class="field">
                <span>1 ゲームの賭け（{p.coinName}。島で決まっていて、メンバーは変えられません）</span>
                <input type="number" name="atBet" min={1} max={1000000} value={String(c.atBet)} required />
              </label>
              <label class="field">
                <span>台の数（1〜20）</span>
                <input type="number" name="atCount" min={1} max={20} value={String(c.atMachines.length)} required />
              </label>
              <div class="slot-settings">
                {Array.from({ length: 20 }, (_, i) =>
                  i < c.atMachines.length ? <SlotSelect i={i} value={c.atMachines[i]} at today={p.atPicks?.[String(i + 1)]} /> : null,
                )}
              </div>
              {c.atMachines.length < 20 && (
                <details class="slot-more">
                  <summary>
                    {c.atMachines.length + 1} 番台〜20 番台（台の数を増やしたときの設定）
                  </summary>
                  <div class="slot-settings">
                    {Array.from({ length: 20 - c.atMachines.length }, (_, k) => (
                      <SlotSelect i={c.atMachines.length + k} value={undefined} at />
                    ))}
                  </div>
                </details>
              )}
              <p class="note">
                設定が高いほど AT に当たりやすくなります（かっこの中は戻り率の目安。AT 中にナビどおり押したとき）。おまかせは毎日、その日に最初に回されたときに引きます（出やすさはスロットと同じ）。台の回転数・AT の残りは台に残ります。
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
      {p.horses && <HorseRoster horses={p.horses} csrf={p.session.csrfToken} />}
      {p.guji && p.art && <AtArt art={p.art} fileArt={p.fileArt ?? {}} csrf={p.session.csrfToken} demoUrl={`${p.url}/atslot/demo`} />}
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
function SlotSelect(p: { i: number; value: number | 'random' | undefined; at?: boolean; today?: number }) {
  return (
    <label class="field">
      <span>
        {p.i + 1} 番台{p.today ? <small>（今日は設定 {p.today}）</small> : null}
      </span>
      <select name={`${p.at ? 'at' : 'slot'}_${p.i + 1}`}>
        <option value="random" selected={(p.value ?? 'random') === 'random'}>
          おまかせ（日替わり）
        </option>
        {SETTING_KEYS.map((k) => (
          <option value={String(k)} selected={p.value === k}>
            設定 {k}（{pct(p.at ? AT_RTP_APPROX[k] : slotRtp(k))}）
          </option>
        ))}
      </select>
    </label>
  );
}

/** 入れる人の説明 */
const accessText = (c: CasinoConfig) =>
  c.accessRoleId ? `「${c.accessRoleName ?? 'カジノ'}」のロールがある人だけ` : c.requireRank ? '位のロールがある人だけ' : 'サーバーにいる人ならだれでも';

/** 🏇 みんなでダービーの馬の名簿（名前をつける・入れる・引退） */
function HorseRoster(p: { horses: KeibaHorseRow[]; csrf: string }) {
  const active = p.horses.filter((h) => !h.retiredAt);
  const surf = (n: number) => (n === 2 ? '芝もダートも' : `${KB_SURFACES[n]}`);
  return (
    <section class="card anchor" id="casino-horses">
      <h2>🏇 馬の名簿（みんなでダービー）</h2>
      <p class="note">
        レースの 8 頭はこの名簿から選ばれ、走るたびに成績がたまります。走れる馬が 16 頭より少ないと、BOT がおまかせの名前で足します（名前はあとから変えられます）。強さ（速さ・スタミナ）は入れたときに決まり、画面には出ません。名前は 1〜18 文字。
      </p>
      <form method="post" action="/economy/casino/horses" class="inline-form">
        <input type="hidden" name="_csrf" value={p.csrf} />
        <input type="text" name="name" maxlength={18} placeholder="新しい馬の名前" required />
        <button type="submit" class="ok">
          馬を入れる
        </button>
      </form>
      <p>
        走れる馬 <strong>{active.length} 頭</strong>（引退 {p.horses.length - active.length} 頭）
      </p>
      {p.horses.length === 0 ? (
        <p class="empty">まだいません。最初のレースを開いたときに BOT が 16 頭入れます（先に名前を決めて入れておくこともできます）。</p>
      ) : (
        <table class="compact">
          <thead>
            <tr>
              <th>名前</th>
              <th>脚質・得意</th>
              <th>成績</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.horses.map((h) => (
              <tr class={h.retiredAt ? 'muted' : ''}>
                <td>
                  <form method="post" action={`/economy/casino/horses/${h.id}`} class="inline-form">
                    <input type="hidden" name="_csrf" value={p.csrf} />
                    <input type="text" name="name" value={h.name} maxlength={18} required aria-label="馬の名前" />
                    <button type="submit">名前を変える</button>
                  </form>
                </td>
                <td class="note">
                  {KB_COATS[h.coat]}・{KB_STYLES[h.style]}・{KB_APT[h.apt]}・{surf(h.surf)}
                </td>
                <td>
                  {h.starts} 戦 {h.wins} 勝
                  <span class="note">
                    {' '}
                    [{h.wins}-{h.seconds}-{h.thirds}-{Math.max(0, h.starts - h.wins - h.seconds - h.thirds)}]
                  </span>
                </td>
                <td>
                  <form method="post" action={`/economy/casino/horses/${h.id}/retire`} class="inline-form">
                    <input type="hidden" name="_csrf" value={p.csrf} />
                    <input type="hidden" name="retired" value={h.retiredAt ? 'no' : 'yes'} />
                    <button type="submit">{h.retiredAt ? '戻す' : '引退'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const ART_GROUPS: { group: ArtSlot['group']; title: string }[] = [
  { group: 'bg', title: '液晶の背景' },
  { group: 'char', title: 'キャラ（白狐・鬼）' },
  { group: 'logo', title: 'ロゴ' },
  { group: 'cab', title: '台の飾り' },
  { group: 'sym', title: 'リールの絵柄' },
];

/** 🦊 AT 機の絵（入れた絵は液晶・リールにすぐ出る。入れていないところは仮の絵） */
function AtArt(p: { art: Record<string, string>; fileArt: Record<string, string>; csrf: string; demoUrl: string }) {
  const shown = (key: string) => p.art[key] ?? p.fileArt[key];
  const filled = AT_ART_SLOTS.filter((s) => shown(s.key)).length;
  return (
    <section class="card anchor" id="casino-art">
      <h2>🦊 AT 機「鬼斬り白狐」の絵</h2>
      <p class="note">
        📁 GitHub の <code>src/web/public/at/</code> に、下の名前（例: <code>bg-normal.png</code>）で絵を置いても入ります（自動更新のあと、数分で台に出ます）。社務所で入れた絵があれば、そちらが先に出ます。
      </p>
      <p class="note">
        液晶の演出・リールに使う絵です。入れていないところはコードで描いた仮の絵が出ます。キャラ・ロゴ・リールの絵柄は、背景が透明な PNG か WebP にしてください（1 枚 4MB まで。大きさはおすすめ）。入れ替えるとすぐ新しい絵になります。
      </p>
      <p>
        入っている絵 <strong>{filled}</strong> / {AT_ART_SLOTS.length}・{' '}
        <a href={p.demoUrl} target="_blank" rel="noopener">
          🎬 カジノで演出を見る
        </a>
        <span class="note">（運営だけ。準備中でも見られて、銭は動きません。カジノに Discord でログインして開きます）</span>
      </p>
      <form method="post" action="/economy/casino/art" enctype="multipart/form-data" id="art-form" data-art-form>
        <input type="hidden" name="_csrf" value={p.csrf} />
        {ART_GROUPS.map((g) => (
          <>
            <h3>{g.title}</h3>
            <div class="art-grid">
              {AT_ART_SLOTS.filter((s) => s.group === g.group).map((s) => (
                <div class={`art-slot${shown(s.key) ? ' has' : ''}`} id={`art-${s.key}`}>
                  <div class="art-preview">{shown(s.key) ? <img src={shown(s.key)} alt={s.label} loading="lazy" /> : <span class="note">まだ（仮の絵）</span>}</div>
                  <strong>{s.label}</strong>
                  <code class="art-key">{s.key}</code>
                  {p.art[s.key] ? (
                    <span class="art-src">🖼 社務所で入れた絵{p.fileArt[s.key] ? '（フォルダの絵より先）' : ''}</span>
                  ) : p.fileArt[s.key] ? (
                    <span class="art-src">📁 フォルダの絵</span>
                  ) : null}
                  <span class="note">
                    {s.size}
                    {s.note ? `・${s.note}` : ''}
                  </span>
                  <label class="art-pick">
                    <span>{shown(s.key) ? '別の絵にする' : '絵を選ぶ'}</span>
                    <input type="file" name={`img_${s.key}`} accept="image/png,image/webp,image/jpeg,image/gif" data-art-input aria-label={`${s.label}の絵`} />
                  </label>
                  {p.art[s.key] && (
                    <button type="submit" form={`art-del-${s.key}`} class="art-del">
                      {p.fileArt[s.key] ? '消す（フォルダの絵に戻す）' : '消す（仮の絵に戻す）'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        ))}
        <div class="art-savebar">
          <span data-art-count>絵を選んだら、ここで保存します（何枚でもまとめて）。</span>
          <button type="submit" class="ok">
            選んだ絵を保存
          </button>
        </div>
      </form>
      {AT_ART_SLOTS.filter((s) => p.art[s.key]).map((s) => (
        <form method="post" action={`/economy/casino/art/${s.key}/delete`} id={`art-del-${s.key}`} hidden>
          <input type="hidden" name="_csrf" value={p.csrf} />
        </form>
      ))}
    </section>
  );
}
