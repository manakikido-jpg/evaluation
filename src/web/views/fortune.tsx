import { randomUUID } from 'node:crypto';
import { SCRATCH_PRIZES, projectedPrize, type fortuneState } from '../../services/casino/fortune.js';
import type { FortuneGamesConfig } from '../../config.js';
import { CasinoLayout, type CasinoMe } from './casino.js';
import { Layout, type SessionView } from './layout.js';
const date = (d: Date | string) => new Date(d).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
type State = Awaited<ReturnType<typeof fortuneState>>;
const Hidden = ({ me }: { me: CasinoMe }) => <input type="hidden" name="_csrf" value={me.session.csrfToken} />;
export function FortunePage({ me, cfg, state, selected, error }: { me: CasinoMe; cfg: FortuneGamesConfig; state: State; selected?: string; error?: string }) {
  const ticket = state.scratches.find(t => t.id === selected) ?? state.scratches.find(t => !t.openedAt) ?? state.scratches[0];
  const round = state.round;
  const mine = round ? state.tickets.filter(t => t.roundId === round.id) : [];
  return <CasinoLayout title="スクラッチ・週末宝くじ" me={me} fortune>
    <h1 class="fortune-title">✨ スクラッチ・週末宝くじ</h1>
    <p>普段は小さな運だめし。日曜21時（日本時間）は、週末の宝くじ。</p>
    <p>いまの残高：<strong id="fortune-balance">{me.balance.toLocaleString('ja-JP')}</strong> {me.coin.name}</p>
    {error && <p class="c-alert" role="alert">{error}</p>}
    {!cfg.enabled && <p class="c-alert">新しい購入はお休み中です。買ってあるスクラッチは開けます。販売済みの宝くじも抽選します。</p>}
    <div class="fortune-grid">
      <section class="fortune-panel"><h2>✨ 毎日のスクラッチ</h2>
        <p>1枚 {cfg.scratchPrice} {me.coin.name} · 今日 {state.dailyUsed} / {cfg.scratchDailyLimit} 枚。上限は日本時間0時に戻ります。</p>
        <form method="post" action="/casino/fortune/scratch"><Hidden me={me} /><input type="hidden" name="quote" value={cfg.scratchPrice} /><input type="hidden" name="nonce" value={randomUUID()} />
          <button class="c-btn" disabled={!cfg.enabled || state.dailyUsed >= cfg.scratchDailyLimit || !!state.scratches.find(t => !t.openedAt)}>1枚買う（{cfg.scratchPrice} {me.coin.name}）</button>
        </form>
        {ticket && <article class="scratch-ticket" data-coin={me.coin.name} data-emoji={me.coin.emoji} data-scratch={ticket.id} data-csrf={me.session.csrfToken} data-opened={ticket.openedAt ? 'yes' : 'no'}>
          <h3>あなたのスクラッチ</h3><p>この券の購入額：{ticket.price} {me.coin.name}</p>
          <div class="scratch-stage"><div class="scratch-result" aria-live="polite">
            <p data-scratch-symbols>{ticket.openedAt ? (ticket.payout ? Array(3).fill(SCRATCH_PRIZES.find(p => p.multiplier === ticket.payout! / ticket.price)?.symbol).join(' ') : '🌸 🍃 ⛩') : '？ ？ ？'}</p>
            <p data-scratch-result>{ticket.openedAt ? `払戻 ${ticket.payout} ${me.coin.name}（購入額 ${ticket.price} ${me.coin.name}）` : '削って結果を見てみよう'}</p>
          </div>{!ticket.openedAt && <canvas class="scratch-cover" width="600" height="280" aria-label="指やマウスで削れます。下の結果を開くボタンでも開けます。" />}</div>
          <form method="post" action={`/casino/fortune/scratch/${ticket.id}/open`} data-scratch-form><Hidden me={me} />
            {!ticket.openedAt && <button class="c-btn" type="submit">結果を開く・すべて削る</button>}
          </form><p><a href="/casino/fortune">一覧を更新・次の券へ</a></p><p data-scratch-status role="status">{ticket.openedAt ? 'この券は精算済みです。' : '途中で閉じても券は残ります。開封時に自動で精算します。'}</p>
        </article>}
        <details><summary>当たり・確率・遊び方</summary><p>絵柄が3つそろうと当たり。払戻は購入額込みです。平均還元率は71.5％です。</p>
          <ul>{SCRATCH_PRIZES.map(p => <li>{p.multiplier ? `${p.symbol} ${p.multiplier}倍` : 'はずれ'}：{p.weight / 100}％</li>)}</ul><p>購入時に結果が決まります。削る場所や速さで結果は変わりません。</p>
        </details>
      </section>
      <section class="fortune-panel"><h2>🎟 週末の宝くじ</h2>
        {round ? <><p>抽選・販売締切：<strong>{date(round.drawAt)}（日本時間）</strong></p>
          <p>1枚 {round.price} {me.coin.name} · 1人 {round.perMember} 枚まで。あなたは {mine.length} 枚。</p>
          <p>現在 {round.sold} 枚 · 現在の賞金 <strong>{projectedPrize(round).toLocaleString('ja-JP')} {me.coin.name}</strong></p>
          <p>賞金は売上の{round.returnPct}％＋運営の{round.bonus} {me.coin.name}。売れた券から1枚が当選し、全額を自動入金。販売0枚なら賞金は出しません。</p>
          <details><summary>抽選のしくみ・販売上限</summary><p>1枚あたりの当選確率は最終販売枚数分の1です。売上からの賞金は端数切り捨て。販売0枚なら抽選・上乗せ・繰越はありません。全体の販売上限は100,000枚です。抽選は通常1分以内に処理し、BOT停止中の分は再起動後に精算します。</p></details>
          <form method="post" action="/casino/fortune/lottery"><Hidden me={me} /><input type="hidden" name="nonce" value={randomUUID()} /><input type="hidden" name="roundId" value={round.id} />
            <button class="c-btn" disabled={!cfg.enabled || mine.length >= round.perMember || round.sold >= 100000}>1枚買う（{round.price} {me.coin.name}）</button>
          </form><p>今回のあなたの番号：{mine.map(t => '#' + t.number).join('、') || 'まだありません'}</p>
        </> : <p>次の販売をお待ちください。抽選は日曜21時（日本時間）です。</p>}
        <p><a class="c-btn c-btn-ghost" href="/casino/fortune">販売枚数・抽選結果を更新</a></p><h3>最近の抽選</h3>{!state.rounds.length && <p>まだ抽選はありません。</p>}
        <ul>{state.rounds.map(r => <li>{date(r.drawAt)}：{!r.settledAt ? '抽選処理中（再読み込みで確認）' : r.winningNumber ? `当選 #${r.winningNumber} · ${r.payout} ${me.coin.name}${r.winnerId === me.session.userId ? ' 🎉 あなたが当選しました！' : ''}` : '販売0枚・抽選なし'}</li>)}</ul>
        <details><summary>あなたの購入履歴（最近100枚）</summary><ul>{state.tickets.map(t => <li>{date(t.roundId)} 抽選分：#{t.number}</li>)}</ul></details>
      </section>
    </div>
    <details class="fortune-panel"><summary>スクラッチの履歴（最近20枚）</summary><ul>{state.scratches.map(t => <li><a href={'/casino/fortune?ticket=' + t.id}>{date(t.createdAt)}</a>：購入 {t.price} {me.coin.name} / {t.openedAt ? `払戻 ${t.payout} ${me.coin.name}` : '未開封'}</li>)}</ul></details>
  </CasinoLayout>;
}
export function FortuneAdminPage({ session, cfg, round, message }: { session: SessionView; cfg: FortuneGamesConfig; round: State['round']; message?: string }) {
  return <Layout title="スクラッチ・宝くじ" nav="fortune" session={session}><h1>✨ スクラッチ・週末宝くじ</h1>
    {message && <p role="status">{message}</p>}<p><a href="/casino/fortune">遊ぶ画面へ（カジノの本人認証が必要）</a></p>
    <p>日曜21時（日本時間）に抽選。売れた券から1枚に、売上の一部＋運営の上乗せを自動入金します。販売0枚なら賞金を出しません。</p>
    <p>スクラッチは即時、宝くじの金額・上限は次の開催から適用します。休止しても購入済みの券は精算します。</p>
    {round && <section class="card"><h2>販売中の回の固定条件</h2><p>{date(round.drawAt)}（日本時間） / 1枚{round.price} / 1人{round.perMember}枚 / 売上{round.returnPct}％＋{round.bonus} / 販売{round.sold}枚</p></section>}
    <form method="post" action="/economy/fortune"><input type="hidden" name="_csrf" value={session.csrfToken} />
      <fieldset class="fields" disabled={session.level !== 'guji'}><legend>宮司だけ変更できます</legend>
      <label><input type="checkbox" name="enabled" value="yes" checked={cfg.enabled} />購入を有効にする</label>
      {([['scratchPrice','スクラッチ1枚の銭',10,10000],['scratchDailyLimit','スクラッチ1人1日の上限',1,20],['lotteryPrice','宝くじ1枚の銭',10,10000],['lotteryLimit','宝くじ1人1回の上限',1,100],['lotteryReturnPct','宝くじ売上から賞金に戻す割合（％）',10,100],['lotteryBonus','宝くじに運営が上乗せする銭',0,1000000]] as const).map(([key,label,min,max]) => <label>{label}<input type="number" name={key} value={cfg[key]} min={min} max={max} required /></label>)}
      <button type="submit">保存する</button></fieldset>
    </form><p>スクラッチの払戻：0倍55％・1倍30％・2倍12％・5倍2.5％・10倍0.5％。平均還元率71.5％。当選確率は固定です。</p>
  </Layout>;
}
