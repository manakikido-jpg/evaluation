import type { CasinoConfig, CasinoGame } from '../../config.js';
import { CASINO_GAMES } from '../../config.js';
import type { CasinoMatch } from '../../db/schema.js';
import { CASINO_LABEL, type CasinoStat } from '../../services/casino/casino.js';
import { Layout, type SessionView } from './layout.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');

export const CASINO_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  saved: { text: '🎰 カジノの設定を保存しました（1 分以内に反映されます）。', kind: 'ok' },
  invalid: { text: '入力を確かめてください（最低の賭けは最高以下に）。', kind: 'warn' },
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
          メンバーはここから Discord でログインして遊びます（{c.requireRank ? '位のロールがある人だけ' : 'サーバーにいる人ならだれでも'}）。運営の画面（秘密の入口・ID とパスワード）とは別のログインで、こちらから運営の画面には入れません。Discord の
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

      {p.guji && (
        <section class="card">
          <h2>⚙ 設定（宮司）</h2>
          <form method="post" action="/economy/casino" class="fields">
            <input type="hidden" name="_csrf" value={p.session.csrfToken} />
            <label class="field check">
              <input type="checkbox" name="enabled" value="yes" checked={c.enabled} />
              <span>カジノを開ける（止めるとメンバーには「お休み」と出ます。途中のゲームは開けたときに続けられます）</span>
            </label>
            <label class="field check">
              <input type="checkbox" name="requireRank" value="yes" checked={c.requireRank} />
              <span>位のロール（🔰参拝者 など）がある人だけ入れる</span>
            </label>
            <label class="field">
              <span>1 回に賭けられる最低（{p.coinName}）</span>
              <input type="number" name="minBet" min={1} max={1000000} value={String(c.minBet)} required />
            </label>
            <label class="field">
              <span>1 回に賭けられる最高（{p.coinName}）</span>
              <input type="number" name="maxBet" min={1} max={1000000} value={String(c.maxBet)} required />
            </label>
            <label class="field">
              <span>1 日（日本時間）に賭けられる合計（0 で上限なし）</span>
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
            <button type="submit" class="ok">
              保存
            </button>
          </form>
        </section>
      )}
    </Layout>
  );
}
