import type { Child } from 'hono/jsx';
import type { CasinoConfig, CasinoGame } from '../../config.js';
import type { CasinoGameRow, CasinoMatch, MemberSession } from '../../db/schema.js';
import { BAC_BETS, type BacBet } from '../../services/casino/baccarat.js';
import { bjView, type BjResult, type BjState } from '../../services/casino/blackjack.js';
import { cardText, isRed, rankText, SUITS, suitOf } from '../../services/casino/cards.js';
import { CASINO_LABEL, type BaccaratState, type OthelloCpuState, type RouletteState, type SlotsState } from '../../services/casino/casino.js';
import { HL_MAX_STEPS, hlNextMult, hlWays, type HlState } from '../../services/casino/highlow.js';
import { countStones, legalMoves, OTHELLO_LEVELS, type OthelloLevel, type Stone } from '../../services/casino/othello.js';
import { rouletteBetLabel, rouletteColor, ROULETTE_BETS } from '../../services/casino/roulette.js';
import { SLOT_SYMBOLS, slotEmoji } from '../../services/casino/slots.js';
import { MOVE_CHOICES, moveSecondsOf, type VersusState } from '../../services/casino/versus.js';
import { assetUrl } from '../assets.js';

export type Coin = { name: string; emoji: string };
const fmt = (n: number) => n.toLocaleString('ja-JP');
const money = (coin: Coin, n: number) => `${coin.emoji}${fmt(n)} ${coin.name}`;

/** みんなで遊ぶもの（ロビーで分けて出す） */
const TABLE_GAMES: CasinoGame[] = ['poker', 'bj_table', 'baccarat_table', 'roulette_table', 'daifugo', 'babanuki', 'versus'];

export type CasinoMe = { session: MemberSession; balance: number; coin: Coin };

export function CasinoLayout(props: { title: string; me?: CasinoMe; children: Child; htmx?: boolean; back?: boolean }) {
  const me = props.me;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} | 咲楽ノ宮カジノ</title>
        <link rel="stylesheet" href={assetUrl('casino.css')} />
        {props.htmx && <script src={assetUrl('htmx.min.js')} defer></script>}
        <script src={assetUrl('casino.js')} defer></script>
      </head>
      <body class="casino">
        <div class="c-sky" aria-hidden="true">
          {Array.from({ length: 14 }, () => (
            <span class="c-petal"></span>
          ))}
        </div>
        <header class="c-top">
          <a href="/casino" class="c-logo">
            <span class="c-logo-mark">🌸</span>
            <span>
              咲楽ノ宮<b>カジノ</b>
            </span>
          </a>
          {me && (
            <div class="c-me">
              <span class="c-balance" title="持っている銭">
                {money(me.coin, me.balance)}
              </span>
              {me.session.avatarUrl && <img src={me.session.avatarUrl} alt="" class="c-avatar" />}
              <span class="c-name">{me.session.displayName}</span>
              <form method="post" action="/casino/logout" class="c-inline">
                <input type="hidden" name="_csrf" value={me.session.csrfToken} />
                <button type="submit" class="c-link">
                  ログアウト
                </button>
              </form>
            </div>
          )}
        </header>
        <main class="c-main">
          {props.back && (
            <p class="c-back">
              <a href="/casino">← ロビーへ</a>
            </p>
          )}
          {props.children}
        </main>
        <footer class="c-foot">銭はサーバーの中だけのものです。お金に換えることはできません。遊びすぎに気をつけて、楽しくどうぞ。</footer>
      </body>
    </html>
  );
}

const LOGIN_ERROR: Record<string, string> = {
  state: 'ログインをやり直してください。',
  failed: 'Discord とつながりませんでした。時間をおいてもう一度どうぞ。',
  not_member: '咲楽ノ宮のメンバーだけが入れます。',
  no_rank: '位（🔰参拝者 など）のロールがある人だけ入れます。',
  expired: 'ログインの期限が切れました。もう一度ログインしてください。',
  closed: 'いまカジノはお休みです。',
};

export function CasinoLanding(props: { error?: string }) {
  return (
    <CasinoLayout title="入口">
      <section class="c-hero">
        <div class="c-hero-suits" aria-hidden="true">
          <span>♠</span>
          <span class="red">♥</span>
          <span class="red">♦</span>
          <span>♣</span>
        </div>
        <h1>咲楽ノ宮カジノ</h1>
        <p>ブラックジャック・バカラ・スロット・ルーレット・オセロ。サーバーの銭で遊べます。</p>
        {props.error && LOGIN_ERROR[props.error] && <p class="c-alert">{LOGIN_ERROR[props.error]}</p>}
        <a class="c-btn c-btn-discord" href="/casino/auth/discord">
          Discord でログインして入る
        </a>
        <p class="c-note">ログインで分かるのは Discord の名前とアイコンだけです（メールなどは見ません）。</p>
      </section>
    </CasinoLayout>
  );
}

export function CasinoClosed(props: { me: CasinoMe }) {
  return (
    <CasinoLayout title="お休み" me={props.me}>
      <section class="c-panel c-center">
        <h1>🌙 本日はお休みです</h1>
        <p>カジノはいま閉まっています。また遊びに来てください。</p>
      </section>
    </CasinoLayout>
  );
}

export type LobbyProps = {
  me: CasinoMe;
  casino: CasinoConfig;
  today: number;
  recent: CasinoGameRow[];
  bigWins: (CasinoGameRow & { name: string })[];
  openMatches: number;
  /** 種類ごとの開いている卓の数 */
  tables: Map<string, number>;
  mine?: { id: number; kind: string };
  msg?: string;
};

export function CasinoLobby(p: LobbyProps) {
  const games = p.casino.games;
  return (
    <CasinoLayout title="ロビー" me={p.me}>
      <section class="c-welcome">
        <div class="c-welcome-text">
          <p class="c-welcome-kicker">SAKURANOMIYA CASINO</p>
          <h1>ようこそ、{p.me.session.displayName} さん</h1>
        <p class="c-muted">
          1 回 {money(p.me.coin, p.casino.minBet)}〜{money(p.me.coin, p.casino.maxBet)}
          {p.casino.dailyBetLimit > 0 && (
            <>
              ・今日賭けた分 {fmt(p.today)} / {fmt(p.casino.dailyBetLimit)}
            </>
          )}
        </p>
        </div>
        <div class="c-welcome-bal">
          <span class="c-muted">持っている{p.me.coin.name}</span>
          <b>
            {p.me.coin.emoji}
            {fmt(p.me.balance)}
          </b>
        </div>
      </section>
      {p.msg && <Msg msg={p.msg} />}
      {p.mine && (
        <a class="c-mine" href={`/casino/t/${p.mine.id}`}>
          <span class="c-mine-dot" aria-hidden="true"></span>
          <span>
            {CASINO_LABEL[p.mine.kind as CasinoGame]?.emoji} 卓 #{p.mine.id}（{CASINO_LABEL[p.mine.kind as CasinoGame]?.name}）に座っています
          </span>
          <b>
            <span class="c-mine-long">卓へ戻る </span>
            <span class="c-mine-short">戻る </span>→
          </b>
        </a>
      )}
      <h2 class="c-section">👥 みんなで遊ぶ</h2>
      <section class="c-games">
        {TABLE_GAMES.filter((g) => games.includes(g)).map((g) => (
            <a href={g === 'versus' ? '/casino/versus' : `/casino/tables/${g}`} class={`c-game c-game-${g} c-game-multi`}>
              <span class="c-game-emoji">
                <span>{CASINO_LABEL[g].emoji}</span>
              </span>
              <span class="c-game-name">{CASINO_LABEL[g].name}</span>
              <span class="c-game-note">{CASINO_LABEL[g].note}</span>
              {g === 'versus' && p.openMatches > 0 && <span class="c-badge">{p.openMatches} 部屋</span>}
              {(p.tables.get(g) ?? 0) > 0 && <span class="c-badge">{p.tables.get(g)} 卓</span>}
            </a>
          ))}
      </section>
      <h2 class="c-section">🙋 1 人で遊ぶ</h2>
      <section class="c-games">
        {games
          .filter((g) => !TABLE_GAMES.includes(g))
          .map((g) => (
            <a href={`/casino/${g}`} class={`c-game c-game-${g}`}>
              <span class="c-game-emoji">
                <span>{CASINO_LABEL[g].emoji}</span>
              </span>
              <span class="c-game-name">{CASINO_LABEL[g].name}</span>
              <span class="c-game-note">{CASINO_LABEL[g].note}</span>
            </a>
          ))}
      </section>
      <div class="c-two">
        <section class="c-panel">
          <h2>🏆 最近の大当たり</h2>
          {p.bigWins.length === 0 ? (
            <p class="c-muted">まだありません。最初の大当たりはあなたかも。</p>
          ) : (
            <ul class="c-list">
              {p.bigWins.map((w) => (
                <li>
                  <span>
                    {CASINO_LABEL[w.game as CasinoGame]?.emoji} {w.name}
                  </span>
                  <b class="c-win">+{fmt(w.payout - w.bet)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section class="c-panel">
          <h2>📜 あなたの最近の勝負</h2>
          {p.recent.length === 0 ? (
            <p class="c-muted">まだ遊んでいません。</p>
          ) : (
            <ul class="c-list">
              {p.recent.map((g) => (
                <li>
                  <span>
                    {CASINO_LABEL[g.game as CasinoGame]?.emoji} {CASINO_LABEL[g.game as CasinoGame]?.name}（{fmt(g.bet)}）
                  </span>
                  <Net n={g.payout - g.bet} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </CasinoLayout>
  );
}

const Net = (p: { n: number }) => (p.n > 0 ? <b class="c-win">+{fmt(p.n)}</b> : p.n < 0 ? <b class="c-lose">{fmt(p.n)}</b> : <b class="c-even">±0</b>);

const MSG: Record<string, string> = {
  closed: 'いまカジノはお休みです。',
  game_off: 'このゲームはいま遊べません。',
  bad_bet: '賭ける銭の量を確かめてください。',
  limit: '今日賭けられる上限に届きました。また明日どうぞ。',
  poor: '銭が足りません。',
  invalid: 'その操作はいまできません。',
  conflict: '同時に押されたので、1 回だけ受け付けました。',
  busy: '遊んでいる途中のものがあります。',
  self: '自分の部屋には入れません。',
  taken: 'ほかの人が先に入りました。',
  not_found: '見つかりませんでした（終わったかもしれません）。',
  not_yours: 'あなたの番・部屋ではありません。',
  done: 'このゲームはもう終わっています。',
  seated: 'ほかの卓に座っています。先にそちらを立ってください。',
  full: '満席です。',
  started: 'もう始まっています。',
  not_seated: '座っていません。',
  not_your_turn: 'あなたの番ではありません（時間が過ぎたかもしれません）。',
  min_raise: 'レイズが小さすぎます。',
  bad_set: '同じ数字のカード（1〜4 枚）を選んでください。',
  weak: '場のカードより強くないと出せません（枚数も同じに）。',
  must_play: '場が空のときはパスできません。',
  need_players: '人数が足りません。',
  too_many: '1 回に賭けられる数を超えました。',
};
export const casinoMsg = (k: string | undefined) => (k && MSG[k] ? k : undefined);
export const Msg = (p: { msg: string }) => <p class="c-alert">{MSG[p.msg] ?? p.msg}</p>;

/** 賭ける量を選ぶ（チップを押すとそのまま始まる。好きな量も入れられる） */
export function BetForm(p: { action: string; csrf: string; casino: CasinoConfig; coin: Coin; label: string; extra?: Child; last?: number }) {
  const chips = [...new Set([p.casino.minBet, 50, 100, 500, 1000, 5000, p.casino.maxBet])].filter((n) => n >= p.casino.minBet && n <= p.casino.maxBet).sort((a, b) => a - b);
  return (
    <form method="post" action={p.action} class="c-bet">
      <input type="hidden" name="_csrf" value={p.csrf} />
      {p.extra}
      <div class="c-chips">
        {chips.map((n) => (
          <button type="submit" name="bet" value={String(n)} class={`c-chip c-chip-${chipTone(n)}`}>
            {fmt(n)}
          </button>
        ))}
      </div>
      <div class="c-bet-custom">
        <label>
          好きな量
          <input type="number" name="betCustom" min={p.casino.minBet} max={p.casino.maxBet} value={String(p.last ?? p.casino.minBet)} inputmode="numeric" />
          {p.coin.name}
        </label>
        <button type="submit" name="bet" value="custom" class="c-btn">
          {p.label}
        </button>
      </div>
    </form>
  );
}

const chipTone = (n: number) => (n >= 5000 ? 'black' : n >= 1000 ? 'gold' : n >= 500 ? 'purple' : n >= 100 ? 'blue' : n >= 50 ? 'green' : 'red');

export function PlayingCard(p: { c: number; small?: boolean; delay?: number }) {
  return (
    <span class={`pc ${isRed(p.c) ? 'red' : 'black'}${p.small ? ' small' : ''} d${Math.min(p.delay ?? 0, 7)}`} aria-label={cardText(p.c)}>
      <span class="pc-corner">
        {rankText(p.c)}
        <br />
        {SUITS[suitOf(p.c)]}
      </span>
      <span class="pc-mid">{SUITS[suitOf(p.c)]}</span>
    </span>
  );
}

const CardBack = (p: { delay?: number }) => <span class={`pc back d${p.delay ?? 0}`} aria-label="伏せたカード"></span>;

/** 結果（勝ち・負け・引き分け） */
function Result(p: { bet: number; payout: number; coin: Coin; text: string }) {
  const net = p.payout - p.bet;
  return (
    <div class={`c-result ${net > 0 ? 'win' : net < 0 ? 'lose' : 'even'}`}>
      <div class="c-result-text">{p.text}</div>
      <div class="c-result-num">{net > 0 ? `+${fmt(net)}` : net < 0 ? fmt(net) : '±0'}</div>
      <div class="c-muted">
        賭け {fmt(p.bet)} → 戻り {fmt(p.payout)} {p.coin.name}
      </div>
    </div>
  );
}

type GamePage = { me: CasinoMe; casino: CasinoConfig; row?: CasinoGameRow; msg?: string };

// ───────── 🃏 ブラックジャック ─────────

const BJ_TEXT: Record<BjResult, string> = {
  blackjack: '🎉 ブラックジャック！',
  win: '🎉 勝ち！',
  push: '🤝 引き分け',
  lose: '😢 負け…',
  bust: '💥 バースト（21 を超えた）',
  dealer_blackjack: '😢 ディーラーのブラックジャック',
};

export function BlackjackPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as BjState | undefined;
  const v = s ? bjView(s) : undefined;
  return (
    <CasinoLayout title="ブラックジャック" me={p.me} back>
      <h1 class="c-h1">🃏 ブラックジャック</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        {v ? (
          <>
            <div class="c-hand">
              <div class="c-hand-label">
                ディーラー <b>{v.dealerHidden ? `${v.dealerTotal.total} + ?` : v.dealerTotal.total}</b>
              </div>
              <div class="c-cards">
                {v.dealer.map((c, i) => (
                  <PlayingCard c={c} delay={i} />
                ))}
                {v.dealerHidden && <CardBack delay={1} />}
              </div>
            </div>
            <div class="c-hand">
              <div class="c-hand-label">
                あなた <b>{v.playerTotal.total}</b>
                {v.playerTotal.soft && v.playerTotal.total < 21 && <span class="c-muted">（A を 11 で）</span>}
                {v.doubled && <span class="c-tag">ダブル</span>}
              </div>
              <div class="c-cards">
                {v.player.map((c, i) => (
                  <PlayingCard c={c} delay={i} />
                ))}
              </div>
            </div>
            {v.phase === 'player' ? (
              <form method="post" action={`/casino/blackjack/${p.row!.id}`} class="c-actions">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="v" value={String(p.row!.version)} />
                <button type="submit" name="action" value="hit" class="c-btn">
                  もう 1 枚（ヒット）
                </button>
                <button type="submit" name="action" value="stand" class="c-btn c-btn-gold">
                  これで勝負（スタンド）
                </button>
                {v.canDouble && (
                  <button type="submit" name="action" value="double" class="c-btn c-btn-ghost">
                    倍にして 1 枚（ダブル +{fmt(p.row!.bet)}）
                  </button>
                )}
              </form>
            ) : (
              <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={BJ_TEXT[v.result!]} />
            )}
          </>
        ) : (
          <p class="c-muted c-center">21 に近いほうが勝ち。絵札は 10、A は 1 か 11。ディーラーは 17 以上で止まります。</p>
        )}
      </section>
      {(!v || v.phase === 'done') && <BetForm action="/casino/blackjack" csrf={csrf} casino={p.casino} coin={p.me.coin} label="配る" last={p.row?.bet} />}
      <Rules>ブラックジャック（最初の 2 枚で 21）は賭けの 2.5 倍、勝ちは 2 倍、引き分けは戻ります。最初の 2 枚のときは「ダブル」（賭けを倍にして 1 枚だけ引く）もできます。</Rules>
    </CasinoLayout>
  );
}

const Rules = (p: { children: Child }) => (
  <details class="c-rules">
    <summary>遊び方・配当</summary>
    <p>{p.children}</p>
  </details>
);

// ───────── 🔼 ハイ＆ロー ─────────

export function HighLowPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as HlState | undefined;
  const mult = (m: number) => `×${(m / 1000).toFixed(2)}`;
  return (
    <CasinoLayout title="ハイ＆ロー" me={p.me} back>
      <h1 class="c-h1">🔼 ハイ＆ロー</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        {s ? (
          <>
            <div class="c-hl">
              <div class="c-hl-history">
                {s.history.slice(-8).map((c) => (
                  <PlayingCard c={c} small />
                ))}
              </div>
              <PlayingCard c={s.current} delay={1} />
              <div class="c-hl-mult">
                いまの倍率 <b>{mult(s.mult)}</b>
                <span class="c-muted">
                  （{s.steps} / {HL_MAX_STEPS} 回）
                </span>
              </div>
            </div>
            {s.phase === 'playing' ? (
              <form method="post" action={`/casino/highlow/${p.row!.id}`} class="c-actions">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="v" value={String(p.row!.version)} />
                {(['high', 'low'] as const).map((g) =>
                  hlWays(s.current, g) > 0 ? (
                    <button type="submit" name="action" value={g} class="c-btn">
                      {g === 'high' ? '▲ 上' : '▼ 下'}（{mult(hlNextMult(s.mult, s.current, g))}・{Math.round((hlWays(s.current, g) / 13) * 100)}%）
                    </button>
                  ) : null,
                )}
                {s.steps > 0 && (
                  <button type="submit" name="action" value="cashout" class="c-btn c-btn-gold">
                    💰 降りて受け取る（{fmt(Math.floor((p.row!.bet * s.mult) / 1000))}）
                  </button>
                )}
              </form>
            ) : (
              <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={s.result === 'cashout' ? '💰 受け取りました！' : '😢 はずれ…'} />
            )}
          </>
        ) : (
          <p class="c-muted c-center">次のカードが「上」か「下」かを当てます。同じ数字ははずれ。当てるほど倍率が上がり、好きなときに降りられます。</p>
        )}
      </section>
      {(!s || s.phase === 'done') && <BetForm action="/casino/highlow" csrf={csrf} casino={p.casino} coin={p.me.coin} label="始める" last={p.row?.bet} />}
      <Rules>当たるたびに倍率が「0.95 ÷ 当たる確率」倍になります（A から上なら小さく、K から上は選べません）。{HL_MAX_STEPS} 回当てるか ×100 に届いたら自動で受け取ります。</Rules>
    </CasinoLayout>
  );
}

// ───────── 🎴 バカラ ─────────

const BAC_LABEL: Record<BacBet, string> = { player: '🔵 プレイヤー（2 倍）', banker: '🔴 バンカー（1.95 倍）', tie: '🟢 タイ（9 倍）' };
const BAC_WIN: Record<BacBet, string> = { player: 'プレイヤーの勝ち', banker: 'バンカーの勝ち', tie: 'タイ（引き分け）' };

export function BaccaratPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as BaccaratState | undefined;
  return (
    <CasinoLayout title="バカラ" me={p.me} back>
      <h1 class="c-h1">🎴 バカラ</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        {s ? (
          <>
            <div class="c-bac">
              {(['player', 'banker'] as const).map((side) => (
                <div class={`c-hand c-bac-${side}${s.result.winner === side ? ' won' : ''}`}>
                  <div class="c-hand-label">
                    {side === 'player' ? '🔵 プレイヤー' : '🔴 バンカー'} <b>{side === 'player' ? s.result.playerTotal : s.result.bankerTotal}</b>
                  </div>
                  <div class="c-cards">
                    {(side === 'player' ? s.result.player : s.result.banker).map((c, i) => (
                      <PlayingCard c={c} delay={i * 2 + (side === 'banker' ? 1 : 0)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={`${BAC_WIN[s.result.winner]}（あなたは ${BAC_LABEL[s.bet].split('（')[0]}）`} />
          </>
        ) : (
          <p class="c-muted c-center">プレイヤーとバンカー、合計の 1 の位が 9 に近いほうが勝ち。どちらが勝つか（またはタイか）に賭けます。</p>
        )}
      </section>
      <BetForm
        action="/casino/baccarat"
        csrf={csrf}
        casino={p.casino}
        coin={p.me.coin}
        label="賭ける"
        last={p.row?.bet}
        extra={
          <div class="c-choice">
            {BAC_BETS.map((b, i) => (
              <label class={`c-pick c-pick-${b}`}>
                <input type="radio" name="on" value={b} checked={s ? s.bet === b : i === 0} />
                <span>{BAC_LABEL[b]}</span>
              </label>
            ))}
          </div>
        }
      />
      <Rules>10・絵札は 0。合計が 8・9 なら引かず、それ以外は決まりどおり 3 枚目を引きます。タイのとき、プレイヤー・バンカーに賭けた分は戻ります。</Rules>
    </CasinoLayout>
  );
}

// ───────── 🎰 スロット ─────────

export function SlotsPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as SlotsState | undefined;
  const reels = s?.reels ?? (['sakura', 'sakura', 'sakura'] as const);
  return (
    <CasinoLayout title="スロット" me={p.me} back>
      <h1 class="c-h1">🎰 スロット</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        <div class={`c-slot${s ? ' spun' : ''}${s && s.multiplier >= 50 ? ' jackpot' : ''}`}>
          {reels.map((r, i) => (
            <div class={`c-reel r${i}`}>
              <div class="c-reel-strip" aria-hidden="true">
                {SLOT_SYMBOLS.map((x) => (
                  <span>{x.emoji}</span>
                ))}
              </div>
              <span class="c-reel-face">{slotEmoji(r)}</span>
            </div>
          ))}
        </div>
        {s && <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={s.multiplier > 0 ? `🎉 ${s.multiplier} 倍！` : 'はずれ…'} />}
      </section>
      <BetForm action="/casino/slots" csrf={csrf} casino={p.casino} coin={p.me.coin} label="回す" last={p.row?.bet} />
      <Rules>
        {SLOT_SYMBOLS.map((x) => `${x.emoji}${x.emoji}${x.emoji} ×${x.three}`).join('・')}。🌸 が 2 つで ×15、1 つで ×1（賭けた分が戻る）。左の 2 つがそろうと 🏮×1・🦊×2・⛩×3。
      </Rules>
    </CasinoLayout>
  );
}

// ───────── 🎡 ルーレット ─────────

export function RoulettePage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as RouletteState | undefined;
  const numbers = Array.from({ length: 36 }, (_, i) => i + 1);
  return (
    <CasinoLayout title="ルーレット" me={p.me} back>
      <h1 class="c-h1">🎡 ルーレット</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        <div class="c-wheel-wrap">
          <div class={`c-wheel${s ? ` land-${s.number}` : ''}`} aria-hidden="true"></div>
          <div class="c-wheel-pin" aria-hidden="true">
            ▼
          </div>
          {s && <div class={`c-ball-num ${rouletteColor(s.number)}`}>{s.number}</div>}
        </div>
        {s && <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={`${s.number}（${s.number === 0 ? '緑' : rouletteColor(s.number) === 'red' ? '赤' : '黒'}）・あなたは ${rouletteBetLabel(s.bet)}`} />}
      </section>
      <BetForm
        action="/casino/roulette"
        csrf={csrf}
        casino={p.casino}
        coin={p.me.coin}
        label="回す"
        last={p.row?.bet}
        extra={
          <div class="c-rl">
            <div class="c-rl-outside">
              {(Object.keys(ROULETTE_BETS) as (keyof typeof ROULETTE_BETS)[]).map((k, i) => (
                <label class={`c-pick c-rl-${k}`}>
                  <input type="radio" name="on" value={k} checked={s ? s.bet === k : i === 0} />
                  <span>
                    {ROULETTE_BETS[k].label} <small>×{ROULETTE_BETS[k].mult}</small>
                  </span>
                </label>
              ))}
            </div>
            <div class="c-rl-grid">
              <label class="c-pick c-rl-n green zero">
                <input type="radio" name="on" value="n0" checked={s?.bet === 'n0'} />
                <span>0</span>
              </label>
              {numbers.map((n) => (
                <label class={`c-pick c-rl-n ${rouletteColor(n)}`}>
                  <input type="radio" name="on" value={`n${n}`} checked={s?.bet === `n${n}`} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </div>
        }
      />
      <Rules>0〜36 の 37 マス（ヨーロピアン）。数字 1 つに賭けて当たれば 36 倍。赤・黒・奇数・偶数・1〜18・19〜36 は 2 倍、1〜12 などのまとまりと列は 3 倍。0 は数字にしか入りません。</Rules>
    </CasinoLayout>
  );
}

// ───────── ⚫ オセロ ─────────

export function OthelloBoard(p: { board: string; legal: number[]; last?: number; action?: string; csrf?: string; hidden?: Record<string, string>; flip?: string }) {
  const cells = p.board.split('');
  const inner = (
    <div class="c-oth">
      {cells.map((c, i) => {
        const can = p.action && p.legal.includes(i);
        const cls = `c-cell${i === p.last ? ' last' : ''}${can ? ' can' : ''}`;
        const stone = c === '.' ? null : <span class={`c-stone ${c === 'B' ? 'b' : 'w'}`}></span>;
        return can ? (
          <button type="submit" name="idx" value={String(i)} class={cls} aria-label={`${(i % 8) + 1} 列 ${Math.floor(i / 8) + 1} 行に置く`}>
            {stone}
          </button>
        ) : (
          <span class={cls}>{stone}</span>
        );
      })}
    </div>
  );
  if (!p.action) return inner;
  return (
    <form method="post" action={p.action}>
      <input type="hidden" name="_csrf" value={p.csrf} />
      {Object.entries(p.hidden ?? {}).map(([k, v]) => (
        <input type="hidden" name={k} value={v} />
      ))}
      {inner}
    </form>
  );
}

const StoneCount = (p: { board: string; b: string; w: string; turn: Stone | null }) => {
  const n = countStones(p.board);
  return (
    <div class="c-oth-score">
      <span class={p.turn === 'B' ? 'turn' : ''}>
        <span class="c-stone b mini"></span> {p.b} <b>{n.B}</b>
      </span>
      <span class={p.turn === 'W' ? 'turn' : ''}>
        <span class="c-stone w mini"></span> {p.w} <b>{n.W}</b>
      </span>
    </div>
  );
};

const OTHELLO_TEXT = { win: '🎉 あなたの勝ち！', lose: '😢 CPU の勝ち…', draw: '🤝 引き分け', resign: '🏳 投了しました' } as const;

export function OthelloPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as OthelloCpuState | undefined;
  const you = s?.you ?? 'B';
  const playing = p.row?.status === 'playing' && s;
  return (
    <CasinoLayout title="オセロ" me={p.me} back>
      <h1 class="c-h1">⚫ オセロ（CPU）</h1>
      {p.msg && <Msg msg={p.msg} />}
      {s && (
        <section class="c-table">
          <StoneCount board={s.board} b={you === 'B' ? 'あなた' : `CPU（${OTHELLO_LEVELS[s.level ?? 'easy'].label}）`} w={you === 'W' ? 'あなた' : `CPU（${OTHELLO_LEVELS[s.level ?? 'easy'].label}）`} turn={s.turn} />
          <OthelloBoard board={s.board} legal={playing && s.turn === you ? legalMoves(s.board, you) : []} last={s.last} action={playing ? `/casino/othello/${p.row!.id}` : undefined} csrf={csrf} hidden={{ v: String(p.row!.version) }} />
          {playing ? (
            <form method="post" action={`/casino/othello/${p.row!.id}`} class="c-actions">
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="v" value={String(p.row!.version)} />
              <span class="c-muted">光っているマスに置けます。</span>
              <button type="submit" name="idx" value="resign" class="c-btn c-btn-ghost c-confirm" data-confirm="投了しますか？（賭けた銭は戻りません）">
                投了する
              </button>
            </form>
          ) : (
            s.result && <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={OTHELLO_TEXT[s.result]} />
          )}
        </section>
      )}
      {!playing && (
        <BetForm
          action="/casino/othello"
          csrf={csrf}
          casino={p.casino}
          coin={p.me.coin}
          label="対局する"
          last={p.row?.bet}
          extra={
            <>
              <div class="c-choice">
                {(Object.keys(OTHELLO_LEVELS) as OthelloLevel[]).map((l, i) => (
                  <label class="c-pick">
                    <input type="radio" name="level" value={l} checked={s ? s.level === l : i === 0} />
                    <span>
                      {OTHELLO_LEVELS[l].label}（勝てば ×{OTHELLO_LEVELS[l].mult}）
                    </span>
                  </label>
                ))}
              </div>
              <div class="c-choice">
                <label class="c-pick">
                  <input type="radio" name="color" value="B" checked={you === 'B'} />
                  <span>⚫ 黒（先手）</span>
                </label>
                <label class="c-pick">
                  <input type="radio" name="color" value="W" checked={you === 'W'} />
                  <span>⚪ 白（後手）</span>
                </label>
              </div>
            </>
          }
        />
      )}
      <Rules>CPU に勝つと、強さに合わせて賭けの 1.2 倍・1.6 倍・2.2 倍が戻ります。引き分けは戻り、負け・投了は 0 です。途中でロビーに戻っても、あとから続きを打てます。</Rules>
    </CasinoLayout>
  );
}

// ───────── ⚔ メンバー対戦 ─────────

export type Names = Map<string, string>;
const nameOf = (names: Names, id: string | null | undefined) => (id ? (names.get(id) ?? `ID ${id.slice(-4)}`) : '（待っています）');

export function VersusLobby(p: { me: CasinoMe; casino: CasinoConfig; matches: CasinoMatch[]; recent: CasinoMatch[]; names: Names; mine?: CasinoMatch; msg?: string }) {
  const csrf = p.me.session.csrfToken;
  const open = p.matches.filter((m) => m.status === 'open');
  const playing = p.matches.filter((m) => m.status === 'playing');
  return (
    <CasinoLayout title="メンバー対戦" me={p.me} back htmx>
      <h1 class="c-h1">⚔ メンバー対戦（オセロ）</h1>
      {p.msg && <Msg msg={p.msg} />}
      {p.mine ? (
        <section class="c-panel c-center">
          <p>
            {p.mine.status === 'open' ? '部屋を作って相手を待っています。' : '対戦中です。'}
            <a class="c-btn c-btn-gold" href={`/casino/versus/${p.mine.id}`}>
              部屋へ行く
            </a>
          </p>
        </section>
      ) : (
        <section class="c-panel">
          <h2>🆕 部屋を作る</h2>
          <p class="c-muted">相手も同じだけ賭けて、勝った人が 2 人分をもらいます。0 にすると賭けない対戦です。1 手の持ち時間を過ぎると、置く番の人の負けになります。</p>
          <form method="post" action="/casino/versus" class="c-bet-custom">
            <input type="hidden" name="_csrf" value={csrf} />
            <label>
              賭け
              <input type="number" name="bet" min={0} max={p.casino.maxBet} value="100" inputmode="numeric" />
              {p.me.coin.name}
            </label>
            <label>
              1 手の持ち時間
              <select name="moveSeconds">
                {MOVE_CHOICES.map((sec) => (
                  <option value={String(sec)}>{sec / 60} 分</option>
                ))}
              </select>
            </label>
            <button type="submit" class="c-btn c-btn-gold">
              部屋を作る
            </button>
          </form>
        </section>
      )}
      <section class="c-panel" hx-get="/casino/versus" hx-trigger="every 5s" hx-select=".c-rooms" hx-target=".c-rooms" hx-swap="outerHTML">
        <div class="c-rooms">
          <h2>🚪 相手を待っている部屋</h2>
          {open.length === 0 ? (
            <p class="c-muted">いまはありません。部屋を作って待ってみましょう。</p>
          ) : (
            <ul class="c-list">
              {open.map((m) => (
                <li>
                  <span>
                    {nameOf(p.names, m.hostId)} さん・賭け {m.bet > 0 ? money(p.me.coin, m.bet) : 'なし'}
                  </span>
                  {m.hostId === p.me.session.userId ? (
                    <a href={`/casino/versus/${m.id}`}>自分の部屋</a>
                  ) : (
                    <form method="post" action={`/casino/versus/${m.id}/join`} class="c-inline">
                      <input type="hidden" name="_csrf" value={csrf} />
                      <button type="submit" class="c-btn c-btn-small" disabled={Boolean(p.mine)}>
                        入る
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {playing.length > 0 && (
            <>
              <h2>👀 対戦中（見られます）</h2>
              <ul class="c-list">
                {playing.map((m) => (
                  <li>
                    <span>
                      ⚫ {nameOf(p.names, m.hostId)} vs ⚪ {nameOf(p.names, m.guestId)}
                      {m.bet > 0 && `・${money(p.me.coin, m.bet * 2)}`}
                    </span>
                    <a href={`/casino/versus/${m.id}`}>見る</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
      {p.recent.length > 0 && (
        <section class="c-panel">
          <h2>📜 最近の対戦</h2>
          <ul class="c-list">
            {p.recent.map((m) => (
              <li>
                <span>
                  ⚫ {nameOf(p.names, m.hostId)} vs ⚪ {nameOf(p.names, m.guestId)}
                </span>
                <span>{m.winnerId ? `🏆 ${nameOf(p.names, m.winnerId)}` : '🤝 引き分け'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </CasinoLayout>
  );
}

const END_TEXT: Record<string, string> = { end: '最後まで打ちました', resign: '投了', timeout: '持ち時間切れ', cancel: '部屋を閉じました', expired: '相手が来なかったので閉じました' };

/** 対戦の盤（2 秒ごとに読み直す） */
export function VersusBoard(p: { match: CasinoMatch; names: Names; me: string; csrf: string; coin: Coin; now: Date }) {
  const m = p.match;
  const s = m.state as VersusState;
  const mine: Stone | undefined = m.hostId === p.me ? 'B' : m.guestId === p.me ? 'W' : undefined;
  const live = m.status === 'playing' || m.status === 'open';
  const myTurn = m.status === 'playing' && s.turn === mine;
  const left = Math.max(0, moveSecondsOf(m) - Math.floor((p.now.getTime() - m.turnAt.getTime()) / 1000));
  return (
    <div id="vs-board" class="c-vs" {...(live ? { 'hx-get': `/casino/versus/${m.id}/board?v=${m.version}`, 'hx-trigger': 'every 2s', 'hx-swap': 'outerHTML' } : {})}>
      <StoneCount board={s.board} b={nameOf(p.names, m.hostId)} w={nameOf(p.names, m.guestId)} turn={m.status === 'playing' ? s.turn : null} />
      {m.status === 'open' && <p class="c-center c-wait">相手が入るのを待っています…（このページを開いたままにしてください）</p>}
      {m.status === 'playing' && (
        <p class={`c-center c-turn${myTurn ? ' mine' : ''}`}>
          {myTurn ? 'あなたの番です' : mine ? '相手の番です' : `${s.turn === 'B' ? '⚫' : '⚪'} の番`}・残り {left} 秒
        </p>
      )}
      <OthelloBoard board={s.board} legal={myTurn ? legalMoves(s.board, mine!) : []} last={s.last} action={myTurn ? `/casino/versus/${m.id}/move` : undefined} csrf={p.csrf} hidden={{ v: String(m.version) }} />
      {(m.status === 'done' || m.status === 'cancelled') && (
        <div class={`c-result ${m.winnerId === p.me ? 'win' : m.winnerId && mine ? 'lose' : 'even'}`}>
          <div class="c-result-text">
            {m.status === 'cancelled' ? '部屋を閉じました' : m.winnerId ? `🏆 ${nameOf(p.names, m.winnerId)} さんの勝ち` : '🤝 引き分け'}
          </div>
          <div class="c-muted">
            {END_TEXT[m.endReason ?? ''] ?? ''}
            {m.bet > 0 && m.status === 'done' && (m.winnerId ? `・${money(p.coin, m.bet * 2)} を受け取りました` : '・賭けは戻りました')}
          </div>
        </div>
      )}
    </div>
  );
}

export function VersusRoom(p: { me: CasinoMe; match: CasinoMatch; names: Names; msg?: string; now: Date }) {
  const m = p.match;
  const csrf = p.me.session.csrfToken;
  const mine = m.hostId === p.me.session.userId || m.guestId === p.me.session.userId;
  return (
    <CasinoLayout title="メンバー対戦" me={p.me} htmx>
      <p class="c-back">
        <a href="/casino/versus">← 対戦ロビーへ</a>
      </p>
      <h1 class="c-h1">
        ⚔ 対戦 #{m.id}
        {m.bet > 0 && <span class="c-tag">賭け {money(p.me.coin, m.bet)}</span>}
      </h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table">
        <VersusBoard match={m} names={p.names} me={p.me.session.userId} csrf={csrf} coin={p.me.coin} now={p.now} />
      </section>
      {mine && m.status === 'open' && m.hostId === p.me.session.userId && (
        <form method="post" action={`/casino/versus/${m.id}/cancel`} class="c-actions">
          <input type="hidden" name="_csrf" value={csrf} />
          <button type="submit" class="c-btn c-btn-ghost">
            部屋を閉じる（賭けは戻ります）
          </button>
        </form>
      )}
      {mine && m.status === 'playing' && (
        <form method="post" action={`/casino/versus/${m.id}/resign`} class="c-actions">
          <input type="hidden" name="_csrf" value={csrf} />
          <button type="submit" class="c-btn c-btn-ghost c-confirm" data-confirm="投了しますか？（相手の勝ちになります）">
            投了する
          </button>
        </form>
      )}
    </CasinoLayout>
  );
}
