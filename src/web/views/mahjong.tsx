import type { Child } from 'hono/jsx';
import type { CasinoConfig } from '../../config.js';
import type { CasinoTable } from '../../db/schema.js';
import type { Meld } from '../../services/casino/mahjong/score.js';
import { shanten } from '../../services/casino/mahjong/shanten.js';
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
  MJ_SHARES,
  MJ_TURN_SECONDS,
  riichiDiscards,
  roundLabel,
  seatWindOf,
  START_POINTS,
  waitsOfSeat,
  type MjState,
} from '../../services/casino/tables/mahjong.js';
import { PACES, paceMult, type Pace } from '../../services/casino/tables/types.js';
import { mahjongArt } from '../assets.js';
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
  if (art) return <img src={art} alt="" draggable={false} />;
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

/** 席の名札（風・点数・リーチ・親） */
function Plate(p: { s: MjState; i: number; meId: string; now: number }) {
  const { s, i } = p;
  const x = s.seats[i]!;
  const playing = s.phase === 'playing';
  const turn = playing && ((s.step === 'turn' && s.turn === i) || ((s.step === 'call' || s.step === 'chankan') && Boolean(s.options[i]) && !s.responses[i]));
  return (
    <div class={`mj-plate${turn ? ' turn' : ''}${x.id === p.meId ? ' me' : ''}`}>
      <span class={`mj-wind${s.kyoku === i ? ' dealer' : ''}`}>{WIND_NAME[seatWindOf(s, i) - 27]}</span>
      <span class="mj-pname">
        {x.name}
        {x.gone ? '（抜けた・BOT）' : x.auto ? '（おまかせ中）' : ''}
      </span>
      <b class="mj-points">{fmt(x.points)}</b>
      {s.riichi[i] && <span class="mj-stick" title="リーチ">リーチ</span>}
      {turn && <Countdown at={s.deadline} now={p.now} label="" />}
    </div>
  );
}

function Opp(p: { s: MjState; i: number; pos: 'top' | 'left' | 'right' | 'bottom'; meId: string; now: number; reveal: boolean }) {
  const { s, i } = p;
  const hand = s.hands[i] ?? [];
  return (
    <section class={`mj-opp mj-${p.pos}`}>
      <Plate s={s} i={i} meId={p.meId} now={p.now} />
      <div class="mj-ohand">
        {p.reveal ? hand.map((t) => <Tile t={t} size="tiny" />) : hand.map(() => <Back size="tiny" />)}
        <Melds melds={s.melds[i] ?? []} me={i} size="tiny" />
      </div>
      <River s={s} i={i} size="small" />
    </section>
  );
}

function Center(p: { s: MjState; now: number }) {
  const { s } = p;
  return (
    <section class="mj-center">
      <div class="mj-round">{roundLabel(s)}</div>
      <div class="mj-info">
        <span>残り {s.wall.length} 枚</span>
        {s.sticks > 0 && <span>供託 {s.sticks}</span>}
      </div>
      <div class="mj-dora">
        <span class="c-muted">ドラ表示</span>
        {doraIndicators(s).map((t) => (
          <Tile t={t} size="small" />
        ))}
      </div>
      {s.log.length > 0 && <div class="mj-lastlog">{s.log.at(-1)}</div>}
    </section>
  );
}

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
  const tileBtn = (tt: number, extra = '') => (
    <button type="submit" name="tile" value={String(tt)} class={tileClass(tt, `big${riichiable.has(tt) ? ' rc' : ''}${tp.has(kindOf(tt)) ? ' tp' : ''}${extra}`)} disabled={!legal.has(tt)} title={kindName(kindOf(tt))}>
      <Face t={tt} />
    </button>
  );
  return (
    <section class={`mj-mine${myTurn || opts ? ' myturn' : ''}`}>
      <River s={s} i={i} size="small" />
      <Plate s={s} i={i} meId={p.me.session.userId} now={p.now} />
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
          <p class="mj-hint">
            {s.riichi[i] ? 'リーチ中: ツモった牌を切ります（和了れるときはツモを）' : '切る牌を押してください。'}
            {tp.size > 0 && !s.riichi[i] && <span class="c-muted">・点のある牌は切るとテンパイ</span>}
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
            テンパイ・待ち <b>{waits.map(kindName).join('・') || 'なし'}</b>
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
  return (
    <>
      <div class="mj-board">
        <Opp s={s} i={at(2)} pos="top" meId={meId} now={p.now} reveal={reveal} />
        <Opp s={s} i={at(3)} pos="left" meId={meId} now={p.now} reveal={reveal} />
        {s.phase === 'result' && s.result ? <ResultBox t={p.t} s={s} i={i} me={p.me} now={p.now} /> : s.phase === 'done' ? <DoneBox s={s} me={p.me} /> : <Center s={s} now={p.now} />}
        <Opp s={s} i={at(1)} pos="right" meId={meId} now={p.now} reveal={reveal} />
        {i >= 0 ? (
          <MyArea t={p.t} s={s} i={i} me={p.me} now={p.now} />
        ) : (
          <Opp s={s} i={at(0)} pos="bottom" meId={meId} now={p.now} reveal={reveal} />
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
        自分の番: 牌を押すと切ります。テンパイできる牌には点が付きます。リーチは「リーチする」に印を付けてから、光っている牌を押します。ほかの人の捨て牌で和了れる・鳴けるときは、ボタンが出ます（{MJ_CALL_SECONDS} 秒）。
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
