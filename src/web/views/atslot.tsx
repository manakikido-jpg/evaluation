import type { CasinoGameRow } from '../../db/schema.js';
import { AT_CEILING, AT_CZ_GAMES, AT_HEAVEN_CEILING, AT_IDLE_STOPS, AT_PAYLINES, AT_RATES, AT_REEL_LEN, AT_REELS, AT_ROLES, AT_SET_GAMES, AT_SYMBOLS, atGrid, atWinLine, type AtEvent, type AtMachine, type AtSym } from '../../services/casino/slotAt.js';
import { AT_SEAT_MINUTES, type AtDay, type AtGameState } from '../../services/casino/slotAtPlay.js';
import type { AtShow, AtStage } from '../../services/casino/slotAtShow.js';
import { assetUrl, slotArt } from '../assets.js';
import { CasinoLayout, Msg, Rules, type GamePage } from './casino.js';
import { MaxBet, MedalTray } from './slotParts.js';
import { seatUntil, type SlotSeat } from '../../services/casino/slotSeats.js';
import { SlotPlayer, SlotSeatControls } from './slotPlayer.js';

/**
 * 🦊 AT 機「鬼斬り白狐」の島と台。リールの動き・押し順・演出は casino.js（initAtSlot）
 * - spin: レバーを叩いたばかり。STOP はどの順でも押せる（止まる目は決まっている: data-stops）
 * - wait: AT 中の押し順ベル。止め終わったら押した順を送る（data-order のフォーム）
 * - settle: 押した順を送ったあと。data-from の目から data-stops へすべらせてそろえる
 * - still: 止まったまま
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const NAVI_MARK = ['①', '②', '③'];

/** スロットの島を選ぶ（ジャグラーの島・AT の島） */
export function SlotIslands(p: { on: 'slots' | 'atslot'; games: string[]; atOpen: boolean }) {
  if (!p.games.includes('slots') || !p.games.includes('atslot') || !p.atOpen) return null;
  return (
    <nav class="c-islands" aria-label="スロットの島">
      <a href="/casino/slots" class={p.on === 'slots' ? 'on' : ''} aria-current={p.on === 'slots' ? 'page' : undefined}>
        🌸 SAKURA 777 の島<small>ジャグラー風</small>
      </a>
      <a href="/casino/atslot" class={p.on === 'atslot' ? 'on' : ''} aria-current={p.on === 'atslot' ? 'page' : undefined}>
        🦊 鬼斬り白狐の島<small>AT 機</small>
      </a>
    </nav>
  );
}

function Sym(p: { k: AtSym; art?: Record<string, string> }) {
  const src = p.art?.[`sym-${p.k}`] ?? slotArt(`at-${p.k}`);
  if (src) return <img class={`sy sy-at-${p.k}`} src={src} alt="" draggable="false" />;
  // BAR は文字で（絵文字だと細い線になる）
  if (p.k === 'bar') return <span class="sy sy-at-bar">
    <b>BAR</b>
  </span>;
  return <span class={`sy sy-at-${p.k}`}>{AT_SYMBOLS[p.k].emoji}</span>;
}

/** 白狐の面（役物・腰パネルの仮の絵） */
function FoxMask() {
  return (
    <svg class="c-at-mask" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mask-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff3b0" />
          <stop offset=".5" stop-color="#d6a531" />
          <stop offset="1" stop-color="#7a5210" />
        </linearGradient>
      </defs>
      <path d="M60 18 L28 4 L30 46 C18 58 20 82 36 94 L60 114 L84 94 C100 82 102 58 90 46 L92 4 Z" fill="#fbfbff" stroke="url(#mask-gold)" stroke-width="5" stroke-linejoin="round" />
      <path d="M33 14 L42 40 L35 43 Z M87 14 L78 40 L85 43 Z" fill="#e8203c" />
      <path d="M38 62 Q48 54 56 66 M82 62 Q72 54 64 66" stroke="#e8203c" stroke-width="4" fill="none" stroke-linecap="round" />
      <path d="M60 30 L55 42 L60 48 L65 42 Z" fill="#e8203c" />
      <path class="c-at-mask-eye" d="M40 72 Q48 66 56 74 Q48 76 40 72 Z M80 72 Q72 66 64 74 Q72 76 80 72 Z" fill="#d0102e" />
      <path d="M50 96 Q60 102 70 96" stroke="#e8203c" stroke-width="3" fill="none" stroke-linecap="round" />
    </svg>
  );
}

export type AtMachineView = { machine: number; state: AtMachine; seatBy: string | null; seatAt: Date | null; seatName: string | null; seatAvatar?: string | null; awayUntil?: Date | null };
type FloorData = { today: AtDay[]; yesterday: AtDay[] };

/** 台の上の数字: 通常時はいまの回転数、AT 中は「AT 中」 */
const counterText = (m: AtMachine) => (m.phase === 'at' ? 'AT中' : m.phase === 'cz' ? 'CZ中' : String(m.games));
export const atSeatView = (v: AtMachineView, now: number): SlotSeat | undefined => {
  const until = seatUntil(v.seatAt, v.awayUntil ?? null);
  return v.seatBy && until && until.getTime() > now ? { memberId: v.seatBy, name: v.seatName ?? 'メンバー', avatar: v.seatAvatar ?? null, until, away: Boolean(v.awayUntil) } : undefined;
};
const seatTakenNow = (v: AtMachineView, me: string, now: number) => { const seat = atSeatView(v, now); return Boolean(seat && seat.memberId !== me); };

/** 差枚のグラフ（小さいもの） */
function MiniSlump(p: { values: number[]; label: string }) {
  const W = 160;
  const H = 44;
  const vals = p.values.length > 200 ? Array.from({ length: 200 }, (_, i) => p.values[Math.floor((i * p.values.length) / 200)]!) : p.values;
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i: number) => 2 + (vals.length <= 1 ? 0 : (i * (W - 4)) / (vals.length - 1));
  const y = (v: number) => 4 + ((hi - v) * (H - 8)) / span;
  const last = vals.at(-1) ?? 0;
  return (
    <svg class="c-slump mini" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.label}（いま ${signed(last)}）`}>
      <line class="c-slump-zero" x1={2} x2={W - 2} y1={y(0)} y2={y(0)} />
      {vals.length > 1 && <polyline class={`c-slump-line${last >= 0 ? ' up' : ' down'}`} points={vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />}
    </svg>
  );
}

/** 🦊 AT の島（台を選ぶ） */
/** 公開する前に運営が見ているとき */
function PreviewNote() {
  return (
    <p class="c-msg c-at-preview">
      🔒 準備中です（運営だけ入れます。メンバーにはまだ見えません）。打つと銭は本当に動きます。{' '}
      <a href="/casino/atslot/demo">🎬 演出を見る（銭は動きません）</a>
    </p>
  );
}

export function AtFloor(p: { me: GamePage['me']; casino: GamePage['casino']; data: FloorData; machines: AtMachineView[]; msg?: string; now: number; preview?: boolean }) {
  const uid = p.me.session.userId;
  return (
    <CasinoLayout title="鬼斬り白狐（AT 機）" me={p.me} back>
      <SlotIslands on="atslot" games={p.casino.games} atOpen={p.casino.atOpen} />
      <h1 class="c-h1">🦊 鬼斬り白狐の島（台を選ぶ）</h1>
      {p.preview && <PreviewNote />}
      {p.msg && <Msg msg={p.msg} />}
      <p class="c-muted">
        レア役で AT「白狐ラッシュ」を狙う台です。台の回転数・AT の残りは台に残るので、ハマっている台（天井 {AT_CEILING} G）を狙うのもあり。だれかが遊んでいる台は、{AT_SEAT_MINUTES} 分回さないと空きます。離席ボタンを押すと5分だけ確保します。1 ゲーム {p.me.coin.emoji}
        {fmt(p.casino.atBet)} {p.me.coin.name}。
      </p>
      <section class="c-floor c-at-floor">
        {p.machines.map((v, i) => {
          const d = p.data.today[i] ?? { games: 0, ats: 0, maxWon: 0, net: 0, slump: [], history: [] };
          const taken = seatTakenNow(v, uid, p.now);
          return (
            <a class={`c-floor-m c-at-m${v.state.phase === 'at' ? ' in-at' : ''}${taken ? ' taken' : ''}`} href={`/casino/atslot?m=${i + 1}`}>
              <span class="c-floor-top">
                <b class="c-floor-no">{i + 1}</b>
                <span class="c-floor-name">鬼斬り白狐</span>
                <span class="c-slot-floor-seat">{atSeatView(v, p.now) ? <><SlotPlayer player={atSeatView(v, p.now)!} me={uid} /><small>{v.awayUntil ? '離席中・5分確保' : '遊技中'}</small></> : <small>空き台</small>}</span>
              </span>
              <span class="c-floor-cells">
                <span>
                  <i>回転数</i>
                  <b class={v.state.phase === 'at' || v.state.phase === 'cz' ? 'c-at-on' : ''}>{counterText(v.state)}</b>
                </span>
                <span>
                  <i>AT</i>
                  <b class="hk-big">{d.ats}</b>
                </span>
                <span>
                  <i>総回転</i>
                  <b>{fmt(d.games)}</b>
                </span>
                <span>
                  <i>最大獲得</i>
                  <b>{d.maxWon > 0 ? fmt(d.maxWon) : '—'}</b>
                </span>
              </span>
              <MiniSlump values={d.slump} label={`${i + 1} 番台の今日の差枚`} />
              <span class="c-floor-odds">前日 AT {p.data.yesterday[i]?.ats ?? 0} 回・総回転 {fmt(p.data.yesterday[i]?.games ?? 0)}</span>
            </a>
          );
        })}
      </section>
    </CasinoLayout>
  );
}

const ROLE_TEXT: Record<string, string> = {
  oshijun: '🔔 ベル',
  bell: '🔔 共通ベル',
  replay: '🔁 リプレイ',
  wcherry: '🍒 弱チェリー',
  scherry: '🍒 強チェリー！',
  suika: '🍉 スイカ',
  chance: '✨ チャンス目！',
  byakko: '🦊 白狐目！！',
  none: '—',
};
const HINT_TEXT = ['', '…鬼の気配がする', '白狐が鳴いた！', '鬼が現れた…！'];

/** 演出の文字（止め終わってから順に出す） */
function eventText(e: AtEvent): { cls: string; big: string; small?: string; ev: AtEvent } {
  return { ...eventLine(e), ev: e };
}
function eventLine(e: AtEvent): { cls: string; big: string; small?: string } {
  if (e.k === 'cz_start') return { cls: 'cz', big: '鬼退治チャンス！', small: `${AT_CZ_GAMES} G 以内に鬼を退治せよ` };
  if (e.k === 'cz_end') return e.win ? { cls: 'win', big: '鬼退治 成功！！', small: 'AT へ' } : { cls: 'lose', big: '鬼に逃げられた…', small: 'チャンスゾーン 終了' };
  if (e.k === 'at_start') return { cls: 'start', big: '白狐ラッシュ突入！', small: `${e.tenjou ? '天井到達！ ' : ''}継続率 ${e.rate}%` };
  if (e.k === 'add') return { cls: 'add', big: `+${e.games} G`, small: '上乗せ！' };
  if (e.k === 'tokka_start') return { cls: 'tokka', big: '白狐乱舞', small: '上乗せ特化ゾーン突入！' };
  if (e.k === 'tokka_end') return { cls: 'tokka', big: '白狐乱舞 終了', small: 'AT に戻ります' };
  if (e.k === 'battle') return e.win ? { cls: 'win', big: '鬼を斬った！', small: `継続！ SET ${e.set + 1} へ` } : { cls: 'lose', big: '鬼に敗れた…', small: '白狐ラッシュ 終了' };
  if (e.k === 'at_end') return { cls: 'end', big: `獲得 ${fmt(e.won)}`, small: `${e.sets} セット・${e.games} G` };
  return { cls: 'end', big: '' };
}

/** 液晶に出すもの */
type LcdView = { at: boolean; tokka: number; set: number | null; left: number | null; rate: number | null; won: number | null; added?: number; games: number; hint: number; cz?: number | null };
const lcdOfMachine = (m: AtMachine): LcdView =>
  m.phase === 'cz'
    ? { at: false, tokka: 0, set: null, left: null, rate: null, won: null, games: m.games, hint: 0, cz: m.cz?.left ?? 0 }
    : m.phase === 'at' && m.at
    ? { at: true, tokka: m.at.tokka, set: m.at.set, left: m.at.left, rate: m.at.rate, won: m.at.won, added: m.at.added, games: m.games, hint: 0 }
    : { at: false, tokka: 0, set: null, left: null, rate: null, won: null, games: m.games, hint: 0 };
/** 回しているあいだ（このゲームのとき）。演出はレバーで出る */
const lcdOfGame = (s: AtGameState): LcdView =>
  s.during === 'cz'
    ? { at: false, tokka: 0, set: null, left: null, rate: null, won: null, games: s.games, hint: s.hint, cz: s.czLeft ?? 0 }
    : s.during === 'at' || s.during === 'tokka'
    ? s.pre
      ? { at: true, tokka: s.pre.tokka, set: s.pre.set, left: s.pre.left, rate: s.pre.rate, won: s.pre.won, games: s.games, hint: s.hint }
      : { at: true, tokka: s.during === 'tokka' ? Math.max(1, s.atTokka) : 0, set: s.atSet, left: s.atLeft, rate: s.atRate, won: s.atWon, games: s.games, hint: s.hint }
    : { at: false, tokka: 0, set: null, left: null, rate: null, won: null, games: s.games, hint: s.hint };

/** 液晶 */
function Lcd(p: { v: LcdView; phase: 'pre' | 'post' | 'only' }) {
  const v = p.v;
  const attrs = p.phase === 'pre' ? { 'data-before-stop': '' } : p.phase === 'post' ? { 'data-after-lcd': '', hidden: true } : {};
  if (v.at) {
    return (
      <div class={`c-at-lcd at${v.tokka > 0 ? ' tokka' : ''}`} {...attrs}>
        <span class="c-at-lcd-title">{v.tokka > 0 ? `🦊 白狐乱舞 残り ${v.tokka} G` : '🦊 白狐ラッシュ'}</span>
        <span class="c-at-lcd-row">
          <b>SET {v.set ?? '—'}</b>
          <b class="c-at-left">残り {v.left ?? 0} G</b>
          <b>継続率 {v.rate ?? '—'}%</b>
        </span>
        <span class="c-at-lcd-sub">
          AT 獲得 {fmt(v.won ?? 0)}
          {v.added !== undefined ? `・上乗せ ${v.added} G` : ''}
        </span>
      </div>
    );
  }
  if (v.cz !== undefined && v.cz !== null) {
    // 🔥 チャンスゾーン: 残りゲームを大きく
    return (
      <div class={`c-at-lcd cz${v.cz <= 1 ? ' last' : ''}`} {...attrs}>
        <span class="c-at-lcd-title">🔥 鬼退治チャンス</span>
        <span class="c-at-cz-left">
          {v.cz <= 1 ? (
            <b>ラストゲーム！</b>
          ) : (
            <>
              残り <b>{v.cz}</b> G
            </>
          )}
        </span>
        <span class="c-at-lcd-sub">レア役で成功を引き寄せろ！</span>
      </div>
    );
  }
  return (
    <div class={`c-at-lcd normal h${v.hint}`} {...attrs}>
      <span class="c-at-lcd-title">⛩ 白狐の社</span>
      <span class="c-at-lcd-row">
        <b>{v.games} G</b>
      </span>
      <span class={`c-at-lcd-hint h${v.hint}`}>{HINT_TEXT[v.hint] || 'レア役でチャンスゾーンを狙え'}</span>
    </div>
  );
}

/** 液晶の舞台（台の状態から。前兆の鬼の森は、そのゲームの演出が森だったときだけ残す） */
const stageOf = (m: AtMachine, last?: AtShow): AtStage =>
  m.phase === 'at' ? ((m.at?.tokka ?? 0) > 0 ? 'ranbu' : 'rush') : m.phase === 'cz' ? 'cz' : last?.stage === 'forest' ? 'forest' : 'shrine';

export function AtSlotPage(p: GamePage & { machine: number; view: AtMachineView; data: FloorData; now: number; art?: Record<string, string>; preview?: boolean; demo?: boolean }) {
  const csrf = p.me.session.csrfToken;
  const row: CasinoGameRow | undefined = p.row;
  const s = row ? (row.state as AtGameState) : undefined;
  const fresh = Boolean(row && p.now - (row.finishedAt ?? row.createdAt).getTime() < 60_000);
  const waiting = Boolean(row?.status === 'playing' && s?.waiting);
  const settled = Boolean(s && row?.status === 'done' && s.order && fresh);
  const mode: 'spin' | 'wait' | 'settle' | 'still' = waiting ? 'wait' : settled ? 'settle' : s && fresh && row?.status === 'done' && !s.order ? 'spin' : 'still';
  const stops = s?.stops ?? AT_IDLE_STOPS;
  const taken = seatTakenNow(p.view, p.me.session.userId, p.now);
  const d = p.data.today[p.machine - 1] ?? { games: 0, ats: 0, maxWon: 0, net: 0, slump: [], history: [] };
  const events = s && (mode === 'spin' || mode === 'settle') ? s.events.map(eventText) : [];
  const done = Boolean(s && row?.status === 'done');
  const me = mode === 'spin' || mode === 'settle' ? { ...p.me, revealFrom: p.me.balance - (row?.payout ?? 0), revealAt: 0, revealWait: true } : p.me;
  const bet = p.casino.atBet;
  const moving = mode === 'spin' || mode === 'wait' || mode === 'settle';
  const show = moving ? s?.show : undefined;
  const postStage = stageOf(p.view.state, s?.show);
  const preStage = moving && s?.show ? s.show.stage : postStage;
  // 台の光り方（AT 中・特化中）は、止め終わるまで回す前のまま（先に光って当たりが分からないように）
  const atPre = moving && s ? s.during === 'at' || s.during === 'tokka' : p.view.state.phase === 'at';
  const tokkaPre = moving && s ? s.during === 'tokka' : (p.view.state.at?.tokka ?? 0) > 0;
  const atPost = p.view.state.phase === 'at';
  const tokkaPost = (p.view.state.at?.tokka ?? 0) > 0;
  // そろったライン（止め終わってから光らせる。止まったまま見せるときははじめから）
  const winLine = done && s ? atWinLine(stops) : -1;
  const lineLit = (l: number) => mode === 'still' && winLine === l;
  // 液晶の下の数字（BET・GAME・PAYOUT）。PAYOUT は止め終わってから出す
  const payout = done && row ? row.payout : 0;
  // 前兆の鬼の近さは、止まったあとも残す（AT に入ったら消える）
  const oni = p.view.state.phase === 'at' ? 0 : (s?.show?.oni ?? 0);
  return (
    <CasinoLayout title="鬼斬り白狐（AT 機）" me={me} back>
      <SlotIslands on="atslot" games={p.casino.games} atOpen={p.casino.atOpen} />
      <h1 class="c-h1">{p.demo ? '🎬 鬼斬り白狐の演出を見る' : `🦊 鬼斬り白狐・${p.machine} 番台`}</h1>
      {p.preview && <PreviewNote />}
      {p.demo && (
        <p class="c-muted">
          下のボタンで演出を試せます（銭は動きません）。「レバーから」のものは STOP を押して止めてください。社務所Web で入れた絵がそのまま出ます。{' '}
          <a href="/casino/atslot">台の島へ</a>
        </p>
      )}
      {p.msg && <Msg msg={p.msg} />}
      {!p.demo && <SlotSeatControls seat={atSeatView(p.view, p.now)} me={p.me.session.userId} csrf={csrf} machine={p.machine} game="atslot" busy={row?.status === 'playing'} />}
      <section class="c-slot-stage">
        {!p.demo && <section class="c-counter c-at-counter" aria-label={`${p.machine} 番台のデータ`}>
          <div class="c-counter-head">
            <b class="c-counter-no">
              {p.machine}
              <small>番台</small>
            </b>
            <span class="c-counter-title">DATA</span>
            <form method="post" action="/casino/atslot/leave" class="c-inline">
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="m" value={String(p.machine)} />
              <button type="submit" class="c-btn c-btn-small c-btn-ghost">
                台を移る
              </button>
            </form>
          </div>
          <div class="c-counter-cells">
            <span class="cc">
              <i>回転数</i>
              <b>{counterText(p.view.state)}</b>
            </span>
            <span class="cc cc-big">
              <i>AT</i>
              <b>{d.ats}</b>
            </span>
            <span class="cc">
              <i>総回転</i>
              <b>{fmt(d.games)}</b>
            </span>
            <span class="cc">
              <i>最大獲得</i>
              <b>{d.maxWon > 0 ? fmt(d.maxWon) : '—'}</b>
            </span>
          </div>
          {d.history.length > 0 && (
            <details class="c-counter-more">
              <summary>📜 AT の履歴（今日）</summary>
              <table class="c-counter-hist">
                <thead>
                  <tr>
                    <th>回</th>
                    <th>何 G で</th>
                    <th>セット</th>
                    <th>獲得</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.history].reverse().slice(0, 10).map((h, k) => (
                    <tr>
                      <td>{d.history.length - k}</td>
                      <td>
                        {h.gap} G{h.tenjou ? '（天井）' : ''}
                      </td>
                      <td>{h.sets}</td>
                      <td>{fmt(h.won)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>}
        <div class="c-cab c-at-cab">
          <div
            class={`c-atm mode-${mode}${atPre ? ' in-at' : ''}${tokkaPre ? ' in-tokka' : ''}`}
            data-at-post={atPost ? '1' : '0'}
            data-tokka-post={tokkaPost ? '1' : '0'}
            data-mode={mode}
            data-stops={stops.join(',')}
            data-from={mode === 'settle' && s?.from ? s.from.join(',') : undefined}
            data-n={String(AT_REEL_LEN)}
            data-navi={waiting && s?.navi ? s.navi.join(',') : undefined}
            data-win={done ? String(s!.mult) : ''}
            data-events={events.length ? JSON.stringify(events) : undefined}
            data-hint={String(s?.hint ?? 0)}
            data-taken={taken ? '1' : undefined}
            data-show={show ? JSON.stringify(show) : undefined}
            data-stage-pre={preStage}
            data-stage-post={postStage}
            data-oni-pre={String(moving ? (s?.show?.oni ?? 0) : oni)}
            data-oni={String(oni)}
            data-at-left={String(p.view.state.at?.left ?? '')}
            data-art={JSON.stringify(p.art ?? {})}
            data-stage-js={assetUrl('atslot.js')}
            data-demo={p.demo ? '1' : undefined}
            data-unit={String(Math.max(1, Math.round(bet / 3)))}
            data-paylines={AT_PAYLINES.map((l) => l.rows.join(',')).join('|')}
            data-winline={winLine >= 0 ? String(winLine) : undefined}
          >
            <i class="c-at-led l" aria-hidden="true"></i>
            <i class="c-at-led r" aria-hidden="true"></i>
            <i class="c-at-shine" aria-hidden="true"></i>
            <div class="c-at-top">
              <i class="c-at-lamp" aria-hidden="true"></i>
              {p.art?.['logo-title'] ? (
                <img class="c-at-title-img" src={p.art['logo-title']} alt="鬼斬り白狐" />
              ) : (
                <span class="c-at-title">
                  <b>鬼斬り</b>
                  <span>白狐</span>
                </span>
              )}
            </div>
            <div class="c-at-gimmick" data-gimmick aria-hidden="true">
              {p.art?.['cab-gimmick'] ? <img src={p.art['cab-gimmick']} alt="" draggable="false" /> : <FoxMask />}
            </div>
            <div class={`c-at-screen stage-${preStage}`} data-screen>
              <div class="c-at-scene" aria-hidden="true" data-scene></div>
              {s && mode !== 'still' ? (
                <>
                  <Lcd v={lcdOfGame(s)} phase="pre" />
                  <Lcd v={lcdOfMachine(p.view.state)} phase="post" />
                </>
              ) : (
                <Lcd v={lcdOfMachine(p.view.state)} phase="only" />
              )}
              <div class="c-at-fx" aria-live="polite"></div>
            </div>
            <div class="c-at-bezel">
            <div
              class="c-jug-window c-at-window"
              role="img"
              aria-label={['上段', '中段', '下段'].map((row, k) => `${row}: ${atGrid(stops).map((c) => AT_SYMBOLS[c[k]!].name).join('・')}`).join(' / ')}
            >
              {AT_REELS.map((strip, i) => {
                const at = mode === 'spin' || mode === 'wait' ? (stops[i]! + 6 + i * 5) % AT_REEL_LEN : stops[i]!;
                return (
                  <div class={`c-jreel r${i}${mode === 'still' && winLine >= 0 ? ` hit-${AT_PAYLINES[winLine]!.rows[i]}` : ''}`} data-reel={String(i)} data-at={String(at)}>
                    <div class={`c-jstrip at-${at}`} aria-hidden="true">
                      {[...strip, ...strip, ...strip].map((k) => (
                        <Sym k={k} art={p.art} />
                      ))}
                    </div>
                  </div>
                );
              })}
              <span class="c-linelamps l" aria-hidden="true">
                {[3, 0, 1, 2, 4].map((l) => (
                  <i class={`ln${lineLit(l) ? ' on' : ''}`} data-line={String(l)}></i>
                ))}
              </span>
              <span class="c-linelamps r" aria-hidden="true">
                {[4, 0, 1, 2, 3].map((l) => (
                  <i class={`ln${lineLit(l) ? ' on' : ''}`} data-line={String(l)}></i>
                ))}
              </span>
              <span class="c-winline" aria-hidden="true"></span>
            </div>
            </div>
            <div class="c-at-seg" aria-hidden="true">
              <span>
                <i>CREDIT</i>
                <b data-credit={String(p.me.balance)} data-credit-from={moving ? String(p.me.balance - payout) : undefined}>
                  {fmt(moving ? p.me.balance - payout : p.me.balance)}
                </b>
              </span>
              <span>
                <i>GAME</i>
                <b>{s && moving ? s.games : p.view.state.games}</b>
              </span>
              <span>
                <i>PAYOUT</i>
                <b data-payout={moving ? String(payout) : undefined}>{moving ? 0 : payout}</b>
              </span>
            </div>
            <div class="c-at-deck">
              {p.demo ? (
                <span class="c-lever-form">
                  <span class="c-lever" aria-hidden="true">
                    <span class="c-lever-knob"></span>
                  </span>
                </span>
              ) : (
                <form method="post" action="/casino/atslot" class="c-lever-form">
                  <input type="hidden" name="_csrf" value={csrf} />
                  <input type="hidden" name="m" value={String(p.machine)} />
                  <button type="submit" class={`c-lever${mode === 'spin' || mode === 'wait' ? ' pulled' : ''}`} data-at-lever disabled={mode !== 'still' || taken} aria-label={`レバー（${fmt(bet)} ${p.me.coin.name}で回す）`}>
                    <span class="c-lever-knob"></span>
                  </button>
                </form>
              )}
              <MaxBet lit={mode !== 'still'} />
              <span class="c-stops c-at-stops">
                {[0, 1, 2].map((i) => (
                  <span class="c-at-stopwrap">
                    <i class="c-at-navi" data-navi-mark={String(i)}>
                      {waiting && s?.navi ? NAVI_MARK[s.navi.indexOf(i)] : ''}
                    </i>
                    <button type="button" class="c-stop" data-at-stop={String(i)} disabled={mode !== 'spin' && mode !== 'wait'} aria-label={`${['左', '中', '右'][i]}のリールを止める`}>
                      STOP
                    </button>
                  </span>
                ))}
              </span>
            </div>
            <p class="c-deck-note" data-still={taken ? undefined : p.demo ? '下のボタンで演出を選ぶ' : `レバー（スペース）で ${fmt(bet)} ${p.me.coin.name}を賭けて回す`}>
              {p.demo
                ? '下のボタンで演出を選ぶ'
                : taken
                ? `${p.view.seatName ?? 'ほかの人'}の利用中です。離席中の台も期限までは回せません。`
                : mode === 'wait'
                  ? 'ナビの順に STOP（1・2・3 キーでも）'
                  : mode === 'spin'
                    ? 'STOP（スペースで左から・1・2・3 キー）'
                    : `レバー（スペース）で ${fmt(bet)} ${p.me.coin.name}を賭けて回す`}
            </p>
            <div class={`c-at-panel${p.art?.['cab-panel'] ? ' art' : ''}`} aria-hidden="true">
              {p.art?.['cab-panel'] ? (
                <img src={p.art['cab-panel']} alt="" draggable="false" />
              ) : (
                <>
                  <FoxMask />
                  <span class="c-at-panel-name">
                    <b>鬼斬り</b>
                    <span>白狐</span>
                    <small>BYAKKO RUSH</small>
                  </span>
                  <FoxMask />
                </>
              )}
            </div>
            <MedalTray name="鬼 斬 り 白 狐" class="c-at-tray" />
          </div>
          <div class="c-cab-base" aria-hidden="true"></div>
        </div>
        {waiting && (
          <form method="post" action={`/casino/atslot/${row!.id}`} class="c-at-order" data-at-order>
            <input type="hidden" name="_csrf" value={csrf} />
            <input type="hidden" name="v" value={String(row!.version)} />
            <input type="hidden" name="order" value="" data-at-order-input />
            <p class="c-muted">
              押し順ナビ: <b>{s!.navi!.map((r) => ['左', '中', '右'][r]).join(' → ')}</b> の順に止めるとベル（×{AT_ROLES.oshijun.mult}）。
            </p>
            <button type="submit" name="assist" value="1" class="c-btn c-btn-ghost c-btn-small">
              ナビどおりに止める（おまかせ）
            </button>
          </form>
        )}
        {done && (
          <div class={mode === 'still' ? '' : 'c-later wait'} data-after-stop={mode === 'still' ? undefined : ''}>
            <p class={`c-result ${row!.payout > row!.bet ? 'win' : row!.payout === row!.bet ? 'even' : 'lose'}`}>
              {s!.role === 'oshijun' ? (s!.mult > 0 ? '🔔 ベル' : s!.navi ? 'ナビとちがう順… こぼし' : 'こぼし') : ROLE_TEXT[s!.role]}
              {s!.mult > 0 ? ` ×${s!.mult}` : ''}・{signed(row!.payout - row!.bet)} {p.me.coin.name}
            </p>
          </div>
        )}
      </section>
      {p.demo && <AtDemoPanel />}
      {!p.demo && <Rules>
        1 ゲーム {fmt(bet)} {p.me.coin.name}（島で決まっています）。ラインは 5 本（上段・中段・下段・右下がり・右上がり）。通常時はレア役（チェリー・スイカ・チャンス目・白狐目）でチャンスゾーン「鬼退治チャンス」（{AT_CZ_GAMES} G。液晶に残りゲーム）を抽選。最後のゲームで鬼を退治できれば AT「白狐ラッシュ」突入、CZ 中のレア役で成功しやすくなります。強チェリー・チャンス目は AT 直撃も、白狐目は AT 確定。{AT_CEILING} G ハマると天井で AT（継続率 66% 以上）。AT のあとは
        {AT_HEAVEN_CEILING} G 以内に当たる天国モードのことも。AT は 1 セット {AT_SET_GAMES} G。押し順ベル（ナビの順に止めると ×{AT_ROLES.oshijun.mult}）で増やし、レア役で上乗せ、チャンス目で特化ゾーン「白狐乱舞」。セットの終わりに鬼との継続バトル（継続率{' '}
        {AT_RATES.map((r) => `${r.rate}%`).join('・')}）。通常時の押し順ベルは押し順が分からないので、そろうのは 6 回に 1 回くらい。台ごとに設定（1〜6）があり、高いほど AT に当たりやすい（払い戻し率は設定 1 で約 95%）。台の回転数・AT の残りは台に残るので、席を立つと次の人が続きを打てます。
      </Rules>}
    </CasinoLayout>
  );
}

// ───────── 🎬 演出を見る（銭は動かない） ─────────

type DemoPreset = { label: string; d: Record<string, unknown> };
const ev = (e: AtEvent) => ({ ev: e });
const DEMO_GROUPS: { title: string; items: DemoPreset[] }[] = [
  {
    title: '通常時・前兆（レバーから。STOP を押して止める）',
    items: [
      { label: 'キュイン（弱い）', d: { spin: true, stage: 'shrine', show: { lever: 'kyuin', stop3: 'blue' } } },
      { label: '台が揺れる・赤 STOP', d: { spin: true, stage: 'shrine', show: { lever: 'shake', stop3: 'red' } } },
      { label: '鬼の森・暗転・金 STOP・溜め', d: { spin: true, stage: 'forest', oni: 2, show: { lever: 'blackout', stop3: 'gold', hold: true } } },
      { label: '虹（確定）・確定音', d: { spin: true, stage: 'shrine', show: { lever: 'rainbow', stop3: 'rainbow', kakutei: true } } },
      { label: 'フリーズ', d: { spin: true, stage: 'shrine', show: { freeze: true } } },
      { label: '🔥 チャンスゾーン突入（強チェリー）', d: { spin: true, stage: 'shrine', post: 'cz', show: { lever: 'shake', stop3: 'gold', hold: true }, list: [ev({ k: 'cz_start', why: 'scherry' })] } },
      { label: '🔥 CZ 成功 → AT 突入', d: { spin: true, stage: 'cz', oni: 3, post: 'rush', show: { lever: 'blackout', stop3: 'rainbow', hold: true, kakutei: true }, list: [ev({ k: 'cz_end', win: true }), ev({ k: 'at_start', rate: 66, tenjou: false })] } },
      { label: '🔥 CZ 失敗', d: { spin: true, stage: 'cz', oni: 3, post: 'shrine', show: { lever: 'flash', stop3: 'red', hold: true }, list: [ev({ k: 'cz_end', win: false })] } },
      { label: '前兆の最後 → AT 突入', d: { spin: true, stage: 'forest', oni: 3, post: 'rush', show: { lever: 'shake', stop3: 'gold', hold: true }, list: [ev({ k: 'at_start', rate: 80, tenjou: false })] } },
    ],
  },
  {
    title: 'AT 中',
    items: [
      { label: '押し順ナビ', d: { stage: 'rush', navi: [2, 0, 1] } },
      { label: '上乗せ +10G', d: { stage: 'rush', list: [ev({ k: 'add', games: 10, why: 'scherry' })] } },
      { label: '白狐目 +100G（フリーズから）', d: { spin: true, stage: 'rush', show: { freeze: true }, list: [ev({ k: 'add', games: 100, why: 'byakko' })] } },
      { label: '特化ゾーン「白狐乱舞」', d: { stage: 'rush', post: 'ranbu', list: [ev({ k: 'tokka_start' })] } },
      { label: '乱舞の上乗せ → 終了', d: { stage: 'ranbu', post: 'rush', list: [ev({ k: 'add', games: 20, why: 'none' }), ev({ k: 'tokka_end', added: 20 })] } },
      {
        label: '継続バトル（勝ち）',
        d: { stage: 'rush', list: [ev({ k: 'battle', win: true, set: 2 })], show: { battle: [{ who: 'oni', hit: true }, { who: 'byakko', hit: false }, { who: 'oni', hit: false }, { who: 'byakko', hit: true }] } },
      },
      {
        label: '継続バトル（負け）→ AT 終了',
        d: { stage: 'rush', post: 'shrine', list: [ev({ k: 'battle', win: false, set: 3 }), ev({ k: 'at_end', games: 135, won: 2450, sets: 3 })], show: { battle: [{ who: 'byakko', hit: true }, { who: 'oni', hit: true }, { who: 'oni', hit: true }] } },
      },
    ],
  },
];

function AtDemoPanel() {
  return (
    <section class="c-at-demo" aria-label="演出を選ぶ">
      {DEMO_GROUPS.map((g) => (
        <div class="c-at-demo-group">
          <h2>{g.title}</h2>
          <div class="c-at-demo-btns">
            {g.items.map((it) => (
              <button type="button" class="c-btn c-btn-small" data-at-demo={JSON.stringify(it.d)}>
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** 演出を見る画面（AT 中の台のふりをした 1 台） */
export function AtDemoPage(p: { me: GamePage['me']; casino: GamePage['casino']; art: Record<string, string> }) {
  const state: AtMachine = { games: 0, heaven: false, phase: 'at', zenchou: 0, nextRate: 80, tenjou: false, at: { left: 12, set: 2, rate: 80, tokka: 0, games: 50, added: 15, won: 1200 } };
  const view: AtMachineView = { machine: 1, state, seatBy: null, seatAt: null, seatName: null };
  const data = { today: [], yesterday: [] };
  return <AtSlotPage me={p.me} casino={p.casino} machine={1} view={view} data={data} now={Date.now()} art={p.art} demo />;
}
