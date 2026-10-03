import type { Child } from 'hono/jsx';
import type { CasinoConfig, CasinoGame } from '../../config.js';
import type { CasinoGameRow, CasinoMatch, MemberSession } from '../../db/schema.js';
import { BAC_BETS, type BacBet } from '../../services/casino/baccarat.js';
import { bjView, type BjResult, type BjState } from '../../services/casino/blackjack.js';
import { cardText, isRed, rankText, SUITS, suitOf } from '../../services/casino/cards.js';
import { CASINO_LABEL, type BaccaratState, type OthelloCpuState, type RouletteState } from '../../services/casino/casino.js';
import { HL_MAX_STEPS, hlNextMult, hlWays, type HlState } from '../../services/casino/highlow.js';
import { countStones, legalMoves, OTHELLO_LEVELS, type OthelloLevel, type Stone } from '../../services/casino/othello.js';
import { rouletteColor, rouletteMaxOf, ROULETTE_MAX_SPOTS } from '../../services/casino/roulette.js';
import { RouletteBoard, RouletteStakes, RouletteWheel } from './rouletteBoard.js';
import { MOVE_CHOICES, moveSecondsOf, type VersusState } from '../../services/casino/versus.js';
import { assetUrl } from '../assets.js';

export type Coin = { name: string; emoji: string };
const fmt = (n: number) => n.toLocaleString('ja-JP');
const money = (coin: Coin, n: number) => `${coin.emoji}${fmt(n)} ${coin.name}`;

/** みんなで遊ぶもの（ロビーで分けて出す） */
const TABLE_GAMES: CasinoGame[] = ['poker', 'bj_table', 'baccarat_table', 'roulette_table', 'chinchiro_table', 'daifugo', 'babanuki', 'versus', 'mahjong', 'keiba'];
const gameHref = (g: CasinoGame) => (g === 'versus' ? '/casino/versus' : g === 'mahjong' ? '/casino/jansou' : `/casino/tables/${g}`);

/** revealFrom: 結果を見せる前の残高（ルーレットが止まるまで、こちらを出しておく） */
export type CasinoMe = { session: MemberSession; balance: number; coin: Coin; revealFrom?: number; revealAt?: number; revealWait?: boolean };

/** back: ロビーへ戻る（'gate' は入口へ）。jansou: 雀荘の看板。wide: 横に広く（麻雀の卓） */
export function CasinoLayout(props: { title: string; me?: CasinoMe; children: Child; htmx?: boolean; back?: boolean | 'gate'; jansou?: boolean; wide?: boolean }) {
  const me = props.me;
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>
          {props.title} | {props.jansou ? '咲楽ノ宮雀荘' : '咲楽ノ宮カジノ'}
        </title>
        <link rel="stylesheet" href={assetUrl('casino.css')} />
        {props.htmx && <script src={assetUrl('htmx.min.js')} defer></script>}
        <script src={assetUrl('casino.js')} defer></script>
      </head>
      <body class={`casino${props.jansou ? ' jansou' : ''}`}>
        <div class="c-sky" aria-hidden="true">
          {Array.from({ length: 14 }, () => (
            <span class="c-petal"></span>
          ))}
        </div>
        <header class="c-top">
          <a href={props.jansou ? '/casino/jansou' : '/casino'} class="c-logo">
            <span class="c-logo-mark">{props.jansou ? '🀄' : '🌸'}</span>
            <span>
              咲楽ノ宮<b>{props.jansou ? '雀荘' : 'カジノ'}</b>
            </span>
          </a>
          <button type="button" class="c-sound" data-sound-toggle aria-pressed="true" title="音を消す">
            🔊
          </button>
          {me && (
            <div class="c-me">
              <span class={`c-balance ${dly(me.revealAt ?? 26)}${me.revealWait ? ' wait' : ''}`} title="持っている銭">
                {me.revealFrom !== undefined && me.revealFrom !== me.balance ? (
                  <>
                    <span class="bal-old">{money(me.coin, me.revealFrom)}</span>
                    <span class="bal-new">{money(me.coin, me.balance)}</span>
                  </>
                ) : (
                  money(me.coin, me.balance)
                )}
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
        <main class={`c-main${props.wide ? ' wide' : ''}`}>
          {props.back && (
            <p class="c-back">
              {props.back === 'gate' ? <a href="/casino">← 入口へ</a> : <a href="/casino/hall">← ロビーへ</a>}
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
  no_role: 'カジノのロールがある人だけ入れます。入りたいときは運営に声をかけてください。',
  expired: 'ログインの期限が切れました。もう一度ログインしてください。',
  closed: 'いまカジノはお休みです。',
  link: 'このリンクはもう使えません（10 分たったか、1 回使ったリンクです）。Discord で /カジノ をもう一度打つと、新しいリンクが届きます。',
};

/** ログインなしで入るリンクを開いたとき（押すまでは入らない。リンクの下見で使われてしまわないように） */
export function CasinoLinkPage(props: { name: string; action: string }) {
  return (
    <CasinoLayout title="入る">
      <section class="c-hero">
        <h1>咲楽ノ宮カジノ</h1>
        <p>
          <b>{props.name}</b> さんとして入ります。
        </p>
        <form method="post" action={props.action}>
          <button type="submit" class="c-btn c-btn-gold">
            🎰 入る
          </button>
        </form>
        <p class="c-note">このリンクは 1 回だけ・10 分だけ使えます。人には渡さないでください。</p>
      </section>
    </CasinoLayout>
  );
}

export function CasinoLanding(props: { error?: string; roleName?: string }) {
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
        {props.error && LOGIN_ERROR[props.error] && (
          <p class="c-alert">{props.error === 'no_role' && props.roleName ? `「${props.roleName}」のロールがある人だけ入れます。入りたいときは運営に声をかけてください。` : LOGIN_ERROR[props.error]}</p>
        )}
        <a class="c-btn c-btn-discord" href="/casino/auth/discord">
          Discord でログインして入る
        </a>
        <p class="c-note">ログインで分かるのは Discord の名前とアイコンだけです（メールなどは見ません）。</p>
        <p class="c-note">💡 Discord で <b>/カジノ</b> を打つと、ログインしなくても入れるリンクが届きます。</p>
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

/** 入口: カジノか雀荘か */
export function CasinoGate(p: { me: CasinoMe; casinoOn: boolean; jansouOn: boolean; jansouTables: number; mine?: { id: number; kind: string }; msg?: string }) {
  return (
    <CasinoLayout title="入口" me={p.me}>
      <section class="c-gate-head">
        <p class="c-welcome-kicker">SAKURANOMIYA</p>
        <h1>ようこそ、{p.me.session.displayName} さん</h1>
        <p class="c-muted">どちらに入りますか？</p>
      </section>
      {p.msg && <Msg msg={p.msg} />}
      {p.mine && (
        <a class="c-mine" href={`/casino/t/${p.mine.id}`}>
          <span class="c-mine-dot" aria-hidden="true"></span>
          <span>
            {CASINO_LABEL[p.mine.kind as CasinoGame]?.emoji} 卓 #{p.mine.id}（{CASINO_LABEL[p.mine.kind as CasinoGame]?.name}）に座っています
          </span>
          <b>戻る →</b>
        </a>
      )}
      <div class="c-doors">
        {p.casinoOn ? (
          <a href="/casino/hall" class="c-door c-door-casino">
            <span class="c-door-mark" aria-hidden="true">
              🎰
            </span>
            <b>カジノに入る</b>
            <small>ブラックジャック・ポーカー・スロット・ルーレット・ちんちろ・大富豪…</small>
          </a>
        ) : (
          <span class="c-door c-door-casino off">
            <span class="c-door-mark" aria-hidden="true">
              🎰
            </span>
            <b>カジノ</b>
            <small>いまはお休みです</small>
          </span>
        )}
        {p.jansouOn ? (
          <a href="/casino/jansou" class="c-door c-door-jansou">
            <span class="c-door-mark" aria-hidden="true">
              🀄
            </span>
            <b>咲楽ノ宮雀荘に入る</b>
            <small>4 人打ちのリーチ麻雀。人が足りなくても BOT が入ります</small>
            {p.jansouTables > 0 && <span class="c-badge">{p.jansouTables} 卓</span>}
          </a>
        ) : (
          <span class="c-door c-door-jansou off">
            <span class="c-door-mark" aria-hidden="true">
              🀄
            </span>
            <b>咲楽ノ宮雀荘</b>
            <small>いまはお休みです</small>
          </span>
        )}
      </div>
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
            <a href={gameHref(g)} class={`c-game c-game-${g} c-game-multi`}>
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
  reserve: '負けると最大で賭けの 5 倍になるので、賭けの 5 倍の銭が要ります。',
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
  bad_set: '同じ数字のカード（1〜4 枚）か、階段ありの卓なら同じマークの 3 枚以上の連番を選んでください。',
  locked: 'しばり中です。場と同じマークのカードしか出せません。',
  pick_count: '渡す（捨てる）カードを、決まった枚数だけ選んでください。',
  pending: '先に、渡す（捨てる）カードを選んでください。',
  weak: '場のカードより強くないと出せません（枚数も同じに）。',
  must_play: '場が空のときはパスできません。',
  need_players: '人数が足りません。',
  too_many: '1 回に賭けられる数を超えました。',
  host_only: 'レースを開いた人だけができます。',
  horse_bought: '🐴 馬を買いました。次の新馬戦から走ります（卓に座っていると優先して出走）。',
  horse_named: '名前を変えました。',
  horse_retired: '引退させました。おつかれさまでした。',
  horse_invalid: '馬の名前は 1〜18 文字で入れてください。',
  horse_taken: 'その名前の馬はもういます。',
  horse_too_many: '持てる頭数に届いています。',
  horse_debuted: 'デビューした馬の名前は変えられません。',
  horse_off: 'いまは馬を買えません。',
  silk_saved: '🎽 勝負服を決めました。あなたの馬はみんなこの服で走ります。',
  horse_trained: '💪 調教しました。次のレースの調子が上がります。',
  horse_cooldown: '調教は 6 時間に 1 回までです。',
  horse_resting: '放牧中は調教できません。',
  horse_rested: '🌿 放牧に出しました。1 時間休んで、疲れがすっかり抜けます。',
  horse_sale: '💱 売りに出しました。',
  horse_unsale: '売るのをやめました。',
  horse_bad_price: '値段は 100〜10,000,000 で入れてください。',
  horse_traded: '💱 馬を買いました。あなたの勝負服で走ります。',
  horse_self: '自分の馬は買えません。',
  horse_no_wins: '繁殖入りできるのは、1 勝以上した馬だけです。',
  horse_bred: '🌸 引退して繁殖入りしました。産駒を迎えられます。',
  horse_foal: '🐣 産駒を迎えました。新馬戦から走ります。',
  horse_no_foals: 'この馬の産駒は、もう迎えきりました。',
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

/** 遅れのクラス（0.2 秒きざみ。dly-5 = 1 秒） */
export const dly = (n: number) => `dly-${Math.max(0, Math.min(60, Math.round(n)))}`;

/**
 * 山から飛んできて、裏から表にめくれるカード。d: 遅れ（0.2 秒きざみ）/ still: 動かさない / down: 裏のまま /
 * slow: ゆっくりめくる（バカラの 3 枚目）/ ck: 卓の画面で「前からあるカード」を見分ける印（casino.js）
 */
export function FlipCard(p: { c?: number; d?: number; small?: boolean; still?: boolean; down?: boolean; slow?: boolean; ck?: string; face?: Child }) {
  const cls = `fc${p.small ? ' small' : ''}${p.still ? ' still' : ''}${p.down ? ' down' : ''}${p.slow ? ' slow' : ''} ${dly(p.d ?? 0)}`;
  return (
    <span class={cls} data-ck={p.ck}>
      <span class="fc-in">
        <span class={`pc back${p.small ? ' small' : ''}`} aria-label="伏せたカード"></span>
        {!p.down && (p.face ?? (p.c !== undefined ? <PlayingCard c={p.c} small={p.small} /> : null))}
      </span>
    </span>
  );
}

/** 遅れて出す（カードが配り終わってから結果を出す） */
export const Later = (p: { d: number; children: Child; class?: string }) => <div class={`c-later ${dly(p.d)}${p.class ? ` ${p.class}` : ''}`}>{p.children}</div>;

/** 結果を見せる前の残高（止まる・配り終わるまで、こちらを出しておく） */
export const revealMe = (me: CasinoMe, row: CasinoGameRow | undefined, at: number): CasinoMe => {
  if (!row || row.status !== 'done' || !row.finishedAt || Date.now() - row.finishedAt.getTime() > 60_000) return me;
  return { ...me, revealFrom: me.balance - row.payout, revealAt: at };
};
/** 終わったばかり（演出する）か */
export const freshDone = (row: CasinoGameRow | undefined) => Boolean(row && row.status === 'done' && row.finishedAt && Date.now() - row.finishedAt.getTime() < 60_000);

/** 結果（勝ち・負け・引き分け） */
export function Result(p: { bet: number; payout: number; coin: Coin; text: string }) {
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

export type GamePage = { me: CasinoMe; casino: CasinoConfig; row?: CasinoGameRow; msg?: string };

// ───────── 🃏 ブラックジャック ─────────

const BJ_TEXT: Record<BjResult, string> = {
  blackjack: '🎉 ブラックジャック！',
  win: '🎉 勝ち！',
  push: '🤝 引き分け',
  lose: '😢 負け…',
  bust: '💥 バースト（21 を超えた）',
  dealer_blackjack: '😢 ディーラーのブラックジャック',
};

/**
 * 配る順番と遅れ（0.2 秒きざみ）。
 * - 配ったばかり: あなた → ディーラー → あなた → ディーラー（伏せ）
 * - ヒットのあと: 新しい 1 枚だけ
 * - 終わったとき: ディーラーの伏せカードをめくり、引いたカードを 1 枚ずつ。そのあと結果
 */
function bjPlan(v: ReturnType<typeof bjView>, fresh: boolean) {
  const still = (n: number) => Array<number | null>(n).fill(null);
  if (!fresh && v.phase === 'done') return { player: still(v.player.length), dealer: still(v.dealer.length), result: 0 };
  const deal = v.player.length === 2 && v.dealer.length <= 2 && !v.doubled;
  if (deal) {
    const dealer = v.dealer.map((_, i) => (i === 0 ? 2 : 6));
    return { player: [0, 4], dealer, result: v.phase === 'done' ? 10 : 0 };
  }
  const player = v.player.map((_, i) => (i === v.player.length - 1 ? 0 : null));
  if (v.phase === 'player') return { player, dealer: still(v.dealer.length), result: 0 };
  const dealer = v.dealer.map((_, i) => (i === 0 ? null : 3 + (i - 1) * 4));
  return { player, dealer, result: (dealer[dealer.length - 1] ?? 0) + 4 };
}

export function BlackjackPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as BjState | undefined;
  const v = s ? bjView(s) : undefined;
  const fresh = p.row?.status === 'playing' || freshDone(p.row);
  const plan = v ? bjPlan(v, fresh) : undefined;
  const me = v?.phase === 'done' ? revealMe(p.me, p.row, plan!.result) : p.me;
  const Hand = (q: { cards: number[]; delays: (number | null)[]; hidden?: boolean; hiddenAt?: number }) => (
    <div class="c-cards">
      {q.cards.map((c, i) => (
        <FlipCard c={c} d={q.delays[i] ?? 0} still={q.delays[i] === null} slow={false} />
      ))}
      {q.hidden && <FlipCard down d={q.hiddenAt ?? 0} still={q.hiddenAt === undefined} />}
    </div>
  );
  const effect = v?.result === 'blackjack' ? ' c-fx-burst' : v?.result === 'bust' ? ' c-fx-shake' : '';
  return (
    <CasinoLayout title="ブラックジャック" me={me} back>
      <h1 class="c-h1">🃏 ブラックジャック</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table c-felt">
        <div class="c-shoe" aria-hidden="true"></div>
        {v && plan ? (
          <>
            <div class="c-hand">
              <div class="c-hand-label">
                ディーラー{' '}
                {v.dealerHidden ? (
                  <b>{`${v.dealerTotal.total} + ?`}</b>
                ) : plan.result > 0 ? (
                  <Later d={plan.result - 1} class="c-inline-later">
                    <b>{v.dealerTotal.total}</b>
                  </Later>
                ) : (
                  <b>{v.dealerTotal.total}</b>
                )}
              </div>
              <Hand cards={v.dealer} delays={plan.dealer} hidden={v.dealerHidden} hiddenAt={v.player.length === 2 && !v.doubled && fresh ? 6 : undefined} />
            </div>
            <div class="c-hand">
              <div class="c-hand-label">
                あなた <b>{v.playerTotal.total}</b>
                {v.playerTotal.soft && v.playerTotal.total < 21 && <span class="c-muted">（A を 11 で）</span>}
                {v.doubled && <span class="c-tag">ダブル</span>}
              </div>
              <Hand cards={v.player} delays={plan.player} />
            </div>
            {v.phase === 'player' ? (
              <Later d={v.player.length === 2 && !v.doubled ? 8 : 2}>
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
              </Later>
            ) : (
              <Later d={plan.result} class={effect}>
                <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={BJ_TEXT[v.result!]} />
              </Later>
            )}
          </>
        ) : (
          <p class="c-muted c-center">21 に近いほうが勝ち。絵札は 10、A は 1 か 11。ディーラーは 17 以上で止まります。</p>
        )}
      </section>
      {(!v || v.phase === 'done') && (
        <Later d={plan?.result ?? 0}>
          <BetForm action="/casino/blackjack" csrf={csrf} casino={p.casino} coin={p.me.coin} label="配る" last={p.row?.bet} />
        </Later>
      )}
      <Rules>ブラックジャック（最初の 2 枚で 21）は賭けの 2.5 倍、勝ちは 2 倍、引き分けは戻ります。最初の 2 枚のときは「ダブル」（賭けを倍にして 1 枚だけ引く）もできます。</Rules>
    </CasinoLayout>
  );
}

export const Rules = (p: { children: Child }) => (
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
  const fresh = p.row?.status === 'playing' || freshDone(p.row);
  // 降りたときは、新しいカードはめくらない
  const flipped = fresh && s?.result !== 'cashout';
  const at = flipped ? 4 : 0;
  const me = s?.phase === 'done' ? revealMe(p.me, p.row, at) : p.me;
  return (
    <CasinoLayout title="ハイ＆ロー" me={me} back>
      <h1 class="c-h1">🔼 ハイ＆ロー</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table c-felt">
        {s ? (
          <>
            <div class="c-hl">
              <div class="c-hl-history">
                {s.history.slice(-8).map((c) => (
                  <PlayingCard c={c} small />
                ))}
              </div>
              <span class={s.result === 'lose' && fresh ? 'c-fx-shake-later' : ''}>
                <FlipCard c={s.current} d={0} still={!flipped} />
              </span>
              <Later d={at}>
                <div class="c-hl-mult">
                  いまの倍率 <b>{mult(s.mult)}</b>
                  <span class="c-muted">
                    （{s.steps} / {HL_MAX_STEPS} 回）
                  </span>
                </div>
              </Later>
            </div>
            {s.phase === 'playing' ? (
              <Later d={at}>
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
              </Later>
            ) : (
              <Later d={at} class={s.result === 'cashout' ? ' c-fx-burst' : ''}>
                <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={s.result === 'cashout' ? '💰 受け取りました！' : '😢 はずれ…'} />
              </Later>
            )}
          </>
        ) : (
          <p class="c-muted c-center">次のカードが「上」か「下」かを当てます。同じ数字ははずれ。当てるほど倍率が上がり、好きなときに降りられます。</p>
        )}
      </section>
      {(!s || s.phase === 'done') && (
        <Later d={at}>
          <BetForm action="/casino/highlow" csrf={csrf} casino={p.casino} coin={p.me.coin} label="始める" last={p.row?.bet} />
        </Later>
      )}
      <Rules>当たるたびに倍率が「0.95 ÷ 当たる確率」倍になります（A から上なら小さく、K から上は選べません）。{HL_MAX_STEPS} 回当てるか ×100 に届いたら自動で受け取ります。</Rules>
    </CasinoLayout>
  );
}

// ───────── 🎴 バカラ ─────────

const BAC_LABEL: Record<BacBet, string> = { player: '🔵 プレイヤー（2 倍）', banker: '🔴 バンカー（1.95 倍）', tie: '🟢 タイ（9 倍）' };
const BAC_WIN: Record<BacBet, string> = { player: 'プレイヤーの勝ち', banker: 'バンカーの勝ち', tie: 'タイ（引き分け）' };

/** バカラの配る順（P1 → B1 → P2 → B2、3 枚目はためてゆっくり）。遅れと、結果を出す時刻 */
export function bacPlan(player: number[], banker: number[]) {
  const p = [0, 4];
  const b = [2, 6];
  let t = 8;
  if (player.length > 2) {
    p.push(t + 2);
    t += 7;
  }
  if (banker.length > 2) {
    b.push(t + 2);
    t += 7;
  }
  return { player: p, banker: b, result: t + 2 };
}

export function BaccaratPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as BaccaratState | undefined;
  const fresh = freshDone(p.row);
  const plan = s ? bacPlan(s.result.player, s.result.banker) : undefined;
  const at = fresh && plan ? plan.result : 0;
  const me = s ? revealMe(p.me, p.row, at) : p.me;
  return (
    <CasinoLayout title="バカラ" me={me} back>
      <h1 class="c-h1">🎴 バカラ</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table c-felt">
        <div class="c-shoe" aria-hidden="true"></div>
        {s && plan ? (
          <>
            <div class="c-bac">
              {(['player', 'banker'] as const).map((side) => (
                <div class={`c-hand c-bac-${side}${s.result.winner === side ? ' won' : ''} ${dly(at)}`}>
                  <div class="c-hand-label">
                    {side === 'player' ? '🔵 プレイヤー' : '🔴 バンカー'}{' '}
                    <Later d={at} class="c-inline-later">
                      <b>{side === 'player' ? s.result.playerTotal : s.result.bankerTotal}</b>
                    </Later>
                  </div>
                  <div class="c-cards">
                    {(side === 'player' ? s.result.player : s.result.banker).map((c, i) => (
                      <FlipCard c={c} d={(side === 'player' ? plan.player : plan.banker)[i]} still={!fresh} slow={i === 2} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Later d={at} class={s.result.winner === s.bet ? ' c-fx-burst' : ''}>
              <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={`${BAC_WIN[s.result.winner]}（あなたは ${BAC_LABEL[s.bet].split('（')[0]}）`} />
            </Later>
          </>
        ) : (
          <p class="c-muted c-center">プレイヤーとバンカー、合計の 1 の位が 9 に近いほうが勝ち。どちらが勝つか（またはタイか）に賭けます。</p>
        )}
      </section>
      <Later d={at}>
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
      </Later>
      <Rules>10・絵札は 0。合計が 8・9 なら引かず、それ以外は決まりどおり 3 枚目を引きます。タイのとき、プレイヤー・バンカーに賭けた分は戻ります。</Rules>
    </CasinoLayout>
  );
}

// ───────── 🎡 ルーレット ─────────

export function RoulettePage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as RouletteState | undefined;
  // 前の形（1 か所だけ）の結果も出せるように
  const stakes = s?.stakes ?? (s?.bet ? [{ on: s.bet, amount: p.row!.bet, payout: p.row!.payout }] : []);
  // 回したばかりなら、玉が止まるまで（約 5.2 秒）残高は戻りを足す前を出す
  const me = s ? revealMe(p.me, p.row, 26) : p.me;
  return (
    <CasinoLayout title="ルーレット" me={me} back>
      <h1 class="c-h1">🎡 ルーレット</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table c-rl-table">
        <div class="c-rl-top">
          <RouletteWheel number={s?.number} />
          {s && (
            <div class="c-rl-outcome">
              <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={`${s.number}（${s.number === 0 ? '緑' : rouletteColor(s.number) === 'red' ? '赤' : '黒'}）`} />
              <RouletteStakes stakes={stakes} number={s.number} coin={p.me.coin} />
            </div>
          )}
        </div>
      </section>
      <RouletteBoard action="/casino/roulette" csrf={csrf} casino={p.casino} coin={p.me.coin} number={s?.number} submitLabel="🎡 回す" memoryKey="solo" />
      <Rules>
        0〜36 の 37 マス（ヨーロピアン）。チップを選んでマスを押すと置けます（何か所でも・{ROULETTE_MAX_SPOTS} か所まで。1 か所 {rouletteMaxOf(p.casino).toLocaleString('ja-JP')} 枚まで）。数字 1 つは 36 倍、赤・黒・奇数・偶数・1〜18・19〜36 は 2 倍、1st 12 などのまとまりと「2:1」（その列）は 3 倍。0 は数字にしか入りません。
      </Rules>
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
