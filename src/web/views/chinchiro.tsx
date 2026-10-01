import type { ChinchiroState } from '../../services/casino/casino.js';
import { CHIN_MAX_LOSS, handName, turnDone, turnHand, type ChinRoll } from '../../services/casino/chinchiro.js';
import { BetForm, CasinoLayout, dly, freshDone, Later, Msg, Result, revealMe, Rules, type GamePage } from './casino.js';

/**
 * 🎲 ちんちろりん。サイコロ（目の点は CSS）と、どんぶりの中で振った目を順に見せる。
 * 1 人のとき（CPU の親と勝負）の画面と、卓（casinoTables.tsx）で使う部品
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const PIPS: Record<number, string[]> = { 1: ['c'], 2: ['tl', 'br'], 3: ['tl', 'c', 'br'], 4: ['tl', 'tr', 'bl', 'br'], 5: ['tl', 'tr', 'c', 'bl', 'br'], 6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'] };
/** 1 回振るのにかける時間（0.2 秒きざみ） */
export const ROLL_STEP = 6;

export function Die(p: { n: number }) {
  return (
    <span class={`c-die f-${p.n}`} role="img" aria-label={String(p.n)}>
      {(PIPS[p.n] ?? []).map((x) => (
        <i class={`p ${x}`}></i>
      ))}
    </span>
  );
}

/** 1 回振った目（d: 遅れ。still: 前から出ているので動かさない。ck: 卓で前からある目を見分ける印） */
export function RollRow(p: { r: ChinRoll; k: number; d?: number; still?: boolean; ck?: string }) {
  return (
    <div class={`c-roll ${dly(p.d ?? 0)}${p.still ? ' still' : ''}${p.r.hand ? ` got h-${p.r.hand.kind}` : ''}`} data-ck={p.ck}>
      <span class="c-roll-no">{p.k + 1}</span>
      <span class="c-dice">
        {p.r.dice.map((n) => (
          <Die n={n} />
        ))}
      </span>
      <span class="c-roll-hand">{p.r.hand ? handName(p.r.hand) : 'なし'}</span>
    </div>
  );
}

/** どんぶり（だれかの番の目を全部。d: 最初の目の遅れ） */
export function Bowl(p: { who: string; rolls: ChinRoll[]; d?: number; still?: boolean; ck?: string; active?: boolean }) {
  const done = turnDone(p.rolls);
  const end = (p.d ?? 0) + Math.max(0, p.rolls.length - 1) * ROLL_STEP + 4;
  return (
    <div class={`c-bowl-wrap${p.active ? ' active' : ''}`}>
      <div class="c-bowl-who">
        {p.who}
        {done && (
          <Later d={p.still ? 0 : end} class="c-inline-later">
            <b class={`c-bowl-hand h-${turnHand(p.rolls).kind}`}>{handName(turnHand(p.rolls))}</b>
          </Later>
        )}
      </div>
      <div class="c-bowl">
        {p.rolls.length === 0 ? (
          <p class="c-muted c-center c-bowl-empty">まだ振っていません</p>
        ) : (
          p.rolls.map((r, k) => <RollRow r={r} k={k} d={(p.d ?? 0) + k * ROLL_STEP} still={p.still} ck={p.ck ? `${p.ck}:${k}` : undefined} />)
        )}
      </div>
    </div>
  );
}

/** 役と倍率の表 */
export function ChinGuide() {
  return (
    <ul class="c-chin-guide">
      <li>
        <b>ピンゾロ</b>（1・1・1）<span>5 倍</span>
      </li>
      <li>
        <b>ゾロ目</b>（2〜6 がそろう）<span>3 倍</span>
      </li>
      <li>
        <b>シゴロ</b>（4・5・6）<span>2 倍</span>
      </li>
      <li>
        <b>目</b>（2 つそろった残り。6 が強い）<span>1 倍</span>
      </li>
      <li>
        <b>目なし</b>（3 回振っても出ない）<span>1 倍負け</span>
      </li>
      <li>
        <b>ヒフミ</b>（1・2・3）<span>2 倍負け</span>
      </li>
    </ul>
  );
}

const resultText = (mult: number) => (mult > 0 ? `勝ち ×${mult}` : mult < 0 ? `負け ×${-mult}` : '引き分け');

export function ChinchiroPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const s = p.row?.state as ChinchiroState | undefined;
  const fresh = freshDone(p.row);
  const childAt = s ? (s.parent.length - 1) * ROLL_STEP + 8 : 0;
  const at = !s ? 0 : s.child ? childAt + (s.child.length - 1) * ROLL_STEP + 6 : childAt;
  const me = s ? revealMe(p.me, p.row, fresh ? at : 0) : p.me;
  return (
    <CasinoLayout title="ちんちろりん" me={me} back>
      <h1 class="c-h1">🎲 ちんちろりん</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-table c-chin">
        {s ? (
          <>
            <Bowl who="👺 親（胴元）" rolls={s.parent} d={0} still={!fresh} />
            {s.child ? (
              <Bowl who="🙂 あなた（子）" rolls={s.child} d={childAt} still={!fresh} />
            ) : (
              <Later d={fresh ? childAt : 0}>
                <p class="c-center c-chin-decided">親が {handName(turnHand(s.parent))} なので、子は振らずに決まりました</p>
              </Later>
            )}
            <Later d={fresh ? at : 0} class={s.mult >= 2 ? ' c-fx-burst' : s.mult <= -2 ? ' c-fx-shake' : ''}>
              <Result bet={p.row!.bet} payout={p.row!.payout} coin={p.me.coin} text={`${resultText(s.mult)}（賭け ${fmt(s.base)}）`} />
            </Later>
          </>
        ) : (
          <>
            <div class="c-bowl c-bowl-idle" aria-hidden="true">
              <span class="c-dice">
                <Die n={4} />
                <Die n={5} />
                <Die n={6} />
              </span>
            </div>
            <p class="c-muted c-center">親（胴元）とサイコロ 3 つで勝負。強い役を出したほうが勝ちです。</p>
          </>
        )}
      </section>
      <Later d={fresh && s ? at : 0}>
        <BetForm action="/casino/chinchiro" csrf={csrf} casino={p.casino} coin={p.me.coin} label="勝負する" last={s?.base} />
        <p class="c-muted c-center c-chin-note">負けると最大で賭けの {CHIN_MAX_LOSS} 倍になるので、賭けの {CHIN_MAX_LOSS} 倍の銭が要ります。</p>
      </Later>
      <Rules>
        <ChinGuide />
        <p>
          1 回の番で 3 回まで振れます（役か目が出たらそこまで）。親が先に振り、親がピンゾロ・ゾロ目・シゴロなら子の負け（その倍）、ヒフミなら子の 2 倍勝ち、目なしなら子の勝ち。親が目のときは子が振って比べます（同じ目は引き分け）。子の役の倍率で勝ち、ヒフミは 2 倍・目なしは 1 倍負けです。
        </p>
      </Rules>
    </CasinoLayout>
  );
}
