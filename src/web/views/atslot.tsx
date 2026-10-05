import type { CasinoGameRow } from '../../db/schema.js';
import { AT_CEILING, AT_HEAVEN_CEILING, AT_IDLE_STOPS, AT_RATES, AT_REEL_LEN, AT_REELS, AT_ROLES, AT_SET_GAMES, AT_SYMBOLS, atGrid, type AtEvent, type AtMachine, type AtSym } from '../../services/casino/slotAt.js';
import { AT_SEAT_MINUTES, type AtDay, type AtGameState } from '../../services/casino/slotAtPlay.js';
import { slotArt } from '../assets.js';
import { CasinoLayout, Msg, Rules, type GamePage } from './casino.js';

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

function Sym(p: { k: AtSym }) {
  const src = slotArt(`at-${p.k}`);
  if (src) return <img class={`sy sy-at-${p.k}`} src={src} alt="" draggable="false" />;
  // BAR は文字で（絵文字だと細い線になる）
  if (p.k === 'bar') return <span class="sy sy-at-bar">
    <b>BAR</b>
  </span>;
  return <span class={`sy sy-at-${p.k}`}>{AT_SYMBOLS[p.k].emoji}</span>;
}

export type AtMachineView = { machine: number; state: AtMachine; seatBy: string | null; seatAt: Date | null; seatName: string | null };
type FloorData = { today: AtDay[]; yesterday: AtDay[] };

/** 台の上の数字: 通常時はいまの回転数、AT 中は「AT 中」 */
const counterText = (m: AtMachine) => (m.phase === 'at' ? 'AT中' : String(m.games));
const seatTakenNow = (v: AtMachineView, me: string, now: number) => Boolean(v.seatBy && v.seatBy !== me && v.seatAt && now - v.seatAt.getTime() < AT_SEAT_MINUTES * 60_000);

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
export function AtFloor(p: { me: GamePage['me']; casino: GamePage['casino']; data: FloorData; machines: AtMachineView[]; msg?: string; now: number }) {
  const uid = p.me.session.userId;
  return (
    <CasinoLayout title="鬼斬り白狐（AT 機）" me={p.me} back>
      <SlotIslands on="atslot" games={p.casino.games} atOpen={p.casino.atOpen} />
      <h1 class="c-h1">🦊 鬼斬り白狐の島（台を選ぶ）</h1>
      {p.msg && <Msg msg={p.msg} />}
      <p class="c-muted">
        レア役で AT「白狐ラッシュ」を狙う台です。台の回転数・AT の残りは台に残るので、ハマっている台（天井 {AT_CEILING} G）を狙うのもあり。だれかが遊んでいる台は、{AT_SEAT_MINUTES} 分回さないと空きます。1 ゲーム {p.me.coin.emoji}
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
                {taken && <span class="c-at-taken">遊技中{v.seatName ? `: ${v.seatName}` : ''}</span>}
              </span>
              <span class="c-floor-cells">
                <span>
                  <i>回転数</i>
                  <b class={v.state.phase === 'at' ? 'c-at-on' : ''}>{counterText(v.state)}</b>
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
function eventText(e: AtEvent): { cls: string; big: string; small?: string } {
  if (e.k === 'at_start') return { cls: 'start', big: '白狐ラッシュ突入！', small: `${e.tenjou ? '天井到達！ ' : ''}継続率 ${e.rate}%` };
  if (e.k === 'add') return { cls: 'add', big: `+${e.games} G`, small: '上乗せ！' };
  if (e.k === 'tokka_start') return { cls: 'tokka', big: '白狐乱舞', small: '上乗せ特化ゾーン突入！' };
  if (e.k === 'tokka_end') return { cls: 'tokka', big: '白狐乱舞 終了', small: 'AT に戻ります' };
  if (e.k === 'battle') return e.win ? { cls: 'win', big: '鬼を斬った！', small: `継続！ SET ${e.set + 1} へ` } : { cls: 'lose', big: '鬼に敗れた…', small: '白狐ラッシュ 終了' };
  return { cls: 'end', big: `獲得 ${fmt(e.won)}`, small: `${e.sets} セット・${e.games} G` };
}

/** 液晶に出すもの */
type LcdView = { at: boolean; tokka: number; set: number | null; left: number | null; rate: number | null; won: number | null; added?: number; games: number; hint: number };
const lcdOfMachine = (m: AtMachine): LcdView =>
  m.phase === 'at' && m.at
    ? { at: true, tokka: m.at.tokka, set: m.at.set, left: m.at.left, rate: m.at.rate, won: m.at.won, added: m.at.added, games: m.games, hint: 0 }
    : { at: false, tokka: 0, set: null, left: null, rate: null, won: null, games: m.games, hint: 0 };
/** 回しているあいだ（このゲームのとき）。演出はレバーで出る */
const lcdOfGame = (s: AtGameState): LcdView =>
  s.during === 'at' || s.during === 'tokka'
    ? { at: true, tokka: s.during === 'tokka' ? Math.max(1, s.atTokka) : 0, set: s.atSet, left: s.atLeft, rate: s.atRate, won: s.atWon, games: s.games, hint: s.hint }
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
  return (
    <div class={`c-at-lcd normal h${v.hint}`} {...attrs}>
      <span class="c-at-lcd-title">⛩ 白狐の社</span>
      <span class="c-at-lcd-row">
        <b>{v.games} G</b>
      </span>
      <span class={`c-at-lcd-hint h${v.hint}`}>{HINT_TEXT[v.hint] || 'レア役で AT を狙え'}</span>
    </div>
  );
}

export function AtSlotPage(p: GamePage & { machine: number; view: AtMachineView; data: FloorData; now: number }) {
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
  return (
    <CasinoLayout title="鬼斬り白狐（AT 機）" me={me} back>
      <SlotIslands on="atslot" games={p.casino.games} atOpen={p.casino.atOpen} />
      <h1 class="c-h1">🦊 鬼斬り白狐・{p.machine} 番台</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-slot-stage">
        <section class="c-counter c-at-counter" aria-label={`${p.machine} 番台のデータ`}>
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
        </section>
        <div class="c-cab c-at-cab">
          <div
            class={`c-atm mode-${mode}${p.view.state.phase === 'at' ? ' in-at' : ''}${(p.view.state.at?.tokka ?? 0) > 0 ? ' in-tokka' : ''}`}
            data-mode={mode}
            data-stops={stops.join(',')}
            data-from={mode === 'settle' && s?.from ? s.from.join(',') : undefined}
            data-n={String(AT_REEL_LEN)}
            data-navi={waiting && s?.navi ? s.navi.join(',') : undefined}
            data-win={done ? String(s!.mult) : ''}
            data-events={events.length ? JSON.stringify(events) : undefined}
            data-hint={String(s?.hint ?? 0)}
            data-taken={taken ? '1' : undefined}
          >
            <div class="c-at-top">
              <span class="c-at-title">
                <b>鬼斬り</b>
                <span>白狐</span>
              </span>
            </div>
            {s && mode !== 'still' ? (
              <>
                <Lcd v={lcdOfGame(s)} phase="pre" />
                <Lcd v={lcdOfMachine(p.view.state)} phase="post" />
              </>
            ) : (
              <Lcd v={lcdOfMachine(p.view.state)} phase="only" />
            )}
            <div class="c-jug-window c-at-window" role="img" aria-label={`中段: ${atGrid(stops).map((c) => AT_SYMBOLS[c[1]!].name).join('・')}`}>
              {AT_REELS.map((strip, i) => {
                const at = mode === 'spin' || mode === 'wait' ? (stops[i]! + 6 + i * 5) % AT_REEL_LEN : stops[i]!;
                return (
                  <div class={`c-jreel r${i}`} data-reel={String(i)} data-at={String(at)}>
                    <div class={`c-jstrip at-${at}`} aria-hidden="true">
                      {[...strip, ...strip, ...strip].map((k) => (
                        <Sym k={k} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <div class="c-at-fx" aria-live="polite"></div>
            <div class="c-at-deck">
              <form method="post" action="/casino/atslot" class="c-lever-form">
                <input type="hidden" name="_csrf" value={csrf} />
                <input type="hidden" name="m" value={String(p.machine)} />
                <button type="submit" class={`c-lever${mode === 'spin' || mode === 'wait' ? ' pulled' : ''}`} data-at-lever disabled={mode !== 'still' || taken} aria-label={`レバー（${fmt(bet)} ${p.me.coin.name}で回す）`}>
                  <span class="c-lever-knob"></span>
                </button>
              </form>
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
            <p class="c-deck-note" data-still={taken ? undefined : `レバー（スペース）で ${fmt(bet)} ${p.me.coin.name}を賭けて回す`}>
              {taken
                ? `${p.view.seatName ?? 'ほかの人'}が遊んでいます（${AT_SEAT_MINUTES} 分回さないと空きます）`
                : mode === 'wait'
                  ? 'ナビの順に STOP（1・2・3 キーでも）'
                  : mode === 'spin'
                    ? 'STOP（スペースで左から・1・2・3 キー）'
                    : `レバー（スペース）で ${fmt(bet)} ${p.me.coin.name}を賭けて回す`}
            </p>
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
      <Rules>
        1 ゲーム {fmt(bet)} {p.me.coin.name}（島で決まっています）。通常時はレア役（チェリー・スイカ・チャンス目・白狐目）で AT「白狐ラッシュ」を抽選し、当たると前兆のあと突入します。{AT_CEILING} G ハマると天井で AT（継続率 66% 以上）。AT のあとは
        {AT_HEAVEN_CEILING} G 以内に当たる天国モードのことも。AT は 1 セット {AT_SET_GAMES} G。押し順ベル（ナビの順に止めると ×{AT_ROLES.oshijun.mult}）で増やし、レア役で上乗せ、チャンス目で特化ゾーン「白狐乱舞」。セットの終わりに鬼との継続バトル（継続率{' '}
        {AT_RATES.map((r) => `${r.rate}%`).join('・')}）。通常時の押し順ベルは押し順が分からないので、そろうのは 6 回に 1 回くらい。台ごとに設定（1〜6）があり、高いほど AT に当たりやすい（払い戻し率は設定 1 で約 95%）。台の回転数・AT の残りは台に残るので、席を立つと次の人が続きを打てます。
      </Rules>
    </CasinoLayout>
  );
}
