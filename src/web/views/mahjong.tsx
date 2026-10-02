import type { Child } from 'hono/jsx';
import type { CasinoConfig } from '../../config.js';
import type { CasinoTable } from '../../db/schema.js';
import type { Meld } from '../../services/casino/mahjong/score.js';
import { shanten, waitsOf } from '../../services/casino/mahjong/shanten.js';
import { countsOf, isRedTile, kindName, KINDS, kindOf, suitOf, tileFace, WIND_NAME } from '../../services/casino/mahjong/tiles.js';
import {
  canKyuushu,
  canTsumo,
  doraIndicators,
  isFuriten,
  kanOptions,
  legalDiscards,
  MJ_CALL_SECONDS,
  MJ_LENGTHS,
  MJ_PREF_KEYS,
  MJ_SHARES,
  MJ_TURN_SECONDS,
  riichiDiscards,
  roundLabel,
  seatWindOf,
  START_POINTS,
  visibleFor,
  waitsOfSeat,
  type MjState,
} from '../../services/casino/tables/mahjong.js';
import { PACES, paceMult, type Pace } from '../../services/casino/tables/types.js';
import { mahjongArt } from '../assets.js';
import type { MjRankRow, MjStats } from '../../services/casino/mahjongStats.js';
import type { CasinoMe, Coin } from './casino.js';

const fmt = (n: number) => n.toLocaleString('ja-JP');
const SUIT_CLASS = ['m', 'p', 's', 'z'];

const HONOR_ART = ['ton', 'nan', 'sha', 'pei', 'haku', 'hatsu', 'chun'];
/** 牌の絵の名前（m1・p5r・chun など） */
export const artName = (t: number) => {
  const k = kindOf(t);
  if (k >= 27) return HONOR_ART[k - 27]!;
  return `${'mps'[suitOf(k)]}${(k % 9) + 1}${isRedTile(t) ? 'r' : ''}`;
};
/** 絵があればその URL（赤 5 の絵がなければ、ふつうの 5 の絵に赤の印） */
const artOf = (t: number) => mahjongArt(artName(t)) ?? (isRedTile(t) ? mahjongArt(artName(t).slice(0, -1)) : undefined);

const tileClass = (t: number, extra = '') => {
  const k = kindOf(t);
  const art = artOf(t);
  const redArt = art && isRedTile(t) && !mahjongArt(artName(t));
  return `mj-t mj-${SUIT_CLASS[suitOf(k)]} mj-k${k}${isRedTile(t) && (!art || redArt) ? ' red' : ''}${art ? ' img' : ''}${extra ? ` ${extra}` : ''}`;
};
const Face = (p: { t: number }) => {
  const art = artOf(p.t);
  const k = kindOf(p.t);
  // 絵の牌は、小さいときに数字の札を角に出す（8 筒・9 索などを見分けやすく）
  if (art)
    return (
      <>
        <img src={art} alt="" draggable={false} />
        {k < 27 && <i class="mj-idx">{(k % 9) + 1}</i>}
      </>
    );
  const f = tileFace(kindOf(p.t));
  return (
    <>
      <b>{f.top}</b>
      {f.bottom && <i>{f.bottom}</i>}
    </>
  );
};

/** 牌 1 枚（size: 手牌・小さい・とても小さい） */
export function Tile(p: { t: number; size?: 'big' | 'small' | 'tiny'; cls?: string }) {
  return (
    <span class={tileClass(p.t, `${p.size ?? 'small'}${p.cls ? ` ${p.cls}` : ''}`)} title={kindName(kindOf(p.t))} aria-label={kindName(kindOf(p.t))}>
      <Face t={p.t} />
    </span>
  );
}
const Back = (p: { size?: 'big' | 'small' | 'tiny' }) => {
  const art = mahjongArt('back');
  return (
    <span class={`mj-t back ${p.size ?? 'small'}${art ? ' img' : ''}`} aria-hidden="true">
      {art && <img src={art} alt="" draggable={false} />}
    </span>
  );
};

function Melds(p: { melds: Meld[]; me: number; size?: 'small' | 'tiny' }) {
  return (
    <div class="mj-melds">
      {p.melds.map((m) => (
        <span class={`mj-meld ${m.type}`}>
          {m.type === 'ankan'
            ? m.tiles.map((t, i) => (i === 0 || i === 3 ? <Back size={p.size} /> : <Tile t={t} size={p.size} />))
            : m.tiles.map((t) => <Tile t={t} size={p.size} cls={t === m.called ? 'side' : ''} />)}
        </span>
      ))}
    </div>
  );
}

function River(p: { s: MjState; i: number; size?: 'small' | 'tiny' }) {
  const r = p.s.rivers[p.i] ?? [];
  const last = p.s.last;
  return (
    <div class="mj-river">
      {r.map((x, n) => (
        <Tile t={x.t} size={p.size} cls={[x.riichi ? 'side' : '', x.called ? 'taken' : '', last && last.seat === p.i && n === r.length - 1 && p.s.step !== 'turn' ? 'last' : ''].filter(Boolean).join(' ')} />
      ))}
    </div>
  );
}

const Countdown = (p: { at: number | null; now: number; label?: string }) =>
  p.at === null ? null : (
    <span class="c-count" data-deadline={String(p.at)}>
      {p.label ?? '残り'} <b>{Math.max(0, Math.ceil((p.at - p.now) / 1000))}</b> 秒
    </span>
  );

function Act(p: { id: number; csrf: string; action: string; children: Child; extra?: Record<string, string>; class?: string }) {
  return (
    <form method="post" action={`/casino/t/${p.id}/act`} class={p.class ?? 'c-inline'}>
      <input type="hidden" name="_csrf" value={p.csrf} />
      <input type="hidden" name="action" value={p.action} />
      {Object.entries(p.extra ?? {}).map(([k, v]) => (
        <input type="hidden" name={k} value={v} />
      ))}
      {p.children}
    </form>
  );
}

/** その人が動く番か（自分の番・鳴くか決める番） */
const actingOf = (s: MjState, i: number) =>
  s.phase === 'playing' && ((s.step === 'turn' && s.turn === i) || ((s.step === 'call' || s.step === 'chankan') && Boolean(s.options[i]) && !s.responses[i]));
const seatTag = (s: MjState, i: number) => {
  const x = s.seats[i]!;
  return `${x.name}${x.gone ? '（BOT）' : x.auto ? '（おまかせ）' : ''}`;
};

/** 向かいの人（上）: 名前・伏せた手・鳴き */
function OppTop(p: { s: MjState; i: number; reveal: boolean }) {
  const { s, i } = p;
  return (
    <div class={`mj-otop${actingOf(s, i) ? ' acting' : ''}`}>
      <span class="mj-oname">{seatTag(s, i)}</span>
      <div class="mj-ohand">{p.reveal ? (s.hands[i] ?? []).map((t) => <Tile t={t} size="tiny" />) : (s.hands[i] ?? []).map(() => <Back size="tiny" />)}</div>
      <Melds melds={s.melds[i] ?? []} me={i} size="tiny" />
    </div>
  );
}

/** 左右の人: 縦書きの名前・横向きの伏せた手・鳴き */
function OppSide(p: { s: MjState; i: number; side: 'left' | 'right'; reveal: boolean }) {
  const { s, i } = p;
  return (
    <div class={`mj-oside mj-o${p.side}${actingOf(s, i) ? ' acting' : ''}`}>
      <span class="mj-oname v" title={seatTag(s, i)}>
        {[...s.seats[i]!.name.replace(/^🤖\s*/, '🤖')].slice(0, 6).map((ch) => (
          <span>{ch}</span>
        ))}
      </span>
      <div class="mj-bars">{p.reveal ? (s.hands[i] ?? []).map((t) => <Tile t={t} size="tiny" />) : (s.hands[i] ?? []).map(() => <span class="mj-bar"></span>)}</div>
      <Melds melds={s.melds[i] ?? []} me={i} size="tiny" />
    </div>
  );
}

/** 真ん中の方角盤: 四辺に風・点数・リーチ棒、まんなかに局・残り・ドラ */
function Compass(p: { s: MjState; at: (d: number) => number; now: number }) {
  const { s } = p;
  const edge = (d: number, pos: 'b' | 'r' | 't' | 'l') => {
    const i = p.at(d);
    const x = s.seats[i]!;
    return (
      <div class={`mj-cedge ${pos}${actingOf(s, i) ? ' turn' : ''}`}>
        {s.riichi[i] && <span class="mj-stickbar" title="リーチ"></span>}
        <span class="mj-row">
          <span class={`mj-cwind${s.kyoku === i ? ' dealer' : ''}`}>{WIND_NAME[seatWindOf(s, i) - 27]}</span>
          <b class="mj-cpts">{fmt(x.points)}</b>
        </span>
      </div>
    );
  };
  const acting = s.phase === 'playing' ? [0, 1, 2, 3].find((i) => actingOf(s, i)) : undefined;
  return (
    <div class="mj-compass">
      {edge(0, 'b')}
      {edge(1, 'r')}
      {edge(2, 't')}
      {edge(3, 'l')}
      <div class="mj-cmid">
        <div class="mj-round">{roundLabel(s)}</div>
        <div class="mj-info">
          <span>残り {s.wall.length}</span>
          {s.sticks > 0 && <span>供託 {s.sticks}</span>}
        </div>
        <div class="mj-dora">
          {doraIndicators(s).map((t) => (
            <Tile t={t} size="tiny" />
          ))}
        </div>
        {acting !== undefined && <Countdown at={s.deadline} now={p.now} label="" />}
      </div>
    </div>
  );
}

/** 卓: 方角盤のまわりに 4 人の河（それぞれの向き） */
function Table(p: { s: MjState; at: (d: number) => number; now: number }) {
  const { s, at } = p;
  return (
    <div class="mj-table">
      <div class="mj-rv rt">
        <River s={s} i={at(2)} size="tiny" />
      </div>
      <div class="mj-rv rl">
        <River s={s} i={at(3)} size="tiny" />
      </div>
      <Compass s={s} at={at} now={p.now} />
      <div class="mj-rv rr">
        <River s={s} i={at(1)} size="tiny" />
      </div>
      <div class="mj-rv rb">
        <River s={s} i={at(0)} size="tiny" />
      </div>
    </div>
  );
}

/** 待ちと残り枚数（「三萬 残り2」） */
function waitText(waits: number[], visible: number[]): string {
  return waits.map((k) => `${kindName(k)} 残り${Math.max(0, 4 - visible[k]!)}`).join('・');
}

const PREF_LABEL: Record<(typeof MJ_PREF_KEYS)[number], { label: string; note: string }> = {
  autoWin: { label: '自動和了', note: '和了れるときは自動でツモ・ロン' },
  noCall: { label: '鳴きなし', note: 'ポン・チー・カンを聞かない（ロンは聞く）' },
  tsumogiri: { label: 'ツモ切り', note: 'ツモった牌をそのまま切る' },
};

/** 切るとテンパイになる牌の種類 */
function tenpaiKinds(hand: number[], melds: number): Set<number> {
  const c = countsOf(hand);
  const out = new Set<number>();
  for (let k = 0; k < KINDS; k++) {
    if (!c[k]) continue;
    c[k]!--;
    if (shanten(c, melds) === 0) out.add(k);
    c[k]!++;
  }
  return out;
}

function MyArea(p: { t: CasinoTable; s: MjState; i: number; me: CasinoMe; now: number }) {
  const { s, i, t } = p;
  const csrf = p.me.session.csrfToken;
  const hand = s.hands[i] ?? [];
  const melds = s.melds[i] ?? [];
  const playing = s.phase === 'playing';
  const myTurn = playing && s.step === 'turn' && s.turn === i;
  const drawn = myTurn ? s.drawn : null;
  const rest = drawn !== null ? hand.filter((x) => x !== drawn) : hand;
  const opts = playing && (s.step === 'call' || s.step === 'chankan') && s.options[i] && !s.responses[i] ? s.options[i]! : null;
  const legal = new Set(myTurn ? legalDiscards(s, i) : []);
  const riichiable = new Set(myTurn ? riichiDiscards(s, i) : []);
  const tp = myTurn ? tenpaiKinds(hand, melds.length) : new Set<number>();
  const x = s.seats[i]!;
  const sh = hand.length % 3 === 1 ? shanten(countsOf(hand), melds.length) : null;
  const waits = sh === 0 ? waitsOfSeat(s, i) : [];
  const furiten = sh === 0 && isFuriten(s, i);
  const visible = visibleFor(s, i);
  // 切るとテンパイの牌: 切ったあとの待ちと残り枚数
  const tpWaits = new Map<number, string>();
  if (tp.size) {
    const c = countsOf(hand);
    for (const k of tp) {
      c[k]!--;
      const w = waitsOf(c, melds.length);
      c[k]!++;
      const left = w.reduce((a, x) => a + Math.max(0, 4 - visible[x]!), 0);
      tpWaits.set(k, `${kindName(k)}を切ると 待ち ${waitText(w, visible)}（あと ${left} 枚）`);
    }
  }
  const tileBtn = (tt: number, extra = '') => (
    <button
      type="submit"
      name="tile"
      value={String(tt)}
      class={tileClass(tt, `big${riichiable.has(tt) ? ' rc' : ''}${tp.has(kindOf(tt)) ? ' tp' : ''}${extra}`)}
      disabled={!legal.has(tt)}
      title={kindName(kindOf(tt))}
      data-waits={tpWaits.get(kindOf(tt))}
    >
      <Face t={tt} />
    </button>
  );
  const prefs = x.prefs ?? {};
  return (
    <section class={`mj-mine${myTurn || opts ? ' myturn' : ''}`}>
      <div class="mj-mybar">
        <span class={`mj-cwind${s.kyoku === i ? ' dealer' : ''}`}>{WIND_NAME[seatWindOf(s, i) - 27]}</span>
        <span class="mj-pname">{x.name}</span>
        {s.riichi[i] && <span class="mj-stick">リーチ</span>}
        {(myTurn || opts) && (
          <span class="mj-yourturn">
            {opts ? '鳴く？' : 'あなたの番'} <Countdown at={s.deadline} now={p.now} label="" />
          </span>
        )}
      </div>
      {myTurn ? (
        <form method="post" action={`/casino/t/${t.id}/act`} class="mj-handform">
          <input type="hidden" name="_csrf" value={csrf} />
          <input type="hidden" name="action" value="discard" />
          <div class="mj-hand">
            {rest.map((tt) => tileBtn(tt))}
            {drawn !== null && <span class="mj-gap"></span>}
            {drawn !== null && tileBtn(drawn, ' drawn')}
            <Melds melds={melds} me={i} size="small" />
          </div>
          {riichiable.size > 0 && (
            <label class="mj-riichi">
              <input type="checkbox" name="riichi" value="1" />
              <span>🎯 リーチする（光っている牌を切るとリーチ・1,000 点を出します）</span>
            </label>
          )}
          <p class="mj-waitinfo" aria-live="polite"></p>
          <p class="mj-hint">
            {s.riichi[i] ? 'リーチ中: ツモった牌を切ります（和了れるときはツモを）' : <span class="mj-hint-tap">切る牌を押してください。</span>}
            {tp.size > 0 && !s.riichi[i] && <span class="c-muted">・点のある牌は切るとテンパイ（押す前に待ちが出ます）</span>}
          </p>
        </form>
      ) : (
        <div class="mj-hand">
          {hand.map((tt) => (
            <Tile t={tt} size="big" />
          ))}
          <Melds melds={melds} me={i} size="small" />
        </div>
      )}
      {myTurn && (
        <div class="c-actions mj-acts">
          {canTsumo(s, i) && (
            <Act id={t.id} csrf={csrf} action="tsumo">
              <button type="submit" class="c-btn c-btn-gold mj-big">
                ツモ
              </button>
            </Act>
          )}
          {kanOptions(s, i).map((o) => (
            <Act id={t.id} csrf={csrf} action={o.type} extra={{ k: String(o.k) }}>
              <button type="submit" class="c-btn">
                {o.type === 'ankan' ? '暗槓' : '加槓'} {kindName(o.k)}
              </button>
            </Act>
          ))}
          {canKyuushu(s, i) && (
            <Act id={t.id} csrf={csrf} action="kyuushu">
              <button type="submit" class="c-btn c-btn-ghost c-confirm" data-confirm="九種九牌で流しますか？（親はそのまま・1 本場つきます）">
                九種九牌で流す
              </button>
            </Act>
          )}
        </div>
      )}
      {opts && s.last && (
        <div class="mj-callbox">
          <p>
            {s.seats[s.last.seat]!.name} さんの <Tile t={s.last.t} size="small" /> {s.step === 'chankan' ? '（加槓）' : ''}を…
          </p>
          <div class="c-actions">
            {opts.map((o) =>
              o.type === 'ron' ? (
                <Act id={t.id} csrf={csrf} action="ron">
                  <button type="submit" class="c-btn c-btn-gold mj-big">
                    ロン
                  </button>
                </Act>
              ) : (
                <Act id={t.id} csrf={csrf} action={o.type} extra={{ use: o.use.join(',') }}>
                  <button type="submit" class="c-btn mj-callbtn">
                    {{ pon: 'ポン', chi: 'チー', minkan: 'カン' }[o.type]}
                    <span class="mj-callt">
                      {[...o.use, s.last!.t].sort((a, b) => a - b).map((tt) => (
                        <Tile t={tt} size="tiny" />
                      ))}
                    </span>
                  </button>
                </Act>
              ),
            )}
            <Act id={t.id} csrf={csrf} action="pass">
              <button type="submit" class="c-btn c-btn-ghost">
                スキップ
              </button>
            </Act>
            <Countdown at={s.deadline} now={p.now} />
          </div>
        </div>
      )}
      <p class="mj-status">
        {sh === 0 ? (
          <>
            テンパイ・待ち <b>{waitText(waits, visible) || 'なし'}</b>
            {furiten && <span class="mj-furiten">フリテン（ロンできません）</span>}
          </>
        ) : sh !== null && sh > 0 ? (
          <span class="c-muted">{sh} 向聴</span>
        ) : null}
        {x.auto && (
          <Act id={t.id} csrf={csrf} action="resume">
            <button type="submit" class="c-btn c-btn-small">
              おまかせをやめる
            </button>
          </Act>
        )}
      </p>
      {(playing || s.phase === 'result') && (
        <div class="mj-prefs">
          {MJ_PREF_KEYS.map((k) => (
            <Act id={t.id} csrf={csrf} action="pref" extra={{ key: k, on: prefs[k] ? '0' : '1' }}>
              <button type="submit" class={`mj-pref${prefs[k] ? ' on' : ''}`} aria-pressed={prefs[k] ? 'true' : 'false'} title={PREF_LABEL[k].note}>
                {PREF_LABEL[k].label}
              </button>
            </Act>
          ))}
          <button type="button" class="mj-pref" data-mj-twotap aria-pressed="true" title="スマホで、1 回目のタップで牌を浮かせ、2 回目で切る">
            2 回タップで切る
          </button>
        </div>
      )}
    </section>
  );
}

function ResultBox(p: { t: CasinoTable; s: MjState; i: number; me: CasinoMe; now: number }) {
  const { s } = p;
  const r = s.result!;
  const seated = p.i >= 0 && !s.seats[p.i]!.gone;
  const ready = s.ready.includes(p.me.session.userId);
  return (
    <section class="mj-result">
      <h2>
        {r.label}{' '}
        {r.kind === 'ron' ? `${s.seats[r.winner!]!.name} のロン` : r.kind === 'tsumo' ? `${s.seats[r.winner!]!.name} のツモ` : r.kind === 'draw' ? '流局' : `途中流局（${r.note}）`}
      </h2>
      {r.score && r.hand && (
        <>
          <div class="mj-hand mj-winhand">
            {r.hand
              .filter((x) => x !== r.winTile)
              .map((x) => (
                <Tile t={x} size="small" />
              ))}
            <span class="mj-gap"></span>
            <Tile t={r.winTile!} size="small" cls="win" />
            <Melds melds={r.melds ?? []} me={r.winner!} size="small" />
          </div>
          <ul class="mj-yaku">
            {r.score.yaku.map((y) => (
              <li>
                <span>{y.name}</span>
                <b>{r.score!.yakuman ? '役満' : `${y.han} 翻`}</b>
              </li>
            ))}
          </ul>
          <p class="mj-score">
            {r.score.yakuman ? '' : `${r.score.fu} 符 ${r.score.han} 翻 `}
            {r.score.limit && <b class="c-gold">{r.score.limit} </b>}
            <b>{fmt(r.score.total)} 点</b>
          </p>
          <div class="mj-dora">
            <span class="c-muted">ドラ表示</span>
            {r.dora.map((x) => (
              <Tile t={x} size="tiny" />
            ))}
            {r.ura.length > 0 && <span class="c-muted">裏</span>}
            {r.ura.map((x) => (
              <Tile t={x} size="tiny" />
            ))}
          </div>
        </>
      )}
      {r.hands?.some(Boolean) && (
        <div class="mj-tenpai">
          {r.hands.map((h, j) =>
            h ? (
              <div>
                <span class="mj-pname">{s.seats[j]!.name}</span>
                {r.kind === 'draw' && <span class="c-tag">テンパイ</span>}
                <div class="mj-hand">
                  {h.map((x) => (
                    <Tile t={x} size="tiny" />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
      <table class="mj-deltas">
        <tbody>
          {s.seats.map((x, j) => (
            <tr class={x.id === p.me.session.userId ? 'me' : ''}>
              <td>{x.name}</td>
              <td class={`num ${r.deltas[j]! > 0 ? 'c-win' : r.deltas[j]! < 0 ? 'c-lose' : ''}`}>{r.deltas[j]! > 0 ? `+${fmt(r.deltas[j]!)}` : r.deltas[j]! < 0 ? fmt(r.deltas[j]!) : '±0'}</td>
              <td class="num">{fmt(x.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="c-actions">
        {seated && !ready && (
          <Act id={p.t.id} csrf={p.me.session.csrfToken} action="next">
            <button type="submit" class="c-btn c-btn-gold">
              次へ
            </button>
          </Act>
        )}
        {ready && <span class="c-muted">ほかの人を待っています…</span>}
        <Countdown at={s.deadline} now={p.now} label="次の局まで" />
      </div>
    </section>
  );
}

function DoneBox(p: { s: MjState; me: CasinoMe }) {
  const { s } = p;
  return (
    <section class="mj-result">
      <h2>🏁 終局</h2>
      <ol class="c-rank mj-final">
        {s.payouts.map((x, n) => (
          <li class={x.id === p.me.session.userId ? 'me' : ''}>
            {['🥇', '🥈', '🥉', '　'][n]} {x.name} <b>{fmt(x.points)} 点</b>
            {s.entry > 0 && (
              <span class="c-muted">
                {' '}
                ・{p.me.coin.emoji}
                {fmt(x.amount)} {p.me.coin.name}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p class="c-center">
        <a class="c-btn" href="/casino/jansou">
          雀荘の入口へ
        </a>
      </p>
    </section>
  );
}

function Lobby(p: { t: CasinoTable; s: MjState; me: CasinoMe }) {
  const { s, me } = p;
  const csrf = me.session.csrfToken;
  const host = s.seats[0]?.id === me.session.userId;
  const seated = s.seats.some((x) => x.id === me.session.userId);
  return (
    <section class="c-table c-center mj-lobby">
      <p>
        {MJ_LENGTHS[s.length].label}・<b class="c-gold">{s.entry > 0 ? `参加費 ${me.coin.emoji}${fmt(s.entry)} ${me.coin.name}` : '賭けなし（点数だけ）'}</b>・⏱ 1 打 {MJ_TURN_SECONDS * paceMult(s)} 秒
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
        {Array.from({ length: 4 - s.seats.length }, () => (
          <div class="c-seat empty">
            <div class="c-seat-name c-muted">空き（始めると 🤖 BOT）</div>
          </div>
        ))}
      </div>
      {host && (
        <div class="c-actions c-bots">
          {s.seats.length < 4 && (
            <Act id={p.t.id} csrf={csrf} action="add_bot">
              <button type="submit" class="c-btn c-btn-small">
                🤖 BOT を入れる
              </button>
            </Act>
          )}
          {s.seats
            .filter((x) => x.bot)
            .map((b) => (
              <Act id={p.t.id} csrf={csrf} action="remove_bot" extra={{ bot: b.id }}>
                <button type="submit" class="c-btn c-btn-small c-btn-ghost">
                  {b.name} を外す
                </button>
              </Act>
            ))}
        </div>
      )}
      {host ? (
        <Act id={p.t.id} csrf={csrf} action="start" class="c-actions">
          <button type="submit" class="c-btn c-btn-gold">
            {s.seats.length < 4 ? `始める（空いた ${4 - s.seats.length} 席は BOT）` : 'このメンバーで始める'}
          </button>
        </Act>
      ) : (
        <p class="c-muted">卓を立てた人が始めるのを待っています…（空いた席は BOT が入ります）</p>
      )}
      {s.entry > 0 && <p class="c-muted c-small">BOT の参加費は胴元が出します。終わったら 1 位 {MJ_SHARES[0]}%・2 位 {MJ_SHARES[1]}%・3 位 {MJ_SHARES[2]}% で分けます。</p>}
      {seated ? (
        <form method="post" action={`/casino/t/${p.t.id}/leave`} class="c-actions">
          <input type="hidden" name="_csrf" value={csrf} />
          <button type="submit" class="c-btn c-btn-ghost">
            席を立つ
          </button>
        </form>
      ) : s.seats.length < 4 ? (
        <form method="post" action={`/casino/t/${p.t.id}/join`} class="c-actions">
          <input type="hidden" name="_csrf" value={csrf} />
          <button type="submit" class="c-btn c-btn-gold">
            座る{s.entry > 0 ? `（参加費 ${fmt(s.entry)} ${me.coin.name}）` : ''}
          </button>
        </form>
      ) : (
        <p class="c-muted">満席です。見ていることはできます。</p>
      )}
    </section>
  );
}

/** 🀄 卓の中身 */
export function MahjongView(p: { t: CasinoTable; s: MjState; me: CasinoMe; now: number }) {
  const { s } = p;
  if (s.phase === 'lobby') return <Lobby t={p.t} s={s} me={p.me} />;
  const meId = p.me.session.userId;
  const i = s.seats.findIndex((x) => x.id === meId);
  const base = i >= 0 ? i : 0;
  const at = (d: number) => (base + d) % 4;
  const reveal = s.phase === 'done';
  const seated = i >= 0 && !s.seats[i]!.gone;
  const posOf = (seat: number) => (['b', 'r', 't', 'l'] as const)[(seat - base + 4) % 4];
  const fx = (s.fx ?? []).map((e) => ({ n: e.n, k: e.k, pos: posOf(e.seat), mine: e.seat === i }));
  return (
    <>
      <div class="mj-board2">
        <div class="mj-fxdata" hidden data-fx={JSON.stringify(fx)}></div>
        <OppTop s={s} i={at(2)} reveal={reveal} />
        <OppSide s={s} i={at(3)} side="left" reveal={reveal} />
        <Table s={s} at={at} now={p.now} />
        <OppSide s={s} i={at(1)} side="right" reveal={reveal} />
        {i >= 0 ? (
          <MyArea t={p.t} s={s} i={i} me={p.me} now={p.now} />
        ) : (
          <div class="mj-mine spectate">
            <OppTop s={s} i={at(0)} reveal={reveal} />
          </div>
        )}
        {s.phase === 'result' && s.result && (
          <div class="mj-overlay">
            <ResultBox t={p.t} s={s} i={i} me={p.me} now={p.now} />
          </div>
        )}
        {s.phase === 'done' && (
          <div class="mj-overlay">
            <DoneBox s={s} me={p.me} />
          </div>
        )}
      </div>
      <details class="c-rules mj-log">
        <summary>これまで</summary>
        <ul>
          {s.log.map((l) => (
            <li>{l}</li>
          ))}
        </ul>
      </details>
      {seated && s.phase !== 'done' && (
        <form method="post" action={`/casino/t/${p.t.id}/leave`} class="c-actions">
          <input type="hidden" name="_csrf" value={p.me.session.csrfToken} />
          <button type="submit" class="c-btn c-btn-ghost c-confirm" data-confirm="途中で抜けますか？ 残りは BOT が打ちます（参加費は戻りません。順位の分はもらえます）">
            席を立つ（BOT に任せる）
          </button>
        </form>
      )}
    </>
  );
}

/** 卓を立てるときの選び方 */
export function MjCreateFields(p: { casino: CasinoConfig; coin: Coin }) {
  return (
    <>
      <label>
        長さ
        <select name="length">
          <option value="tonpu">東風戦（4 局〜・20 分くらい）</option>
          <option value="hanchan">半荘戦（8 局〜・40 分くらい）</option>
        </select>
      </label>
      {p.casino.mahjongBets ? (
        <fieldset class="mj-wager">
          <legend>賭け</legend>
          <label>
            <input type="radio" name="wager" value="off" checked /> 賭けない（点数だけで遊ぶ）
          </label>
          <label>
            <input type="radio" name="wager" value="on" /> 参加費を賭ける
            <input type="number" name="entry" min={p.casino.minBet} max={p.casino.maxBet} value={String(Math.min(Math.max(100, p.casino.minBet), p.casino.maxBet))} inputmode="numeric" />
            {p.coin.name}
          </label>
        </fieldset>
      ) : (
        <>
          <input type="hidden" name="wager" value="off" />
          <span class="c-muted">いまは賭けなし（点数だけで遊びます）</span>
        </>
      )}
      <label>
        ⏱ 1 打の持ち時間
        <select name="pace">
          {(Object.keys(PACES) as Pace[]).map((k) => (
            <option value={k}>
              {PACES[k].label}（{MJ_TURN_SECONDS * PACES[k].mult} 秒・鳴きは {MJ_CALL_SECONDS * PACES[k].mult} 秒）
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export const MJ_RULES = `4 人打ちのリーチ麻雀です。卓を立てる人が、賭けない（点数だけ）か参加費を賭けるかを選べます。${fmt(START_POINTS)} 点持ち・赤ドラ 3 枚・喰いタンあり・後付けあり。ロンが重なったときは、出した人から近い 1 人だけ（頭ハネ）。0 点を下回った人が出たら終わり。オーラスで親がトップなら和了りやめ。途中流局は九種九牌だけ。空いた席・抜けた人・2 回続けて時間切れになった人は BOT が打ちます。賭ける卓の参加費は、終わったら順位で分けます（1 位 ${MJ_SHARES[0]}%・2 位 ${MJ_SHARES[1]}%・3 位 ${MJ_SHARES[2]}%・4 位 0）。`;

const YAKU_LIST: [string, string][] = [
  ['1 翻', '立直・一発・門前清自摸和・平和・断么九・一盃口・役牌（白 發 中・自風・場風）・海底摸月・河底撈魚・嶺上開花・槍槓'],
  ['2 翻', 'ダブル立直・七対子・三色同順（鳴き 1）・一気通貫（鳴き 1）・混全帯么九（鳴き 1）・対々和・三暗刻・三色同刻・三槓子・混老頭・小三元'],
  ['3 翻', '混一色（鳴き 2）・純全帯么九（鳴き 2）・二盃口'],
  ['6 翻', '清一色（鳴き 5）'],
  ['役満', '国士無双・四暗刻・大三元・小四喜・大四喜・字一色・清老頭・緑一色・九蓮宝燈・四槓子・天和・地和'],
];

export function MjGuide() {
  return (
    <details class="c-rules mj-guide">
      <summary>📖 遊び方・役の一覧</summary>
      <p>{MJ_RULES}</p>
      <p>
        自分の番: 牌を押すと切ります（スマホは 1 回目のタップで牌が浮き、もう一度タップで切ります。「2 回タップで切る」で切り替え）。テンパイできる牌には点が付き、押す前に「切ると待ち ○○ 残り n 枚」が出ます。リーチは「リーチする」に印を付けてから、光っている牌を押します。ほかの人の捨て牌で和了れる・鳴けるときは、ボタンが出ます（{MJ_CALL_SECONDS} 秒）。
      </p>
      <p>
        便利ボタン: 「自動和了」和了れるときは自動でツモ・ロン／「鳴きなし」ポン・チー・カンを聞かない（ロンは聞く）／「ツモ切り」ツモった牌をそのまま切る。いつでも切り替えられます。
      </p>
      <ul class="mj-yakulist">
        {YAKU_LIST.map(([h, list]) => (
          <li>
            <b>{h}</b> {list}
          </li>
        ))}
      </ul>
      <p class="c-muted">点数: 30 符 1 翻 1,000 点（親 1,500）… 満貫 8,000（親 12,000）・跳満 12,000・倍満 16,000・三倍満 24,000・役満 32,000（親は 1.5 倍）。本場は 1 本 300 点。</p>
    </details>
  );
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 雀荘の入口: あなたの戦績（通算）と今月のランキング */
export function MjRecords(p: { me: CasinoMe; stats: MjStats; ranking: MjRankRow[]; minGames: number }) {
  const { stats: st } = p;
  const myRank = p.ranking.findIndex((r) => r.memberId === p.me.session.userId);
  return (
    <div class="mj-records">
      <section class="c-panel">
        <h2>📊 あなたの戦績（通算）</h2>
        {st.games === 0 ? (
          <p class="c-muted">まだ対局がありません。終局まで打つと、ここに残ります。</p>
        ) : (
          <>
            <div class="mj-tiles">
              <div>
                <span>対局</span>
                <b>{fmt(st.games)}</b>
              </div>
              <div>
                <span>平均順位</span>
                <b>{st.avgRank.toFixed(2)}</b>
              </div>
              <div>
                <span>トップ率</span>
                <b>{pct(st.ranks[0] / st.games)}</b>
              </div>
              <div>
                <span>ラス回避</span>
                <b>{pct(1 - st.ranks[3] / st.games)}</b>
              </div>
              <div>
                <span>和了率</span>
                <b>{pct(st.winRate)}</b>
              </div>
              <div>
                <span>放銃率</span>
                <b>{pct(st.dealinRate)}</b>
              </div>
              <div>
                <span>リーチ率</span>
                <b>{pct(st.riichiRate)}</b>
              </div>
              <div>
                <span>最高の和了</span>
                <b>{st.best ? `${fmt(st.best.points)}` : '—'}</b>
                {st.best?.name && <small>{st.best.name}</small>}
              </div>
            </div>
            <p class="mj-rankchips" aria-label="順位の回数">
              {st.ranks.map((n, k) => (
                <span class={`r${k + 1}`}>
                  {k + 1} 位 <b>{n}</b> 回
                </span>
              ))}
            </p>
          </>
        )}
      </section>
      <section class="c-panel">
        <h2>🏆 今月のランキング</h2>
        {p.ranking.length === 0 ? (
          <p class="c-muted">今月 {p.minGames} 戦以上打った人がまだいません。</p>
        ) : (
          <table class="mj-ranking">
            <thead>
              <tr>
                <th></th>
                <th>名前</th>
                <th class="num">平均順位</th>
                <th class="num">トップ率</th>
                <th class="num">対局</th>
              </tr>
            </thead>
            <tbody>
              {p.ranking.map((r, n) => (
                <tr class={r.memberId === p.me.session.userId ? 'me' : ''}>
                  <td>{['🥇', '🥈', '🥉'][n] ?? n + 1}</td>
                  <td>{r.name}</td>
                  <td class="num">{r.avgRank.toFixed(2)}</td>
                  <td class="num">{pct(r.topRate)}</td>
                  <td class="num">{r.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p class="c-muted c-small">
          {p.minGames} 戦以上・平均順位の低い順（同じなら対局の多い順）。BOT は入りません。{myRank >= 0 ? `あなたは ${myRank + 1} 位です。` : ''}
        </p>
      </section>
    </div>
  );
}
