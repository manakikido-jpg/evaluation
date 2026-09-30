import type { Child } from 'hono/jsx';
import type { CasinoConfig, TableKind } from '../../config.js';
import type { CasinoTable } from '../../db/schema.js';
import { BAC_BETS, type BacBet } from '../../services/casino/baccarat.js';
import { handValue } from '../../services/casino/blackjack.js';
import { rouletteBetLabel, rouletteColor, ROULETTE_BETS } from '../../services/casino/roulette.js';
import type { BacTableState, BjTableState, RlTableState } from '../../services/casino/tables/dealer.js';
import { cardLabel, JOKER, type BabaState, type DaifugoState } from '../../services/casino/tables/party.js';
import { blindOptions, BUYIN_MAX_BB, BUYIN_MIN_BB, pokerView, type PokerState } from '../../services/casino/tables/poker.js';
import { TABLE_LABEL } from '../../services/casino/tables/types.js';
import { BetForm, CasinoLayout, Msg, PlayingCard, type CasinoMe, type Coin } from './casino.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');

/** 残り秒（casino.js が 1 秒ごとに書き換える） */
const Countdown = (p: { at: number | null; now: number; label?: string }) =>
  p.at === null ? null : (
    <span class="c-count" data-deadline={String(p.at)}>
      {p.label ?? '残り'} <b>{Math.max(0, Math.ceil((p.at - p.now) / 1000))}</b> 秒
    </span>
  );

const Hidden = (p: { v: Record<string, string> }) => (
  <>
    {Object.entries(p.v).map(([k, v]) => (
      <input type="hidden" name={k} value={v} />
    ))}
  </>
);

function ActForm(p: { id: number; csrf: string; action?: string; children: Child; class?: string; confirm?: string }) {
  return (
    <form method="post" action={`/casino/t/${p.id}/act`} class={p.class ?? 'c-actions'}>
      <Hidden v={{ _csrf: p.csrf, ...(p.action ? { action: p.action } : {}) }} />
      {p.children}
    </form>
  );
}

const Joker = () => (
  <span class="pc joker" aria-label="ジョーカー">
    <span class="pc-mid">🃏</span>
  </span>
);
const Card = (p: { c: number; small?: boolean; delay?: number }) => (p.c === JOKER ? <Joker /> : <PlayingCard c={p.c} small={p.small} delay={p.delay} />);
const Back = (p: { small?: boolean }) => <span class={`pc back${p.small ? ' small' : ''}`} aria-label="伏せたカード"></span>;

// ───────── ロビー ─────────

export function TablesLobby(p: { me: CasinoMe; kind: TableKind; casino: CasinoConfig; tables: CasinoTable[]; mine?: CasinoTable; msg?: string }) {
  const L = TABLE_LABEL[p.kind];
  const csrf = p.me.session.csrfToken;
  const coin = p.me.coin;
  return (
    <CasinoLayout title={L.name} me={p.me} back>
      <h1 class="c-h1">
        {L.emoji} {L.name}
        <span class="c-tag">{L.players}</span>
      </h1>
      {p.msg && <Msg msg={p.msg} />}
      <p class="c-muted">{RULES[p.kind]}</p>
      {p.mine && (
        <section class="c-panel c-center">
          <p>
            あなたは卓 #{p.mine.id}（{TABLE_LABEL[p.mine.kind as TableKind]?.name}）に座っています。
            <a class="c-btn c-btn-gold" href={`/casino/t/${p.mine.id}`}>
              卓へ行く
            </a>
          </p>
        </section>
      )}
      <section class="c-panel">
        <h2>🪑 開いている卓</h2>
        {p.tables.length === 0 ? (
          <p class="c-muted">いまはありません。卓を立てて待ってみましょう。</p>
        ) : (
          <ul class="c-list">
            {p.tables.map((t) => (
              <li>
                <span>
                  #{t.id} {tableSummary(t, coin)}
                </span>
                <a class="c-btn c-btn-small" href={`/casino/t/${t.id}`}>
                  {p.mine?.id === t.id ? '戻る' : '見る・座る'}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!p.mine && (
        <section class="c-panel">
          <h2>🆕 卓を立てる</h2>
          <form method="post" action={`/casino/tables/${p.kind}`} class="c-bet-custom">
            <input type="hidden" name="_csrf" value={csrf} />
            <CreateFields kind={p.kind} casino={p.casino} coin={coin} />
            <button type="submit" class="c-btn c-btn-gold">
              卓を立てて座る
            </button>
          </form>
        </section>
      )}
    </CasinoLayout>
  );
}

const RULES: Record<TableKind, string> = {
  bj_table: 'みんなで同じディーラーと勝負します。だれかが賭けてから 15 秒で配ります（全員賭けたらすぐ）。順番に 20 秒ずつ。配当は 1 人のときと同じです。',
  baccarat_table: 'みんなで同じ勝負に賭けます。だれかが賭けてから 15 秒で配ります（全員賭けたらすぐ）。',
  roulette_table: 'みんなで同じ回転に賭けます。いくつでも賭けられて（10 か所まで）、賭けた人がみんな「回す」を押すか、25 秒たつと回ります。',
  poker: `テキサスホールデム。座るときに銭を持ち込み（ビッグブラインドの ${BUYIN_MIN_BB}〜${BUYIN_MAX_BB} 倍）、立つとチップが銭に戻ります。持ち時間は 30 秒。胴元の取り分はありません。`,
  daifugo: '3〜5 人。同じ数字 1〜4 枚を出し、場より強いものを出していきます。8 切り・4 枚で革命あり。上がった順に参加費をまとめて配ります（3 人: 7:3、4 人: 6:3:1、5 人: 5:3:2）。',
  babanuki: '2〜5 人。となりの人から 1 枚ずつ引いて、そろったら捨てます。最後にババを持っていた人の参加費を、ほかの人で分けます。',
};

function CreateFields(p: { kind: TableKind; casino: CasinoConfig; coin: Coin }) {
  if (p.kind === 'poker') {
    const opts = blindOptions(p.casino.minBet, p.casino.maxBet);
    return (
      <>
        <label>
          ブラインド
          <select name="bb">
            {opts.map((bb) => (
              <option value={String(bb)}>
                {fmt(Math.max(1, Math.floor(bb / 2)))} / {fmt(bb)}（持ち込み {fmt(bb * BUYIN_MIN_BB)}〜{fmt(bb * BUYIN_MAX_BB)}）
              </option>
            ))}
          </select>
        </label>
        <label>
          持ち込む
          <input type="number" name="buyin" min={opts[0]! * BUYIN_MIN_BB} value={String((opts[0] ?? 10) * 50)} inputmode="numeric" />
          {p.coin.name}
        </label>
      </>
    );
  }
  if (p.kind === 'daifugo' || p.kind === 'babanuki') {
    return (
      <label>
        参加費
        <input type="number" name="entry" min={0} max={p.casino.maxBet} value={String(Math.min(100, p.casino.maxBet))} inputmode="numeric" />
        {p.coin.name}（0 で賭けない）
      </label>
    );
  }
  return <span class="c-muted">1 回に {fmt(p.casino.minBet)}〜{fmt(p.casino.maxBet)} {p.coin.name}</span>;
}

function tableSummary(t: CasinoTable, coin: Coin): string {
  const s = t.state as { seats: unknown[] } & Record<string, unknown>;
  const seats = (s.seats ?? []).filter(Boolean) as { name: string }[];
  const who = seats.map((x) => x.name).join('・') || 'だれもいない';
  if (t.kind === 'poker') {
    const ps = t.state as PokerState;
    return `ブラインド ${fmt(ps.sb)}/${fmt(ps.bb)}・${seats.length} 人（${who}）`;
  }
  if (t.kind === 'daifugo' || t.kind === 'babanuki') {
    const ps = t.state as DaifugoState;
    return `参加費 ${ps.entry > 0 ? `${coin.emoji}${fmt(ps.entry)}` : 'なし'}・${ps.phase === 'lobby' ? '相手待ち' : ps.phase === 'playing' ? '対戦中' : '終わり'}・${seats.length} 人（${who}）`;
  }
  return `${seats.length} 人（${who}）`;
}

// ───────── 卓の画面 ─────────

export function TablePage(p: { me: CasinoMe; table: CasinoTable; casino: CasinoConfig; msg?: string; now: number }) {
  const L = TABLE_LABEL[p.table.kind as TableKind];
  return (
    <CasinoLayout title={L.name} me={p.me}>
      <p class="c-back">
        <a href={`/casino/tables/${p.table.kind}`}>← {L.name}の一覧へ</a>
      </p>
      <h1 class="c-h1">
        {L.emoji} {L.name} #{p.table.id}
      </h1>
      {p.msg && <Msg msg={p.msg} />}
      <TableFrag table={p.table} me={p.me} casino={p.casino} now={p.now} />
      <details class="c-rules">
        <summary>遊び方</summary>
        <p>{RULES[p.table.kind as TableKind]}</p>
      </details>
    </CasinoLayout>
  );
}

/** 卓の中身（casino.js が変わったときに差し替える） */
export function TableFrag(p: { table: CasinoTable; me: CasinoMe; casino: CasinoConfig; now: number }) {
  const t = p.table;
  const body =
    t.status !== 'open' ? (
      <section class="c-table c-center">
        <p>この卓は閉じました。</p>
        <a class="c-btn" href={`/casino/tables/${t.kind}`}>
          一覧へ
        </a>
      </section>
    ) : t.kind === 'bj_table' ? (
      <BjView t={t} s={t.state as BjTableState} {...p} />
    ) : t.kind === 'baccarat_table' ? (
      <BacView t={t} s={t.state as BacTableState} {...p} />
    ) : t.kind === 'roulette_table' ? (
      <RlView t={t} s={t.state as RlTableState} {...p} />
    ) : t.kind === 'poker' ? (
      <PokerTableView t={t} s={t.state as PokerState} {...p} />
    ) : t.kind === 'daifugo' ? (
      <DaifugoView t={t} s={t.state as DaifugoState} {...p} />
    ) : (
      <BabaView t={t} s={t.state as BabaState} {...p} />
    );
  return (
    <div id="c-live" data-table={String(t.id)} data-v={String(t.version)} data-now={String(p.now)} data-open={t.status === 'open' ? '1' : '0'}>
      {body}
    </div>
  );
}

type ViewProps<S> = { t: CasinoTable; s: S; me: CasinoMe; casino: CasinoConfig; now: number };

/** 座る・立つ */
function SeatControls(p: { t: CasinoTable; me: CasinoMe; seated: boolean; full: boolean; join?: Child; leaveNote?: string }) {
  const csrf = p.me.session.csrfToken;
  if (p.seated) {
    return (
      <form method="post" action={`/casino/t/${p.t.id}/leave`} class="c-actions">
        <input type="hidden" name="_csrf" value={csrf} />
        <button type="submit" class="c-btn c-btn-ghost c-confirm" data-confirm={p.leaveNote ?? '席を立ちますか？'}>
          席を立つ
        </button>
      </form>
    );
  }
  if (p.full) return <p class="c-center c-muted">満席です。見ていることはできます。</p>;
  return (
    <form method="post" action={`/casino/t/${p.t.id}/join`} class="c-bet-custom">
      <input type="hidden" name="_csrf" value={csrf} />
      {p.join}
      <button type="submit" class="c-btn c-btn-gold">
        座る
      </button>
    </form>
  );
}

const PHASE_BET = '賭けてください';

// 🃏 ブラックジャック卓
function BjView({ t, s, me, casino, now }: ViewProps<BjTableState>) {
  const my = s.seats.find((x) => x.id === me.session.userId);
  const csrf = me.session.csrfToken;
  const hide = s.phase === 'playing';
  const dealer = hide ? s.dealer.slice(0, 1) : s.dealer;
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'betting' ? (s.deadline ? PHASE_BET : 'だれかが賭けると始まります') : s.phase === 'playing' ? `${s.seats.find((x) => x.id === s.turn)?.name ?? ''} さんの番` : '結果'}
          <Countdown at={s.deadline} now={now} />
        </div>
        {s.dealer.length > 0 && (
          <div class="c-hand c-center">
            <div class="c-hand-label">
              ディーラー <b>{hide ? `${handValue(dealer).total} + ?` : handValue(s.dealer).total}</b>
            </div>
            <div class="c-cards c-cards-center">
              {dealer.map((c, i) => (
                <Card c={c} delay={i} />
              ))}
              {hide && <Back />}
            </div>
          </div>
        )}
        <div class="c-seats">
          {s.seats.map((x) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${s.turn === x.id ? ' turn' : ''}`}>
              <div class="c-seat-name">
                {x.name}
                {x.bet > 0 && <span class="c-chipmini">{fmt(x.bet)}</span>}
              </div>
              <div class="c-cards">
                {x.hand.map((c, i) => (
                  <Card c={c} small delay={i} />
                ))}
              </div>
              {x.hand.length > 0 && <div class="c-muted">合計 {handValue(x.hand).total}</div>}
              {x.result && <SeatResult bet={x.bet} payout={x.payout ?? 0} />}
            </div>
          ))}
        </div>
      </section>
      {my && s.phase === 'betting' && my.bet === 0 && <BetForm action={`/casino/t/${t.id}/act`} csrf={csrf} casino={casino} coin={me.coin} label="賭ける" extra={<Hidden v={{ action: 'bet' }} />} />}
      {my && s.phase === 'playing' && s.turn === my.id && (
        <ActForm id={t.id} csrf={csrf}>
          <button type="submit" name="action" value="hit" class="c-btn">
            もう 1 枚（ヒット）
          </button>
          <button type="submit" name="action" value="stand" class="c-btn c-btn-gold">
            これで勝負（スタンド）
          </button>
          {my.hand.length === 2 && !my.doubled && (
            <button type="submit" name="action" value="double" class="c-btn c-btn-ghost">
              ダブル（+{fmt(my.bet)}）
            </button>
          )}
        </ActForm>
      )}
      <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 5} leaveNote="席を立ちますか？（勝負の途中ならスタンドしたことになります）" />
    </>
  );
}

const SeatResult = (p: { bet: number; payout: number }) => {
  const net = p.payout - p.bet;
  return <div class={`c-seat-result ${net > 0 ? 'win' : net < 0 ? 'lose' : 'even'}`}>{net > 0 ? `+${fmt(net)}` : net < 0 ? fmt(net) : '±0'}</div>;
};

// 🎴 バカラ卓
const BAC_SHORT: Record<BacBet, string> = { player: '🔵 プレイヤー', banker: '🔴 バンカー', tie: '🟢 タイ' };
function BacView({ t, s, me, casino, now }: ViewProps<BacTableState>) {
  const my = s.seats.find((x) => x.id === me.session.userId);
  const csrf = me.session.csrfToken;
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'betting' ? (s.deadline ? PHASE_BET : 'だれかが賭けると始まります') : `結果: ${s.last ? BAC_SHORT[s.last.winner] : ''}`}
          <Countdown at={s.deadline} now={now} />
        </div>
        {s.history.length > 0 && (
          <div class="c-road" title="これまでの勝ち">
            {s.history.map((w) => (
              <span class={`c-road-${w}`}>{w === 'player' ? 'P' : w === 'banker' ? 'B' : 'T'}</span>
            ))}
          </div>
        )}
        {s.phase === 'result' && s.last && (
          <div class="c-bac">
            {(['player', 'banker'] as const).map((side) => (
              <div class={`c-hand c-bac-${side}${s.last!.winner === side ? ' won' : ''}`}>
                <div class="c-hand-label">
                  {BAC_SHORT[side]} <b>{side === 'player' ? s.last!.playerTotal : s.last!.bankerTotal}</b>
                </div>
                <div class="c-cards">
                  {(side === 'player' ? s.last!.player : s.last!.banker).map((c, i) => (
                    <Card c={c} delay={i * 2 + (side === 'banker' ? 1 : 0)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div class="c-seats">
          {s.seats.map((x) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}`}>
              <div class="c-seat-name">{x.name}</div>
              {x.bet > 0 ? (
                <div>
                  {x.on && BAC_SHORT[x.on]} <span class="c-chipmini">{fmt(x.bet)}</span>
                </div>
              ) : (
                <div class="c-muted">{s.phase === 'betting' ? '考え中…' : '見ている'}</div>
              )}
              {x.payout !== undefined && <SeatResult bet={x.bet} payout={x.payout} />}
            </div>
          ))}
        </div>
      </section>
      {my && s.phase === 'betting' && my.bet === 0 && (
        <BetForm
          action={`/casino/t/${t.id}/act`}
          csrf={csrf}
          casino={casino}
          coin={me.coin}
          label="賭ける"
          extra={
            <>
              <Hidden v={{ action: 'bet' }} />
              <div class="c-choice">
                {BAC_BETS.map((b, i) => (
                  <label class="c-pick">
                    <input type="radio" name="on" value={b} checked={i === 0} />
                    <span>
                      {BAC_SHORT[b]}（{b === 'player' ? '2' : b === 'banker' ? '1.95' : '9'} 倍）
                    </span>
                  </label>
                ))}
              </div>
            </>
          }
        />
      )}
      <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 8} />
    </>
  );
}

// 🎡 ルーレット卓
function RlView({ t, s, me, casino, now }: ViewProps<RlTableState>) {
  const my = s.seats.find((x) => x.id === me.session.userId);
  const csrf = me.session.csrfToken;
  const numbers = Array.from({ length: 36 }, (_, i) => i + 1);
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'betting' ? (s.deadline ? PHASE_BET : 'だれかが賭けると始まります') : `結果: ${s.number}`}
          <Countdown at={s.deadline} now={now} />
        </div>
        {s.history.length > 0 && (
          <div class="c-road">
            {s.history.map((n) => (
              <span class={`c-rl-hist ${rouletteColor(n)}`}>{n}</span>
            ))}
          </div>
        )}
        {s.phase === 'result' && s.number !== null && (
          <div class="c-wheel-wrap">
            <div class={`c-wheel land-${s.number}`} aria-hidden="true"></div>
            <div class="c-wheel-pin" aria-hidden="true">
              ▼
            </div>
            <div class={`c-ball-num ${rouletteColor(s.number)}`}>{s.number}</div>
          </div>
        )}
        <div class="c-seats">
          {s.seats.map((x) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${x.ready ? ' ready' : ''}`}>
              <div class="c-seat-name">
                {x.name}
                {x.ready && <span class="c-tag">回す</span>}
              </div>
              {x.bets.length ? (
                <ul class="c-mini-list">
                  {x.bets.map((b) => (
                    <li>
                      {rouletteBetLabel(b.on)} <span class="c-chipmini">{fmt(b.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div class="c-muted">{s.phase === 'betting' ? '考え中…' : '見ている'}</div>
              )}
              {x.payout !== undefined && <SeatResult bet={x.bets.reduce((n, b) => n + b.amount, 0)} payout={x.payout} />}
            </div>
          ))}
        </div>
      </section>
      {my && s.phase === 'betting' && (
        <>
          <BetForm
            action={`/casino/t/${t.id}/act`}
            csrf={csrf}
            casino={casino}
            coin={me.coin}
            label="ここに賭ける"
            extra={
              <div class="c-rl">
                <Hidden v={{ action: 'bet' }} />
                <div class="c-rl-outside">
                  {(Object.keys(ROULETTE_BETS) as (keyof typeof ROULETTE_BETS)[]).map((k, i) => (
                    <label class={`c-pick c-rl-${k}`}>
                      <input type="radio" name="on" value={k} checked={i === 0} />
                      <span>
                        {ROULETTE_BETS[k].label} <small>×{ROULETTE_BETS[k].mult}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <div class="c-rl-grid">
                  <label class="c-pick c-rl-n green zero">
                    <input type="radio" name="on" value="n0" />
                    <span>0</span>
                  </label>
                  {numbers.map((n) => (
                    <label class={`c-pick c-rl-n ${rouletteColor(n)}`}>
                      <input type="radio" name="on" value={`n${n}`} />
                      <span>{n}</span>
                    </label>
                  ))}
                </div>
              </div>
            }
          />
          {my.bets.length > 0 && (
            <ActForm id={t.id} csrf={csrf}>
              <button type="submit" name="action" value="ready" class="c-btn c-btn-gold" disabled={my.ready}>
                {my.ready ? 'みんなを待っています…' : '🎡 これで回す'}
              </button>
              <button type="submit" name="action" value="clear" class="c-btn c-btn-ghost">
                賭けを取り消す
              </button>
            </ActForm>
          )}
        </>
      )}
      <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 8} />
    </>
  );
}

// ♠ ポーカー
const PHASE_LABEL: Record<PokerState['phase'], string> = { waiting: '次の手を待っています', preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー', showdown: '結果' };
function PokerTableView({ t, s, me, now }: ViewProps<PokerState>) {
  const v = pokerView(s, me.session.userId);
  const csrf = me.session.csrfToken;
  const shown = new Map((s.result?.shown ?? []).map((x) => [x.id, x]));
  return (
    <>
      <section class="c-table c-poker">
        <div class="c-phase">
          {PHASE_LABEL[s.phase]}
          {s.phase === 'waiting' && s.seats.filter(Boolean).length < 2 && '（2 人そろうと始まります）'}
          {s.turn !== null && ` ・ ${s.seats[s.turn]?.name} さんの番`}
          <Countdown at={s.deadline} now={now} />
        </div>
        <div class="c-board">
          <div class="c-cards c-cards-center">
            {s.board.map((c, i) => (
              <Card c={c} delay={i} />
            ))}
            {Array.from({ length: Math.max(0, 5 - s.board.length) }, () => (
              <span class="pc slot"></span>
            ))}
          </div>
          <div class="c-pot">
            ポット <b>{fmt(v.pot)}</b>
            <span class="c-muted">
              {' '}
              ・ブラインド {fmt(s.sb)}/{fmt(s.bb)}
            </span>
          </div>
        </div>
        <div class="c-seats c-seats-poker">
          {s.seats.map((x, i) =>
            x ? (
              <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${s.turn === i ? ' turn' : ''}${x.folded ? ' folded' : ''}`}>
                <div class="c-seat-name">
                  {s.button === i && <span class="c-dealer-btn">D</span>}
                  {x.name}
                </div>
                <div class="c-muted">
                  チップ <b class="c-gold">{fmt(x.chips)}</b>
                  {x.sittingOut && '（休み）'}
                  {x.leaving && '（立ちます）'}
                </div>
                <div class="c-cards">
                  {x.inHand && !x.folded
                    ? x.id === me.session.userId || shown.has(x.id)
                      ? x.hole.map((c) => <Card c={c} small />)
                      : [<Back small />, <Back small />]
                    : null}
                </div>
                {shown.get(x.id) && <div class="c-tag">{shown.get(x.id)!.hand}</div>}
                {x.bet > 0 && <div class="c-chipmini">{fmt(x.bet)}</div>}
                {x.folded && <div class="c-muted">フォールド</div>}
                {x.allIn && <div class="c-tag">オールイン</div>}
              </div>
            ) : (
              <div class="c-seat empty">空き</div>
            ),
          )}
        </div>
        {s.result && (
          <div class="c-result win">
            <div class="c-result-text">
              {s.result.winners.map((w) => (
                <div>
                  🏆 {w.name} +{fmt(w.amount)}
                  {w.hand ? `（${w.hand}）` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {v.myTurn && v.seat && (
        <ActForm id={t.id} csrf={csrf} class="c-actions c-poker-actions">
          <button type="submit" name="action" value="fold" class="c-btn c-btn-ghost">
            フォールド
          </button>
          {v.toCall === 0 ? (
            <button type="submit" name="action" value="check" class="c-btn">
              チェック
            </button>
          ) : (
            <button type="submit" name="action" value="call" class="c-btn">
              コール {fmt(Math.min(v.toCall, v.seat.chips))}
            </button>
          )}
          {v.maxTo > s.currentBet && (
            <>
              <label class="c-raise">
                {s.currentBet === 0 ? 'ベット' : 'レイズ'}（合計）
                <input type="number" name="amount" min={v.minTo} max={v.maxTo} value={String(v.minTo)} inputmode="numeric" />
              </label>
              <button type="submit" name="action" value="raise" class="c-btn c-btn-gold">
                {s.currentBet === 0 ? 'ベット' : 'レイズ'}
              </button>
            </>
          )}
          <button type="submit" name="action" value="allin" class="c-btn c-btn-ghost c-confirm" data-confirm={`オールイン（${fmt(v.seat.chips)}）しますか？`}>
            オールイン
          </button>
        </ActForm>
      )}
      {v.seat && !(v.seat.inHand && s.phase !== 'waiting' && s.phase !== 'showdown') && (
        <div class="c-actions">
          {v.seat.chips < v.buy.max && (
            <ActForm id={t.id} csrf={csrf} action="rebuy" class="c-bet-custom">
              <label>
                チップを足す
                <input type="number" name="amount" min={1} max={v.buy.max - v.seat.chips} value={String(Math.max(1, Math.min(v.buy.min, v.buy.max - v.seat.chips)))} inputmode="numeric" />
              </label>
              <button type="submit" class="c-btn c-btn-small">
                足す
              </button>
            </ActForm>
          )}
          <ActForm id={t.id} csrf={csrf} action={v.seat.sittingOut ? 'sitin' : 'sitout'}>
            <button type="submit" class="c-btn c-btn-small c-btn-ghost">
              {v.seat.sittingOut ? '戻る（次の手から）' : '休む（次の手から配らない）'}
            </button>
          </ActForm>
        </div>
      )}
      <SeatControls
        t={t}
        me={me}
        seated={Boolean(v.seat) && !v.seat?.leaving}
        full={s.seats.every(Boolean)}
        leaveNote="席を立ちますか？（手の途中ならフォールドして、終わったらチップが銭に戻ります）"
        join={
          <label>
            持ち込む
            <input type="number" name="buyin" min={v.buy.min} max={v.buy.max} value={String(Math.min(v.buy.max, s.bb * 50))} inputmode="numeric" />
            {me.coin.name}（{fmt(v.buy.min)}〜{fmt(v.buy.max)}）
          </label>
        }
      />
      <Log lines={s.log} />
    </>
  );
}

const Log = (p: { lines: string[] }) =>
  p.lines.length ? (
    <details class="c-log" open>
      <summary>できごと</summary>
      <ol>
        {[...p.lines].reverse().map((l) => (
          <li>{l}</li>
        ))}
      </ol>
    </details>
  ) : null;

// 大富豪・ババ抜き（相手待ち・結果）
type PartyState = DaifugoState | BabaState;
function PartyLobby({ t, s, me, min }: { t: CasinoTable; s: PartyState; me: CasinoMe; min: number }) {
  const host = s.seats[0]?.id === me.session.userId;
  return (
    <section class="c-table c-center">
      <p>
        参加費 <b class="c-gold">{s.entry > 0 ? `${me.coin.emoji}${fmt(s.entry)} ${me.coin.name}` : 'なし'}</b>・{s.seats.length} 人（{min} 人から）
      </p>
      <div class="c-seats">
        {s.seats.map((x, i) => (
          <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}`}>
            <div class="c-seat-name">
              {i === 0 && '👑 '}
              {x.name}
            </div>
          </div>
        ))}
      </div>
      {host ? (
        <ActForm id={t.id} csrf={me.session.csrfToken} action="start">
          <button type="submit" class="c-btn c-btn-gold" disabled={s.seats.length < min}>
            {s.seats.length < min ? `あと ${min - s.seats.length} 人で始められます` : 'このメンバーで始める'}
          </button>
        </ActForm>
      ) : (
        <p class="c-muted">部屋を作った人が始めるのを待っています…</p>
      )}
    </section>
  );
}

function PartyDone({ s, me }: { s: PartyState; me: CasinoMe }) {
  return (
    <div class="c-result even">
      <div class="c-result-text">結果</div>
      <ol class="c-rank">
        {s.order.map((id, i) => {
          const pay = s.payouts.find((p) => p.id === id);
          const name = s.seats.find((x) => x.id === id)?.name ?? id;
          return (
            <li class={id === me.session.userId ? 'me' : ''}>
              {i === s.order.length - 1 && s.kind === 'babanuki' ? '🃏 ' : i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}
              {name}
              {s.entry > 0 && <span class="c-muted"> ・{fmt(pay?.amount ?? 0)} {me.coin.name}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const seatState = (s: PartyState, i: number) => {
  const x = s.seats[i]!;
  const rank = s.order.indexOf(x.id);
  if (rank >= 0) return s.kind === 'babanuki' && rank === s.seats.length - 1 ? '🃏 ババ' : `${rank + 1} 番目に上がり`;
  if (x.gone) return '抜けた（自動）';
  return `${x.hand.length} 枚`;
};

// 👑 大富豪
function DaifugoView({ t, s, me, now }: ViewProps<DaifugoState>) {
  const i = s.seats.findIndex((x) => x.id === me.session.userId);
  const my = i >= 0 ? s.seats[i]! : undefined;
  const csrf = me.session.csrfToken;
  if (s.phase === 'lobby')
    return (
      <>
        <PartyLobby t={t} s={s} me={me} min={3} />
        <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 5} join={s.entry > 0 ? <span>参加費 {fmt(s.entry)} {me.coin.name}</span> : undefined} />
      </>
    );
  const myTurn = s.phase === 'playing' && s.turn === i;
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'playing' ? `${s.seats[s.turn ?? 0]?.name} さんの番` : '終わり'}
          {s.revolution && <span class="c-tag c-rev">⚡ 革命中</span>}
          <Countdown at={s.phase === 'playing' ? s.deadline : null} now={now} />
        </div>
        <div class="c-field">
          {s.field ? (
            <div class="c-cards c-cards-center">
              {s.field.cards.map((c) => (
                <Card c={c} />
              ))}
            </div>
          ) : (
            <p class="c-muted c-center">場は空です（{s.phase === 'playing' ? '好きなカードを出せます' : ''}）</p>
          )}
        </div>
        <div class="c-seats">
          {s.seats.map((x, k) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${s.turn === k && s.phase === 'playing' ? ' turn' : ''}${x.out ? ' folded' : ''}`}>
              <div class="c-seat-name">{x.name}</div>
              <div class="c-muted">
                {seatState(s, k)}
                {s.passes.includes(k) && '・パス'}
              </div>
            </div>
          ))}
        </div>
        {s.phase === 'done' && <PartyDone s={s} me={me} />}
      </section>
      {my && !my.out && s.phase === 'playing' && (
        <form method="post" action={`/casino/t/${t.id}/act`} class="c-hand-form">
          <input type="hidden" name="_csrf" value={csrf} />
          <div class="c-myhand">
            {my.hand.map((c) => (
              <label class="c-pickcard">
                <input type="checkbox" name="cards" value={String(c)} disabled={!myTurn} />
                <Card c={c} />
              </label>
            ))}
          </div>
          {myTurn && (
            <div class="c-actions">
              <button type="submit" name="action" value="play" class="c-btn c-btn-gold">
                選んだカードを出す
              </button>
              {s.field && (
                <button type="submit" name="action" value="pass" class="c-btn c-btn-ghost">
                  パス
                </button>
              )}
              <span class="c-muted">{s.field ? `場: ${s.field.n} 枚（${s.field.cards.map(cardLabel).join(' ')}）より強いもの` : '場が空です。何枚でも（同じ数字）'}</span>
            </div>
          )}
        </form>
      )}
      {my && s.phase === 'playing' && !my.out && (
        <SeatControls t={t} me={me} seated full={false} leaveNote="抜けますか？（参加費は戻らず、残りは自動で進みます）" />
      )}
      {s.phase === 'done' && (
        <p class="c-center">
          <a class="c-btn" href={`/casino/tables/${t.kind}`}>
            もう一度（一覧へ）
          </a>
        </p>
      )}
      <Log lines={s.log} />
    </>
  );
}

// 🃟 ババ抜き
function BabaView({ t, s, me, now }: ViewProps<BabaState>) {
  const i = s.seats.findIndex((x) => x.id === me.session.userId);
  const my = i >= 0 ? s.seats[i]! : undefined;
  const csrf = me.session.csrfToken;
  if (s.phase === 'lobby')
    return (
      <>
        <PartyLobby t={t} s={s} me={me} min={2} />
        <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 5} join={s.entry > 0 ? <span>参加費 {fmt(s.entry)} {me.coin.name}</span> : undefined} />
      </>
    );
  const myTurn = s.phase === 'playing' && s.turn === i;
  // 引く相手（次の人）
  let target: number | null = null;
  if (myTurn) {
    for (let k = 1; k <= s.seats.length; k++) {
      const j = (i + k) % s.seats.length;
      if (!s.seats[j]!.out) {
        target = j;
        break;
      }
    }
  }
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'playing' ? `${s.seats[s.turn ?? 0]?.name} さんが引く番` : '終わり'}
          <Countdown at={s.phase === 'playing' ? s.deadline : null} now={now} />
        </div>
        <div class="c-seats">
          {s.seats.map((x, k) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${s.turn === k && s.phase === 'playing' ? ' turn' : ''}${x.out ? ' folded' : ''}`}>
              <div class="c-seat-name">{x.name}</div>
              <div class="c-fan">
                {!x.out &&
                  x.id !== me.session.userId &&
                  x.hand.slice(0, 12).map(() => <Back small />)}
              </div>
              <div class="c-muted">{seatState(s, k)}</div>
            </div>
          ))}
        </div>
        {myTurn && target !== null && (
          <form method="post" action={`/casino/t/${t.id}/act`} class="c-draw">
            <input type="hidden" name="_csrf" value={csrf} />
            <p class="c-center">{s.seats[target]!.name} さんのカードから 1 枚選んでください</p>
            <div class="c-myhand">
              {s.seats[target]!.hand.map((_, pos) => (
                <button type="submit" name="pos" value={String(pos)} class="c-drawcard" aria-label={`${pos + 1} 枚目を引く`}>
                  <Back />
                </button>
              ))}
            </div>
          </form>
        )}
        {s.phase === 'done' && <PartyDone s={s} me={me} />}
      </section>
      {my && !my.out && (
        <section class="c-panel">
          <h2>あなたの手札（{my.hand.length} 枚）</h2>
          <div class="c-myhand">
            {my.hand.map((c) => (
              <Card c={c} />
            ))}
          </div>
        </section>
      )}
      {my && s.phase === 'playing' && !my.out && <SeatControls t={t} me={me} seated full={false} leaveNote="抜けますか？（参加費は戻らず、残りは自動で進みます）" />}
      {s.phase === 'done' && (
        <p class="c-center">
          <a class="c-btn" href={`/casino/tables/${t.kind}`}>
            もう一度（一覧へ）
          </a>
        </p>
      )}
      <Log lines={s.log} />
    </>
  );
}


