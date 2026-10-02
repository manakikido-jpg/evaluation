import type { Child } from 'hono/jsx';
import type { CasinoConfig, TableKind } from '../../config.js';
import type { CasinoTable } from '../../db/schema.js';
import { BAC_BETS, type BacBet } from '../../services/casino/baccarat.js';
import { handValue } from '../../services/casino/blackjack.js';
import { rouletteBetLabel, rouletteColor } from '../../services/casino/roulette.js';
import type { BacTableState, BjTableState, RlTableState } from '../../services/casino/tables/dealer.js';
import { cardLabel, DAIFUGO_RULE_KEYS, DAIFUGO_RULES, JOKER, reversed, rulesOf, type BabaState, type DaifugoState } from '../../services/casino/tables/party.js';
import { ACT_SECONDS, blindOptions, BUYIN_MAX_BB, BUYIN_MIN_BB, POKER_SEATS, pokerView, type PokerState } from '../../services/casino/tables/poker.js';
import { pokerAdvice, type Tone } from '../../services/casino/tables/pokerHints.js';
import { PACES, paceMult, TABLE_LABEL, type Pace } from '../../services/casino/tables/types.js';
import { BetForm, CasinoLayout, FlipCard, Msg, PlayingCard, type CasinoMe, type Coin } from './casino.js';
import { RouletteBoard, RouletteStakes, RouletteWheel } from './rouletteBoard.js';
import { Bowl, ChinGuide } from './chinchiro.js';
import { CHIN_MAX_LOSS, CHIN_MAX_ROLLS, handName, parentDecides, turnHand } from '../../services/casino/chinchiro.js';
import type { ChTableState } from '../../services/casino/tables/chinchiroTable.js';
import { MJ_LENGTHS, MJ_TURN_SECONDS, type MjState } from '../../services/casino/tables/mahjong.js';
import { MahjongView, MJ_RULES, MjCreateFields, MjGuide } from './mahjong.js';

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
/** 卓のカード（前からあるものは動かさない。ck で見分ける） */
const TCard = (p: { c: number; ck: string; small?: boolean; slow?: boolean }) => (p.c === JOKER ? <FlipCard ck={p.ck} small={p.small} face={<Joker />} /> : <FlipCard c={p.c} ck={p.ck} small={p.small} slow={p.slow} />);
const Back = (p: { small?: boolean }) => <span class={`pc back${p.small ? ' small' : ''}`} aria-label="伏せたカード"></span>;

// ───────── ロビー ─────────

export function TablesLobby(p: { me: CasinoMe; kind: TableKind; casino: CasinoConfig; tables: CasinoTable[]; mine?: CasinoTable; msg?: string; extra?: Child }) {
  const L = TABLE_LABEL[p.kind];
  const csrf = p.me.session.csrfToken;
  const coin = p.me.coin;
  const jansou = p.kind === 'mahjong';
  return (
    <CasinoLayout title={jansou ? '咲楽ノ宮雀荘' : L.name} me={p.me} back={jansou ? 'gate' : true} jansou={jansou}>
      {jansou ? (
        <section class="mj-sign">
          <p class="mj-sign-kicker">SAKURANOMIYA JANSOU</p>
          <h1>🀄 咲楽ノ宮雀荘</h1>
          <p class="c-muted">4 人打ちのリーチ麻雀。人が足りなくても 🤖 BOT が入ります。</p>
        </section>
      ) : (
        <h1 class="c-h1">
          {L.emoji} {L.name}
          <span class="c-tag">{L.players}</span>
        </h1>
      )}
      {p.msg && <Msg msg={p.msg} />}
      {jansou ? <MjGuide /> : <p class="c-muted">{RULES[p.kind]}</p>}
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
            {jansou ? (
              <MjCreateFields casino={p.casino} coin={coin} />
            ) : (
              <>
                <CreateFields kind={p.kind} casino={p.casino} coin={coin} />
                <PaceSelect kind={p.kind} />
              </>
            )}
            <button type="submit" class="c-btn c-btn-gold">
              卓を立てて座る
            </button>
          </form>
        </section>
      )}
      {p.extra}
    </CasinoLayout>
  );
}

const RULES: Record<TableKind, string> = {
  bj_table: 'みんなで同じディーラーと勝負します。だれかが賭けてから 15 秒で配ります（全員賭けたらすぐ）。順番に 20 秒ずつ（卓を立てる人が「ゆっくり」「のんびり」にすると 2 倍・4 倍）。配当は 1 人のときと同じです。',
  baccarat_table: 'みんなで同じ勝負に賭けます。だれかが賭けてから 15 秒で配ります（全員賭けたらすぐ）。',
  roulette_table: 'みんなで同じ回転に賭けます。チップを選んで盤のマスを押すと置けます（10 か所まで）。座っている全員が「賭けて回す」を押すか、だれかが賭けてから 25 秒たつと回ります。',
  chinchiro_table: `みんなで同じ親（胴元）にサイコロで挑みます。だれかが賭けてから 15 秒で親が振ります（全員賭けたらすぐ）。親が目なら、子が 1 人ずつ「振る」（3 回まで・持ち時間 20 秒）。負けは最大で賭けの ${CHIN_MAX_LOSS} 倍なので、賭けるときに ${CHIN_MAX_LOSS} 倍を預かり、残りは終わったら返します。`,
  poker: `テキサスホールデム。座るときに銭を持ち込み（ビッグブラインドの ${BUYIN_MIN_BB}〜${BUYIN_MAX_BB} 倍）、立つとチップが銭に戻ります。持ち時間はふつう 30 秒（ゆっくり 1 分・のんびり 2 分も選べます）。胴元の取り分はありません。`,
  daifugo: '3〜5 人。同じ数字 1〜4 枚を出し、場より強いものを出していきます。卓を立てる人がルール（革命・8 切り・ジョーカー・♠3 返し・11 バック・しばり・階段・5 飛ばし・反則上がり）を選べます（ほかに 7 渡し・10 捨て・9 リバース・砂嵐も）。上がった順に参加費をまとめて配ります（3 人: 7:3、4 人: 6:3:1、5 人: 5:3:2）。',
  babanuki: '2〜5 人。となりの人から 1 枚ずつ引いて、そろったら捨てます。最後にババを持っていた人の参加費を、ほかの人で分けます。',
  mahjong: MJ_RULES,
};

/** ふつうのときの持ち時間（秒）。ディーラー卓は賭ける時間 */
const BASE_SECONDS: Record<TableKind, { sec: number; what: string }> = {
  poker: { sec: 30, what: '1 回の持ち時間' },
  bj_table: { sec: 20, what: '1 人の持ち時間' },
  baccarat_table: { sec: 15, what: '賭ける時間' },
  roulette_table: { sec: 25, what: '賭ける時間' },
  daifugo: { sec: 40, what: '1 回の持ち時間' },
  chinchiro_table: { sec: 20, what: '1 人の持ち時間' },
  babanuki: { sec: 25, what: '1 回の持ち時間' },
  mahjong: { sec: MJ_TURN_SECONDS, what: '1 打の持ち時間' },
};
const secText = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} 分` : n > 60 ? `${Math.floor(n / 60)} 分 ${n % 60} 秒` : `${n} 秒`);

function PaceSelect(p: { kind: TableKind }) {
  const b = BASE_SECONDS[p.kind];
  return (
    <label>
      ⏱ {b.what}
      <select name="pace">
        {(Object.keys(PACES) as Pace[]).map((k) => (
          <option value={k}>
            {PACES[k].label}（{secText(b.sec * PACES[k].mult)}）
          </option>
        ))}
      </select>
    </label>
  );
}

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
  if (p.kind === 'daifugo') {
    return (
      <>
        <label>
          参加費
          <input type="number" name="entry" min={0} max={p.casino.maxBet} value={String(Math.min(100, p.casino.maxBet))} inputmode="numeric" />
          {p.coin.name}（0 で賭けない）
        </label>
        <fieldset class="c-rules-pick">
          <legend>📜 ルール（ローカルルール）</legend>
          <input type="hidden" name="rules_set" value="1" />
          {DAIFUGO_RULE_KEYS.map((k) => (
            <label class="c-rule-opt">
              <input type="checkbox" name="rules" value={k} checked={DAIFUGO_RULES[k].on} />
              <span>
                <b>{DAIFUGO_RULES[k].label}</b>
                <small>{DAIFUGO_RULES[k].note}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </>
    );
  }
  if (p.kind === 'babanuki') {
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
  const pace = (t.state as { pace?: Pace }).pace;
  const base = BASE_SECONDS[t.kind as TableKind];
  return `${summaryBody(t, coin)}・⏱ ${base ? secText(base.sec * paceMult({ pace })) : ''}`;
}

function summaryBody(t: CasinoTable, coin: Coin): string {
  const s = t.state as { seats: unknown[] } & Record<string, unknown>;
  const seats = (s.seats ?? []).filter(Boolean) as { name: string }[];
  const who = seats.map((x) => x.name).join('・') || 'だれもいない';
  if (t.kind === 'poker') {
    const ps = t.state as PokerState;
    return `ブラインド ${fmt(ps.sb)}/${fmt(ps.bb)}・${seats.length} 人（${who}）`;
  }
  if (t.kind === 'mahjong') {
    const ms = t.state as MjState;
    const state = ms.phase === 'lobby' ? `相手待ち（空きは BOT）` : ms.phase === 'done' ? '終わり' : `${'東南西北'[ms.wind]}${ms.kyoku + 1}局`;
    return `${MJ_LENGTHS[ms.length].label}・${ms.entry > 0 ? `参加費 ${coin.emoji}${fmt(ms.entry)}` : '賭けなし'}・${state}・${seats.filter((x) => !(x as { bot?: boolean }).bot).length} 人（${who}）`;
  }
  if (t.kind === 'daifugo' || t.kind === 'babanuki') {
    const ps = t.state as DaifugoState;
    const rules = t.kind === 'daifugo' ? `・${rulesOf(ps).map((k) => DAIFUGO_RULES[k].label.replace(/^\S+ /, '')).join('・') || 'ルールなし'}` : '';
    return `参加費 ${ps.entry > 0 ? `${coin.emoji}${fmt(ps.entry)}` : 'なし'}・${ps.phase === 'lobby' ? '相手待ち' : ps.phase === 'playing' ? '対戦中' : '終わり'}・${seats.length} 人（${who}）${rules}`;
  }
  return `${seats.length} 人（${who}）`;
}

// ───────── 卓の画面 ─────────

export function TablePage(p: { me: CasinoMe; table: CasinoTable; casino: CasinoConfig; msg?: string; now: number }) {
  const L = TABLE_LABEL[p.table.kind as TableKind];
  const jansou = p.table.kind === 'mahjong';
  return (
    <CasinoLayout title={jansou ? `雀荘 卓 #${p.table.id}` : L.name} me={p.me} jansou={jansou} wide={jansou}>
      <p class="c-back">
        <a href={jansou ? '/casino/jansou' : `/casino/tables/${p.table.kind}`}>← {jansou ? '雀荘の入口' : `${L.name}の一覧`}へ</a>
      </p>
      <h1 class="c-h1">
        {L.emoji} {jansou ? `卓 #${p.table.id}` : `${L.name} #${p.table.id}`}
      </h1>
      {p.msg && <Msg msg={p.msg} />}
      {p.table.kind === 'poker' && (
        <div class="c-tools">
          <HintToggle />
          <PokerGuide />
        </div>
      )}
      <TableFrag table={p.table} me={p.me} casino={p.casino} now={p.now} />
      {jansou ? (
        <MjGuide />
      ) : (
        <details class="c-rules">
          <summary>遊び方</summary>
          <p>{RULES[p.table.kind as TableKind]}</p>
        </details>
      )}
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
        <a class="c-btn" href={t.kind === 'mahjong' ? '/casino/jansou' : `/casino/tables/${t.kind}`}>
          一覧へ
        </a>
      </section>
    ) : t.kind === 'bj_table' ? (
      <BjView t={t} s={t.state as BjTableState} {...p} />
    ) : t.kind === 'baccarat_table' ? (
      <BacView t={t} s={t.state as BacTableState} {...p} />
    ) : t.kind === 'roulette_table' ? (
      <RlView t={t} s={t.state as RlTableState} {...p} />
    ) : t.kind === 'chinchiro_table' ? (
      <ChView t={t} s={t.state as ChTableState} {...p} />
    ) : t.kind === 'poker' ? (
      <PokerTableView t={t} s={t.state as PokerState} {...p} />
    ) : t.kind === 'mahjong' ? (
      <MahjongView t={t} s={t.state as MjState} me={p.me} now={p.now} />
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
                <TCard c={c} ck={`d:${s.round}:${i}:${c}`} />
              ))}
              {hide && <FlipCard down ck={`d:${s.round}:hole`} />}
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
                  <TCard c={c} small ck={`${x.id}:${s.round}:${i}:${c}`} />
                ))}
              </div>
              {x.hand.length > 0 && <div class="c-muted">合計 {handValue(x.hand).total}</div>}
              {x.result && (
                <div class="c-later">
                  <SeatResult bet={x.bet} payout={x.payout ?? 0} />
                </div>
              )}
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

// 🎲 ちんちろ卓
function ChView({ t, s, me, casino, now }: ViewProps<ChTableState>) {
  const my = s.seats.find((x) => x.id === me.session.userId);
  const csrf = me.session.csrfToken;
  const decided = s.parent.length > 0 && parentDecides(turnHand(s.parent));
  return (
    <>
      <section class="c-table c-chin">
        <div class="c-phase">
          {s.phase === 'betting'
            ? s.deadline
              ? PHASE_BET
              : 'だれかが賭けると始まります'
            : s.phase === 'rolling'
              ? `${s.seats.find((x) => x.id === s.turn)?.name ?? ''} さんが振る番`
              : '結果'}
          <Countdown at={s.deadline} now={now} />
        </div>
        {s.parent.length > 0 && <Bowl who="👺 親（胴元）" rolls={s.parent} ck={`p:${s.round}`} />}
        {decided && s.phase === 'result' && (
          <p class="c-center c-chin-decided c-later">
            親が {handName(turnHand(s.parent))} なので、子は振らずに決まりました
          </p>
        )}
        <div class="c-seats c-chin-seats">
          {s.seats.map((x) => (
            <div class={`c-seat${x.id === me.session.userId ? ' me' : ''}${s.turn === x.id ? ' turn' : ''}`}>
              <div class="c-seat-name">
                {x.name}
                {x.bet > 0 && <span class="c-chipmini">{fmt(x.bet)}</span>}
              </div>
              {x.rolls.length > 0 && <Bowl who="" rolls={x.rolls} ck={`${x.id}:${s.round}`} active={s.turn === x.id} />}
              {x.mult !== undefined && (
                <div class="c-later">
                  <SeatResult bet={x.mult < 0 ? x.bet * -x.mult : x.bet} payout={x.payout ?? 0} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {my && s.phase === 'betting' && my.bet === 0 && (
        <>
          <BetForm action={`/casino/t/${t.id}/act`} csrf={csrf} casino={casino} coin={me.coin} label="賭ける" extra={<Hidden v={{ action: 'bet' }} />} />
          <p class="c-muted c-center">賭けると、その {CHIN_MAX_LOSS} 倍を預かります（負けの備え。残りは終わったら返ります）。</p>
        </>
      )}
      {my && s.phase === 'rolling' && s.turn === my.id && (
        <ActForm id={t.id} csrf={csrf}>
          <button type="submit" name="action" value="roll" class="c-btn c-btn-gold c-roll-btn">
            🎲 振る（{my.rolls.length + 1} / {CHIN_MAX_ROLLS} 回目）
          </button>
        </ActForm>
      )}
      <details class="c-rules">
        <summary>役と倍率</summary>
        <ChinGuide />
      </details>
      <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 6} leaveNote="席を立ちますか？（勝負の途中なら、残りは自動で振ります）" />
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
                    <TCard c={c} slow={i === 2} ck={`${side}:${s.history.length}:${i}:${c}`} />
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
              {x.payout !== undefined && (
                <div class="c-later">
                  <SeatResult bet={x.bet} payout={x.payout} />
                </div>
              )}
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
          {s.phase === 'betting' ? (s.deadline ? PHASE_BET : 'だれかが賭けると始まります') : '🎡 回っています…'}
          <Countdown at={s.deadline} now={now} />
        </div>
        {s.history.length > 0 && (
          <div class="c-road">
            {/* 回っている間は、いま出た数字を見せない */}
            {(s.phase === 'result' ? s.history.slice(0, -1) : s.history).map((n) => (
              <span class={`c-rl-hist ${rouletteColor(n)}`}>{n}</span>
            ))}
          </div>
        )}
        <div class="c-rl-top">
          <RouletteWheel number={s.phase === 'result' ? s.number : null} />
        </div>
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
              {x.payout !== undefined && (
                <div class="c-rl-outcome">
                  <SeatResult bet={x.bets.reduce((n, b) => n + b.amount, 0)} payout={x.payout} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      {my && s.phase === 'betting' && (
        <>
          {my.bets.length > 0 && (
            <div class="c-panel">
              <h2>あなたの賭け{my.ready ? '（回すのを待っています）' : ''}</h2>
              <RouletteStakes stakes={my.bets} number={null} coin={me.coin} />
              <ActForm id={t.id} csrf={csrf}>
                {!my.ready && (
                  <button type="submit" name="action" value="ready" class="c-btn c-btn-gold">
                    🎡 これで回す
                  </button>
                )}
                <button type="submit" name="action" value="clear" class="c-btn c-btn-ghost">
                  賭けを取り消す（返金）
                </button>
              </ActForm>
            </div>
          )}
          {(!my.ready || my.bets.length === 0) && (
            <RouletteBoard
              action={`/casino/t/${t.id}/act`}
              csrf={csrf}
              casino={casino}
              coin={me.coin}
              hidden={{ action: 'bets' }}
              number={s.history.length ? s.history[s.history.length - 1] : null}
              submitLabel={my.bets.length ? '足して回す' : '🎡 賭けて回す'}
              memoryKey="table"
            />
          )}
        </>
      )}
      {my && s.phase === 'result' && my.bets.length > 0 && (
        <section class="c-panel c-rl-outcome">
          <h2>あなたの結果</h2>
          <RouletteStakes stakes={my.bets} number={s.number} coin={me.coin} />
        </section>
      )}
      <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 8} />
    </>
  );
}

// ♠ ポーカー
const PHASE_LABEL: Record<PokerState['phase'], string> = { waiting: '次の手を待っています', preflop: 'プリフロップ（手札 2 枚）', flop: 'フロップ（場に 3 枚）', turn: 'ターン（4 枚目）', river: 'リバー（5 枚目）', showdown: '結果' };
const TONE_ICON: Record<Tone, string> = { go: '🔥', ok: '👍', care: '🤔', fold: '✋' };

/** 持ち時間のバー（casino.js が縮める） */
const TimerBar = (p: { at: number | null; total: number }) =>
  p.at === null ? null : (
    <span class="c-timer" data-deadline={String(p.at)} data-total={String(p.total)}>
      <i></i>
    </span>
  );

function PokerTableView({ t, s, me, now }: ViewProps<PokerState>) {
  const uid = me.session.userId;
  const v = pokerView(s, uid);
  const csrf = me.session.csrfToken;
  const shown = new Map((s.result?.shown ?? []).map((x) => [x.id, x]));
  const winners = new Map((s.result?.winners ?? []).map((w) => [w.id, w]));
  const base = v.me >= 0 ? v.me : 0;
  const mine = v.seat && v.seat.inHand && !v.seat.folded && v.seat.hole.length === 2 ? v.seat : undefined;
  const adv = mine ? pokerAdvice(mine.hole, s.board, { toCall: v.toCall, pot: v.pot, bb: s.bb }) : null;
  const betting = ['preflop', 'flop', 'turn', 'river'].includes(s.phase);
  const inHandNow = Boolean(v.seat?.inHand && s.phase !== 'waiting' && s.phase !== 'showdown');
  return (
    <>
      <section class="c-poker2" data-hand-cat={adv?.category ?? ''}>
        <div class="c-ptop">
          <span class="c-pphase">{PHASE_LABEL[s.phase]}</span>
          {s.phase === 'waiting' && s.seats.filter(Boolean).length < 2 && <span class="c-muted">2 人そろうと始まります</span>}
          {s.turn !== null && <span class="c-pturn">{s.turn === v.me ? '🫵 あなたの番です' : `${s.seats[s.turn]?.name} さんの番`}</span>}
          <Countdown at={s.deadline} now={now} />
          <span class="c-muted c-pblinds">
            ブラインド {fmt(s.sb)}/{fmt(s.bb)}
          </span>
        </div>
        <div class="c-oval">
          <div class="c-oval-rail"></div>
          <div class="c-oval-center">
            <div class="c-cards c-cards-center c-boardcards">
              {s.board.map((c, i) => (
                <span class={adv?.cards.includes(c) ? 'c-hl-card' : ''}>
                  <TCard c={c} ck={`b:${s.hand}:${i}:${c}`} />
                </span>
              ))}
              {Array.from({ length: Math.max(0, 5 - s.board.length) }, () => (
                <span class="pc slot"></span>
              ))}
            </div>
            <div class={`c-pot${v.pot > 0 ? ' has' : ''}`}>
              <span class="c-potchips" aria-hidden="true"></span>
              ポット <b>{fmt(v.pot)}</b>
            </div>
            {s.result && (
              <div class="c-pwin">
                {s.result.winners.map((w) => (
                  <div>
                    🏆 <b>{w.name}</b> +{fmt(w.amount)}
                    {w.hand ? ` ・${w.hand}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          {s.seats.map((x, i) => {
            const pos = (i - base + POKER_SEATS) % POKER_SEATS;
            if (!x) return <div class={`c-pseat pos${pos} empty`}>空き</div>;
            const cls = `c-pseat pos${pos}${x.id === uid ? ' me' : ''}${s.turn === i ? ' turn' : ''}${x.folded ? ' folded' : ''}${winners.has(x.id) ? ' winner' : ''}`;
            return (
              <div class={cls}>
                <div class="c-pseat-box">
                  <div class="c-pseat-name">
                    {s.button === i && <span class="c-dealer-btn" title="ディーラーボタン">D</span>}
                    {x.name}
                  </div>
                  <div class="c-pseat-chips">{fmt(x.chips)}</div>
                  <div class="c-pseat-state">
                    {x.folded ? 'フォールド' : x.allIn ? 'オールイン' : x.sittingOut ? '休み' : x.leaving ? '立ちます' : shown.get(x.id)?.hand ?? ''}
                  </div>
                  {s.turn === i && <TimerBar at={s.deadline} total={ACT_SECONDS * 1000 * paceMult(s)} />}
                </div>
                <div class="c-pseat-cards">
                  {x.inHand && !x.folded
                    ? x.id === uid || shown.has(x.id)
                      ? x.hole.map((c) => <TCard c={c} small ck={`s:${s.hand}:${x.id}:${c}`} />)
                      : [<Back small />, <Back small />]
                    : null}
                </div>
                {x.bet > 0 && (
                  <div class="c-pbet">
                    <span class="c-chipicon" aria-hidden="true"></span>
                    {fmt(x.bet)}
                  </div>
                )}
                {winners.has(x.id) && <div class="c-winbadge">WIN</div>}
              </div>
            );
          })}
        </div>
      </section>
      <div class={`c-dock${v.myTurn ? ' myturn' : ''}`}>
        {v.seat && (
          <div class={`c-hero${v.myTurn ? ' myturn' : ''}`}>
            <div class="c-hero-cards">
              {mine ? (
                mine.hole.map((c) => (
                  <span class={adv?.cards.includes(c) ? 'c-hl-card' : ''}>
                    <TCard c={c} ck={`h:${s.hand}:${c}`} />
                  </span>
                ))
              ) : (
                <span class="c-muted">{v.seat.folded ? 'この手は降りました' : '次の手を待っています'}</span>
              )}
            </div>
            <div class="c-hero-info">
              <div class="c-hero-chips">
                チップ <b>{fmt(v.seat.chips)}</b>
                {v.seat.bet > 0 && <span class="c-muted">（この回に {fmt(v.seat.bet)}）</span>}
              </div>
              {adv && (
                <div class="c-nowhand">
                  <span class="c-nowhand-label">{adv.category === null ? '手札' : '今の役'}</span>
                  <b>{adv.detail}</b>
                </div>
              )}
              {adv && (
                <div class={`c-hints tone-${adv.tone}`}>
                  <div class="c-hint-main">
                    {TONE_ICON[adv.tone]} {adv.advice}
                  </div>
                  {adv.draws.map((d) => (
                    <div class="c-hint-sub draw">🎯 {d}</div>
                  ))}
                  {(adv.equity !== null || adv.potOdds !== null) && (
                    <div class="c-hint-sub">
                      {adv.equity !== null && `次で当たる確率 約 ${adv.equity}%`}
                      {adv.equity !== null && adv.potOdds !== null && ' ・ '}
                      {adv.potOdds !== null && `コールに必要な確率 ${adv.potOdds}%（${fmt(Math.min(v.toCall, v.seat.chips))} を出して ${fmt(v.pot + v.toCall)} を取りに行く）`}
                    </div>
                  )}
                  {v.myTurn && <div class="c-hint-sub">{v.toCall === 0 ? '💡 だれも賭けていないので、チェック（賭けずに次へ）ができます' : `💡 続けるには ${fmt(Math.min(v.toCall, v.seat.chips))} のコールが必要です`}</div>}
                </div>
              )}
            </div>
          </div>
        )}
      {v.myTurn && v.seat && (
        <div class="c-pbar">
          <ActForm id={t.id} csrf={csrf} class="c-pbar-main">
            <button type="submit" name="action" value="fold" class="c-pbtn fold">
              フォールド<small>降りる</small>
            </button>
            {v.toCall === 0 ? (
              <button type="submit" name="action" value="check" class="c-pbtn check">
                チェック<small>賭けずに次へ</small>
              </button>
            ) : (
              <button type="submit" name="action" value="call" class="c-pbtn call">
                コール {fmt(Math.min(v.toCall, v.seat.chips))}
                <small>同じだけ出す</small>
              </button>
            )}
            <button type="submit" name="action" value="allin" class="c-pbtn allin c-confirm" data-confirm={`オールイン（${fmt(v.seat.bet + v.seat.chips)} まで）しますか？`}>
              オールイン<small>{fmt(v.seat.chips)} 全部</small>
            </button>
          </ActForm>
          {v.maxTo > s.currentBet && (
            <div class="c-pbar-raise">
              <span class="c-pbar-label">{s.currentBet === 0 ? '💰 ベット' : '⬆ レイズ'}</span>
              {quickRaises(s, v).map((q) => (
                <ActForm id={t.id} csrf={csrf} action="raise" class="c-inline">
                  <button type="submit" name="amount" value={String(q.to)} class="c-qbtn">
                    {q.label}
                    <small>{fmt(q.to)}</small>
                  </button>
                </ActForm>
              ))}
              <details class="c-rcustom">
                <summary class="c-qbtn c-qbtn-ghost">
                  ✏<small>金額</small>
                </summary>
                <ActForm id={t.id} csrf={csrf} action="raise" class="c-raise">
                  <input type="number" name="amount" min={v.minTo} max={v.maxTo} value={String(v.minTo)} inputmode="numeric" aria-label="合計でいくらにするか" />
                  <button type="submit" class="c-btn c-btn-gold">
                    {s.currentBet === 0 ? 'ベット' : 'レイズ'}
                  </button>
                  <span class="c-muted">{fmt(v.minTo)}〜{fmt(v.maxTo)}（合計）</span>
                </ActForm>
              </details>
            </div>
          )}
        </div>
      )}
      </div>
      {v.seat && !inHandNow && (
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
      {v.seat && !v.seat.leaving && <BotButtons id={t.id} csrf={csrf} canAdd={!s.seats.every(Boolean)} bots={s.seats.filter((x): x is NonNullable<typeof x> => Boolean(x?.bot))} note="BOT の持ち込み（100bb）は胴元が出します。ソルバーのレンジを参考に打つ、強めの BOT です" />}
      {!betting || !v.myTurn ? (
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
      ) : null}
      <Log lines={s.log} />
    </>
  );
}

/** すぐ押せるレイズの量（最小・ポットの半分・ポットぶん）。合計でいくらにするか */
function quickRaises(s: PokerState, v: ReturnType<typeof pokerView>): { label: string; to: number }[] {
  const toCall = v.toCall;
  const potAfterCall = v.pot + toCall;
  const list = [
    { label: '最小', to: v.minTo },
    { label: '½ ポット', to: s.currentBet + Math.floor(potAfterCall / 2) },
    { label: 'ポット', to: s.currentBet + potAfterCall },
  ];
  const seen = new Set<number>();
  return list
    .map((q) => ({ ...q, to: Math.min(v.maxTo, Math.max(v.minTo, q.to)) }))
    .filter((q) => q.to < v.maxTo && !seen.has(q.to) && (seen.add(q.to), true));
}

/** ポーカーの役の一覧（タブで開く。卓の外に置くので、読み直しても閉じない） */
export function PokerGuide() {
  const ex: { cat: number; name: string; cards: number[]; note: string }[] = [
    { cat: 8, name: 'ストレートフラッシュ', cards: [9, 10, 11, 12, 13].map((r) => 13 + r - 1), note: '同じマークで 5 つ続き。A から始まる一番上はロイヤルストレートフラッシュ' },
    { cat: 7, name: 'フォーカード', cards: [8, 21, 34, 47, 1], note: '同じ数字が 4 枚' },
    { cat: 6, name: 'フルハウス', cards: [11, 24, 37, 4, 17], note: '同じ数字 3 枚 ＋ 同じ数字 2 枚' },
    { cat: 5, name: 'フラッシュ', cards: [26 + 1, 26 + 5, 26 + 8, 26 + 10, 26 + 12], note: '同じマークが 5 枚（数字はばらばらでよい）' },
    { cat: 4, name: 'ストレート', cards: [4, 18, 32, 46, 8], note: '数字が 5 つ続く（マークはばらばらでよい）。A-2-3-4-5 もOK' },
    { cat: 3, name: 'スリーカード', cards: [6, 19, 32, 1, 12], note: '同じ数字が 3 枚' },
    { cat: 2, name: 'ツーペア', cards: [9, 22, 3, 16, 11], note: '同じ数字 2 枚が 2 組' },
    { cat: 1, name: 'ワンペア', cards: [0, 13, 7, 22, 36], note: '同じ数字が 2 枚' },
    { cat: 0, name: 'ハイカード（役なし）', cards: [12, 22, 33, 43, 2], note: '役がないときは、一番大きい数字でくらべる' },
  ];
  return (
    <details class="c-guide">
      <summary class="c-guide-tab">📖 役の一覧</summary>
      <div class="c-guide-body">
        <h2>♠ ポーカーの役（上ほど強い）</h2>
        <p class="c-muted">自分の手札 2 枚と、場の 5 枚を合わせた 7 枚から、一番強い 5 枚で勝負します。同じ役なら、数字の大きいほうが勝ち。</p>
        <ol class="c-guide-list">
          {ex.map((e) => (
            <li data-cat={String(e.cat)}>
              <div class="c-guide-name">
                <b>{e.name}</b>
                <span class="c-guide-now">← 今のあなた</span>
              </div>
              <div class="c-cards">
                {e.cards.map((c) => (
                  <PlayingCard c={c} small />
                ))}
              </div>
              <div class="c-muted">{e.note}</div>
            </li>
          ))}
        </ol>
        <h2>流れ</h2>
        <ol class="c-guide-flow">
          <li>手札が 2 枚配られる（プリフロップ）→ 賭ける</li>
          <li>場に 3 枚（フロップ）→ 賭ける</li>
          <li>4 枚目（ターン）→ 賭ける</li>
          <li>5 枚目（リバー）→ 賭けて、残った人で見せ合う</li>
        </ol>
        <h2>ことば</h2>
        <dl class="c-guide-words">
          <dt>チェック</dt>
          <dd>だれも賭けていないとき、賭けずに次へ</dd>
          <dt>コール</dt>
          <dd>前の人と同じだけ出して続ける</dd>
          <dt>ベット・レイズ</dt>
          <dd>最初に賭ける・上乗せする（合計の額を入れる）</dd>
          <dt>フォールド</dt>
          <dd>降りる（それまで出した分は戻らない）</dd>
          <dt>オールイン</dt>
          <dd>持っているチップを全部出す</dd>
          <dt>ブラインド</dt>
          <dd>毎回、ボタン（D）の次の 2 人が先に出す決まった額</dd>
        </dl>
      </div>
    </details>
  );
}

/** ヒントを出す・隠す（casino.js が覚えておく） */
export const HintToggle = () => (
  <button type="button" class="c-hint-toggle" data-hint-toggle aria-pressed="true">
    💡 ヒント
  </button>
);

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

/** 🤖 BOT を入れる・外す */
function BotButtons(p: { id: number; csrf: string; canAdd: boolean; bots: { id: string; name: string }[]; note: string }) {
  return (
    <div class="c-actions c-bots">
      {p.canAdd && (
        <ActForm id={p.id} csrf={p.csrf} action="add_bot" class="c-inline">
          <button type="submit" class="c-btn c-btn-small">
            🤖 BOT を入れる
          </button>
        </ActForm>
      )}
      {p.bots.map((b) => (
        <ActForm id={p.id} csrf={p.csrf} action="remove_bot" class="c-inline">
          <input type="hidden" name="bot" value={b.id} />
          <button type="submit" class="c-btn c-btn-small c-btn-ghost">
            {b.name} を外す
          </button>
        </ActForm>
      ))}
      <p class="c-muted c-small">{p.note}</p>
    </div>
  );
}

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
      {host && (
        <BotButtons
          id={t.id}
          csrf={me.session.csrfToken}
          canAdd={s.seats.length < 5}
          bots={s.seats.filter((x) => x.bot)}
          note={s.entry > 0 ? 'BOT の参加費は胴元が出します（BOT が勝った分は鯖に戻ります）' : 'BOT は少し考えてから動きます'}
        />
      )}
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
  if (s.kind === 'daifugo' && s.fouls?.includes(x.id)) return '🚫 反則上がり';
  if (x.gone) return '抜けた（自動）';
  return `${x.hand.length} 枚`;
};

// 👑 大富豪
/** この卓のルール（押すと説明） */
function DaifugoRules({ s }: { s: DaifugoState }) {
  const on = rulesOf(s);
  return (
    <details class="c-rules-on">
      <summary>
        📜 ルール: {on.length ? on.map((k) => DAIFUGO_RULES[k].label).join('・') : 'ローカルルールなし'}
      </summary>
      <ul>
        {DAIFUGO_RULE_KEYS.map((k) => (
          <li class={on.includes(k) ? 'on' : 'off'}>
            <b>
              {on.includes(k) ? '✅' : '—'} {DAIFUGO_RULES[k].label}
            </b>
            ：{DAIFUGO_RULES[k].note}
          </li>
        ))}
      </ul>
    </details>
  );
}

function DaifugoView({ t, s, me, now }: ViewProps<DaifugoState>) {
  const i = s.seats.findIndex((x) => x.id === me.session.userId);
  const my = i >= 0 ? s.seats[i]! : undefined;
  const csrf = me.session.csrfToken;
  const stairs = rulesOf(s).includes('stairs');
  if (s.phase === 'lobby')
    return (
      <>
        <DaifugoRules s={s} />
        <PartyLobby t={t} s={s} me={me} min={3} />
        <SeatControls t={t} me={me} seated={Boolean(my)} full={s.seats.length >= 5} join={s.entry > 0 ? <span>参加費 {fmt(s.entry)} {me.coin.name}</span> : undefined} />
      </>
    );
  const myTurn = s.phase === 'playing' && s.turn === i;
  return (
    <>
      <section class="c-table">
        <div class="c-phase">
          {s.phase === 'playing'
            ? s.pending
              ? `${s.seats[s.pending.by]?.name} さんが${s.pending.steps[0]!.kind === 'give' ? '🎁 渡す' : '🗑 捨てる'}カードを選んでいます`
              : `${s.seats[s.turn ?? 0]?.name} さんの番`
            : '終わり'}
          {s.dir === -1 && <span class="c-tag">🔄 逆回り</span>}
          {s.revolution && <span class="c-tag c-rev">⚡ 革命中</span>}
          {s.jback && <span class="c-tag c-rev">↩ 11 バック中</span>}
          {s.lock && <span class="c-tag c-lock">🔒 {s.lock.map((k) => ['♠', '♥', '♦', '♣'][k]).join('')} しばり</span>}
          {reversed(s) && <span class="c-tag">いまは 3 が強い</span>}
          <Countdown at={s.phase === 'playing' ? s.deadline : null} now={now} />
        </div>
        <DaifugoRules s={s} />
        <div class="c-field">
          {s.field ? (
            <div class="c-cards c-cards-center">
              {s.field.cards.map((c) => (
                <TCard c={c} ck={`f:${s.played}:${c}`} />
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
          {myTurn && s.pending && (
            <div class="c-actions">
              <button type="submit" name="action" value="choose" class="c-btn c-btn-gold">
                選んだ {Math.min(s.pending.steps[0]!.n, my.hand.length)} 枚を{s.pending.steps[0]!.kind === 'give' ? '次の人に渡す' : '捨てる'}
              </button>
              <span class="c-muted">
                {s.pending.steps[0]!.kind === 'give' ? '🎁 7 渡し' : '🗑 10 捨て'}: 手札から {Math.min(s.pending.steps[0]!.n, my.hand.length)} 枚選んでください（時間切れなら弱いカードから）
              </span>
            </div>
          )}
          {myTurn && !s.pending && (
            <div class="c-actions">
              <button type="submit" name="action" value="play" class="c-btn c-btn-gold">
                選んだカードを出す
              </button>
              {s.field && (
                <button type="submit" name="action" value="pass" class="c-btn c-btn-ghost">
                  パス
                </button>
              )}
              <span class="c-muted">
                {s.field
                  ? `場: ${s.field.type === 'seq' ? `${s.field.n} 枚の階段` : `${s.field.n} 枚`}（${s.field.cards.map(cardLabel).join(' ')}）より${reversed(s) ? '弱い' : '強い'}もの${s.lock ? '・同じマーク' : ''}`
                  : `場が空です。同じ数字なら何枚でも${stairs ? '・同じマークの 3 枚以上の連番（階段）も' : ''}`}
              </span>
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


