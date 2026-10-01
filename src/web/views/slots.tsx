import type { SlotsSpin, SlotsState } from '../../services/casino/casino.js';
import { gridOf, isBonus, judge, PAYLINES, REEL_LEN, REELS, SLIP, SLOT_ROLES, SLOT_SYMBOLS, type SlotKey, type SlotRole } from '../../services/casino/slots.js';
import { slotArt } from '../assets.js';
import { BetForm, CasinoLayout, freshDone, Msg, Result, revealMe, Rules, type GamePage } from './casino.js';

/**
 * 🎰 スロット（ジャグラー風）。絵柄・上のパネル・下のパネル・ランプは public/slots/ の画像（なければ仮の絵・文字）。
 * 動き（casino.js）:
 * - spin: レバーを叩いたばかり。回り続けて、STOP で左から止める（止まる目はもう決まっている: data-stops）
 * - aim: ボーナスを持っている。レバー → STOP で 7 を狙う（押した所を送って、サーバーがすべりを計算する）
 * - still: 止まったまま
 */

const fmt = (n: number) => n.toLocaleString('ja-JP');
const ROLE_TEXT: Record<SlotRole, string> = {
  big: '7️⃣7️⃣7️⃣ BIG BONUS！',
  reg: '7️⃣7️⃣BAR REG BONUS！',
  grape: '🍇 ぶどう',
  replay: '🔁 リプレイ',
  cherry: '🍒 チェリー',
  bell: '🔔 ベル',
  clown: '🤡 ピエロ',
  none: 'はずれ…',
};
/** 中段の役（casino.js で 7 がそろったか見るのに使う） */
const LINES = (Object.keys(SLOT_ROLES) as (keyof typeof SLOT_ROLES)[]).map((k) => `${k}:${SLOT_ROLES[k].line.map((x) => x ?? '*').join('.')}`).join('|');
const IDLE_STOPS = [0, 0, 0];
const PAYLINE_ROWS = PAYLINES.map((l) => l.rows.join(',')).join('|');
/** 電光表示の文字 */
const LED_TEXT: Record<SlotRole, string> = { big: 'BIG!', reg: 'REG!', grape: 'GRAPE', cherry: 'CHERRY', replay: 'REPLAY', bell: 'BELL', clown: 'PIERROT', none: '-----' };
const pad = (n: number) => String(n).padStart(4, '0');
const odds = (w: number) => {
  const n = 65536 / w;
  return n >= 20 ? `1/${Math.round(n)}` : `1/${n.toFixed(1)}`;
};

function Sym(p: { k: SlotKey }) {
  const src = slotArt(p.k);
  return src ? <img class="sy" src={src} alt="" draggable="false" /> : <span class="sy">{SLOT_SYMBOLS[p.k].emoji}</span>;
}

function PaySym(p: { k: SlotKey }) {
  const src = slotArt(p.k);
  return src ? <img class="c-pay-sy" src={src} alt={SLOT_SYMBOLS[p.k].name} draggable="false" /> : <span class="c-pay-sy">{SLOT_SYMBOLS[p.k].emoji}</span>;
}

function Art(p: { name: string; class: string; fallback?: unknown }) {
  const src = slotArt(p.name);
  return src ? <img class={p.class} src={src} alt="" draggable="false" /> : <>{p.fallback}</>;
}

export function SlotsPage(p: GamePage) {
  const csrf = p.me.session.csrfToken;
  const row = p.row;
  const raw = row?.state as SlotsState | undefined;
  const s = raw && raw.v === 2 ? raw : undefined;
  const legacy = raw && !s ? (raw as Exclude<SlotsState, SlotsSpin>) : undefined;
  const holding = Boolean(row?.status === 'playing' && s?.phase === 'aim' && isBonus(s.role));
  // レバーを叩いたばかり（ボーナスを引いた回は、まだ狙っていない）
  const leverFresh = holding ? !s!.aimed && (s!.tries ?? 0) === 0 && Date.now() - row!.createdAt.getTime() < 60_000 : Boolean(s && freshDone(row) && !s.aimed);
  const mode: 'spin' | 'aim' | 'still' = holding ? (leverFresh && s!.lamp === 'post' ? 'spin' : 'aim') : s && leverFresh ? 'spin' : 'still';
  const autoAim = holding && leverFresh && s!.lamp === 'pre';
  // 7 をそろえたばかり
  const bonusFresh = Boolean(s && row?.status === 'done' && isBonus(s.role) && s.aimed && freshDone(row));
  const stops = s?.stops ?? IDLE_STOPS;
  const lampLit = Boolean(s?.lamp && (holding ? mode === 'aim' : isBonus(s.role)));
  const me = !s || row?.status !== 'done' ? p.me : mode === 'spin' ? { ...p.me, revealFrom: p.me.balance - row!.payout, revealAt: 0, revealWait: true } : bonusFresh ? revealMe(p.me, row, 16) : p.me;
  const wait = mode === 'spin' ? ' wait' : '';
  // 当たったライン（止まったまま見せるときは、はじめから光らせる）
  const winLine = s && row?.status === 'done' && s.mult > 0 ? judge(stops).line : -1;
  const leverBet = Math.min(p.casino.maxBet, Math.max(p.casino.minBet, row?.bet ?? 100));
  return (
    <CasinoLayout title="スロット" me={me} back>
      <h1 class="c-h1">🎰 スロット</h1>
      {p.msg && <Msg msg={p.msg} />}
      <section class="c-slot-stage">
        <div class="c-cab">
          <div class="c-cab-crown" aria-hidden="true">
            <span class="c-cab-bulbs"></span>
            <b>🌸</b>
          </div>
          <div
            class={`c-jug mode-${mode}${holding ? ' holding' : ''}${mode === 'spin' && s?.lamp === 'pre' ? ' lamp-pre' : ''}${bonusFresh ? ` bonus-${s!.role}` : ''}`}
            data-mode={mode}
            data-auto={autoAim ? '1' : undefined}
            data-stops={stops.join(',')}
            data-lamp={s?.lamp ?? ''}
            data-role={s?.role ?? ''}
            data-want={holding ? SLOT_ROLES[s!.role as 'big' | 'reg'].line.join(',') : undefined}
            data-lines={LINES}
            data-slip={String(SLIP)}
            data-n={String(REEL_LEN)}
            data-win={s && row?.status === 'done' ? String(s.mult) : ''}
            data-paylines={PAYLINE_ROWS}
            data-winline={winLine >= 0 ? String(winLine) : undefined}
          >
            <span class="c-jug-side l" aria-hidden="true"></span>
            <span class="c-jug-side r" aria-hidden="true"></span>
            <div class="c-jug-top">
              <Art
                name="top"
                class="c-jug-art"
                fallback={
                  <>
                    <span class="c-jug-title">🌸 SAKURA 777 🌸</span>
                    <span class="c-bulbs" aria-hidden="true"></span>
                  </>
                }
              />
            </div>
            <div class="c-jug-window" role="img" aria-label={mode === 'spin' ? 'リールが回っています' : `上段: ${gridOf(stops).map((c) => SLOT_SYMBOLS[c[0]!].name).join('・')} / 中段: ${gridOf(stops).map((c) => SLOT_SYMBOLS[c[1]!].name).join('・')} / 下段: ${gridOf(stops).map((c) => SLOT_SYMBOLS[c[2]!].name).join('・')}`}>
              {REELS.map((strip, i) => (
                // 回し始めは決まった目と違う所から（最初の一瞬に結果が見えないように）
                <div class={`c-jreel r${i}${mode !== 'spin' && winLine >= 0 ? ` hit-${PAYLINES[winLine]!.rows[i]}` : ''}`} data-reel={String(i)} data-strip={strip.join(',')} data-at={String(mode === 'spin' ? (stops[i]! + 7 + i * 5) % REEL_LEN : stops[i])}>
                  <div class={`c-jstrip at-${mode === 'spin' ? (stops[i]! + 7 + i * 5) % REEL_LEN : stops[i]}`} aria-hidden="true">
                    {[...strip, ...strip, ...strip].map((k) => (
                      <Sym k={k} />
                    ))}
                  </div>
                </div>
              ))}
              <span class="c-linelamps l" aria-hidden="true">
                {[3, 0, 1, 2, 4].map((l) => (
                  <i class={`ln ln-${PAYLINES[l]!.key}${mode !== 'spin' && winLine === l ? ' on' : ''}`} data-line={String(l)}></i>
                ))}
              </span>
              <span class="c-linelamps r" aria-hidden="true">
                {[4, 0, 1, 2, 3].map((l) => (
                  <i class={`ln ln-${PAYLINES[l]!.key}${mode !== 'spin' && winLine === l ? ' on' : ''}`} data-line={String(l)}></i>
                ))}
              </span>
              <span class="c-winline" aria-hidden="true"></span>
            </div>
            <div class="c-jug-mid">
              <span class={`c-gogo${lampLit ? ' lit' : ''}`} aria-label={lampLit ? 'ランプが光っています（ボーナス）' : 'ボーナスのランプ'}>
                <Art name="lamp" class="c-gogo-art" fallback={<b>GOGO!</b>} />
              </span>
              <div class="c-jug-led" aria-hidden="true">
                <span class="c-seg">
                  <i>BET</i>
                  <b>{row ? pad(row.bet) : '----'}</b>
                </span>
                <span class="c-seg c-seg-mid">
                  <i>{holding ? 'CHANCE' : 'SAKURA 777'}</i>
                  {holding ? (
                    <b class="c-seg-blink">BONUS</b>
                  ) : s && row?.status === 'done' ? (
                    <b class={`c-later${wait}${s.mult > 0 ? ' c-seg-win' : ''}`} data-after-stop>
                      {LED_TEXT[s.role]}
                    </b>
                  ) : (
                    <b>READY</b>
                  )}
                </span>
                <span class="c-seg">
                  <i>WIN</i>
                  {s && row?.status === 'done' ? (
                    <b class={`c-later${wait}`} data-after-stop>
                      {pad(row.payout)}
                    </b>
                  ) : (
                    <b>0000</b>
                  )}
                </span>
              </div>
            </div>
            <div class="c-jug-deck">
              {holding ? (
                <button type="button" class="c-lever" data-lever disabled={mode === 'spin'} aria-label="レバー（7 を狙って回す）">
                  <span class="c-lever-knob"></span>
                </button>
              ) : (
                <form method="post" action="/casino/slots" class="c-lever-form">
                  <input type="hidden" name="_csrf" value={csrf} />
                  <input type="hidden" name="bet" value={String(leverBet)} />
                  <button type="submit" class={`c-lever${mode === 'spin' ? ' pulled' : ''}`} data-lever-spin disabled={mode === 'spin'} aria-label={`レバー（${fmt(leverBet)} ${p.me.coin.name}で回す）`}>
                    <span class="c-lever-knob"></span>
                  </button>
                </form>
              )}
              <span class="c-stops">
                {[0, 1, 2].map((i) => (
                  <button type="button" class="c-stop" data-stop={String(i)} disabled={mode !== 'spin'} aria-label={`${['左', '中', '右'][i]}のリールを止める`}>
                    STOP
                  </button>
                ))}
              </span>
              <span class="c-medal-slot" aria-hidden="true">
                <i></i>
                <small>MEDAL</small>
              </span>
            </div>
            <p class="c-deck-note" data-still={`レバー（スペース）で ${fmt(leverBet)} ${p.me.coin.name}を賭けて回す`}>
              {holding
                ? mode === 'spin'
                  ? '左から STOP'
                  : 'レバーで回して 7 を狙う'
                : mode === 'spin'
                  ? 'STOP（スペース）で左から止める'
                  : `レバー（スペース）で ${fmt(leverBet)} ${p.me.coin.name}を賭けて回す`}
            </p>
            <Art
              name="bottom"
              class="c-jug-art c-jug-art-bottom"
              fallback={
                <div class="c-jug-belly" aria-label="配当表">
                  <b class="c-belly-title">配 当 表</b>
                  <ul>
                    {(['big', 'reg', 'bell', 'clown', 'grape', 'cherry', 'replay'] as const).map((k) => (
                      <li class={`c-pay-${k}`}>
                        <span class="c-pay-syms">
                          {SLOT_ROLES[k].line.map((x) => (x ? <PaySym k={x} /> : <span class="c-pay-any">any</span>))}
                        </span>
                        <span class="c-pay-mult">{k === 'replay' ? 'もう一度' : `×${SLOT_ROLES[k].mult}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
            <div class={`c-jug-tray${s && row?.status === 'done' && row.payout > 0 ? ' paid' : ''}`} aria-hidden="true">
              <span class={`c-tray-coins${mode === 'spin' ? ' c-later wait' : ''}`} data-after-stop={mode === 'spin' ? '' : undefined}>
                {Array.from({ length: 9 }, () => (
                  <i></i>
                ))}
              </span>
              <span class="c-tray-name">咲 楽 ノ 宮</span>
            </div>
            {bonusFresh && (
              <div class={`c-bonus ${s!.role}`}>
                <b>{s!.role === 'big' ? 'BIG BONUS' : 'REG BONUS'}</b>
                <span class="c-bonus-count" data-count={String(row!.payout)}>
                  {fmt(row!.payout)}
                </span>
                <span class="c-coins" aria-hidden="true">
                  {Array.from({ length: 16 }, () => (
                    <i>🪙</i>
                  ))}
                </span>
              </div>
            )}
          </div>
          <div class="c-cab-base" aria-hidden="true"></div>
        </div>
        {holding && (
          <div class={`c-later${wait}`} data-after-stop>
            <form method="post" action={`/casino/slots/${row!.id}`} class="c-aim" data-aim>
              <input type="hidden" name="_csrf" value={csrf} />
              <input type="hidden" name="v" value={String(row!.version)} />
              <input type="hidden" name="p" value="" data-aim-p />
              <p class="c-aim-title">
                ✨ ペカッ！ ボーナスです。<b>7 を狙って</b>そろえよう
              </p>
              <p class="c-muted">
                「レバー」で回して、左から STOP。7 が窓の少し上に見えたら押すと、最大 {SLIP} コマすべって止まります。どのラインでも 7・7・7（REG は 7・7・BAR）がそろえば OK。狙う回は銭を賭けません。
              </p>
              {(s!.tries ?? 0) > 0 && <p class="c-aim-miss">おしい！ もう一度狙えます（はずれ {s!.tries} 回）。当たりは持ち越しています。</p>}
              <button type="submit" name="assist" value="1" class="c-btn c-btn-ghost c-btn-small">
                うまく押せないときは おまかせでそろえる
              </button>
            </form>
          </div>
        )}
        {s && row?.status === 'done' && (
          <div class={`c-later${wait}${bonusFresh ? ' c-fx-burst' : ''}`} data-after-stop>
            <Result
              bet={row.bet}
              payout={row.payout}
              coin={p.me.coin}
              text={s.role === 'none' ? ROLE_TEXT.none : `${ROLE_TEXT[s.role]} ×${s.mult}${s.role === 'replay' ? '（賭けた分が戻る）' : ''}${s.assist ? '（おまかせ）' : ''}`}
            />
          </div>
        )}
        {legacy && row && <Result bet={row.bet} payout={row.payout} coin={p.me.coin} text={legacy.multiplier > 0 ? `🎉 ${legacy.multiplier} 倍！` : 'はずれ…'} />}
      </section>
      {!holding && (
        <div class={wait.trim() ? 'c-later wait' : ''} data-after-stop>
          <BetForm action="/casino/slots" csrf={csrf} casino={p.casino} coin={p.me.coin} label="回す" last={row?.bet} />
        </div>
      )}
      <Rules>
        ラインは 5 本（上段・中段・下段・右下がり・右上がり）で、どれかのラインにそろえば当たりです。レバーを叩いた（賭けた）ときに役が決まり、STOP は止める合図です。
        {(Object.keys(SLOT_ROLES) as (keyof typeof SLOT_ROLES)[])
          .map((k) => `${SLOT_ROLES[k].name}（${SLOT_ROLES[k].line.map((x) => (x ? SLOT_SYMBOLS[x].name : 'なんでも')).join('・')}）${odds(SLOT_ROLES[k].weight)}・×${SLOT_ROLES[k].mult}`)
          .join(' / ')}
        。チェリーは左リールのどの段でも当たり。リプレイは賭けた分が戻ります。BIG・REG を引くと GOGO ランプが光り（レバーで光る先ペカ・止めたあとの後ペカ）、自分で 7 を狙ってそろえると払われます（どのラインでもよい）。はずしても当たりは持ち越し、狙う回は賭けません。払い戻し率は約 95% です。
      </Rules>
    </CasinoLayout>
  );
}
