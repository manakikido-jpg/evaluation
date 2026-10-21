import { randomUUID } from 'node:crypto';
import { SCRATCH_PRIZES, projectedPrize, type fortuneState } from '../../services/casino/fortune.js';
import type { FortuneGamesConfig } from '../../config.js';
import type { Child } from 'hono/jsx';
import type { MemberSession } from '../../db/schema.js';
import { assetUrl } from '../assets.js';
export type FortuneMe = { session: MemberSession; balance: number; coin: { name: string; emoji: string } };
function FortuneLayout({ me, children }: { me?: FortuneMe; children: Child }) {
 return <html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>咲楽ノ宮 宝くじ売り場</title><link rel="stylesheet" href={assetUrl('casino.css')} /><link rel="stylesheet" href={assetUrl('fortune.css')} /><script src={assetUrl('fortune.js')} defer></script></head>
 <body class="casino fortune-shop"><header class="c-top"><a class="c-logo" href="/lottery">🌸 咲楽ノ宮<b>宝くじ売り場</b></a>{me && <div class="c-me"><span class="c-balance">{me.coin.emoji}{me.balance.toLocaleString('ja-JP')} {me.coin.name}</span><span class="c-name">{me.session.displayName}</span><form method="post" action="/lottery/logout"><input type="hidden" name="_csrf" value={me.session.csrfToken} /><button class="c-link">ログアウト</button></form></div>}</header><main class="c-main">{children}</main><footer class="c-foot">銭はサーバーの中だけのポイントです。お金に換えることはできません。</footer></body></html>;
}
export function FortuneEntry({ error }: { error?: string }) { return <FortuneLayout><section class="fortune-panel"><h1>🎟 宝くじ売り場</h1><p>普段は控えめなスクラッチ。日曜21時（日本時間）は、賞金を上乗せした週末宝くじ。</p>{error && <p class="c-alert" role="alert">{error}</p>}<p>咲楽ノ宮のメンバー向けです。Discord の宝くじ売り場のチャンネルで「🎫 宝くじ売り場に入る」を押すと、ログインなしで入れます。</p><a class="c-btn c-btn-sub" href="/lottery/auth">Discordで認証して入る</a></section></FortuneLayout>; }
/** 売り場のボタンで渡した 1 回きりのリンク（押すと入る。リンクを開いただけでは使わない） */
export function FortuneLink({ name, action }: { name: string; action: string }) { return <FortuneLayout><section class="fortune-panel"><h1>🎟 宝くじ売り場</h1><p>{name} さんとして入ります。</p><form method="post" action={action}><button class="c-btn">入る</button></form></section></FortuneLayout>; }
import { Layout, type SessionView } from './layout.js';
const date = (d: Date | string) => new Date(d).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
type State = Awaited<ReturnType<typeof fortuneState>>;
const Hidden = ({ me }: { me: FortuneMe }) => <input type="hidden" name="_csrf" value={me.session.csrfToken} />;
export function FortunePage({ me, cfg, state, selected, error }: { me: FortuneMe; cfg: FortuneGamesConfig; state: State; selected?: string; error?: string }) {
  const ticket = state.scratches.find(t => t.id === selected) ?? state.scratches.find(t => !t.openedAt) ?? state.scratches[0];
  const round = state.round;
  const mine = round ? state.tickets.filter(t => t.roundId === round.id) : [];
  return <FortuneLayout me={me}>
    <h1 class="fortune-title">🎟 宝くじ売り場</h1>
    <p>普段は小さな運だめし。日曜21時（日本時間）は、週末の宝くじ。</p>
    <p>いまの残高：<strong id="fortune-balance">{me.balance.toLocaleString('ja-JP')}</strong> {me.coin.name}</p>
    {error && <p class="c-alert" role="alert">{error}</p>}
    {!cfg.enabled && <p class="c-alert">新しい購入はお休み中です。買ってあるスクラッチは開けます。販売済みの宝くじも抽選します。</p>}
    <div class="fortune-grid">
      <section class="fortune-panel"><h2>✨ 毎日のスクラッチ</h2>
        <p>1枚 {cfg.scratchPrice} {me.coin.name} · 今日 {state.dailyUsed} / {cfg.scratchDailyLimit} 枚。上限は日本時間0時に戻ります。</p>
        <form method="post" action="/lottery/scratch" data-fortune-buy><Hidden me={me} /><input type="hidden" name="quote" value={cfg.scratchPrice} /><input type="hidden" name="nonce" value={randomUUID()} />
          <button class="c-btn" disabled={!cfg.enabled || state.dailyUsed >= cfg.scratchDailyLimit || !!state.scratches.find(t => !t.openedAt)}>1枚買う（{cfg.scratchPrice} {me.coin.name}）</button>
        </form>
        {ticket && <article class="scratch-ticket" data-coin={me.coin.name} data-emoji={me.coin.emoji} data-scratch={ticket.id} data-csrf={me.session.csrfToken} data-opened={ticket.openedAt ? 'yes' : 'no'}>
          <h3>あなたのスクラッチ</h3><p>この券の購入額：{ticket.price} {me.coin.name}</p>
          <div class="scratch-stage"><div class="scratch-result" aria-live="polite">
            <p data-scratch-symbols>{ticket.openedAt ? (ticket.payout ? Array(3).fill(SCRATCH_PRIZES.find(p => p.multiplier === ticket.payout! / ticket.price)?.symbol).join(' ') : '🌸 🍃 ⛩') : '？ ？ ？'}</p>
            <p data-scratch-result>{ticket.openedAt ? `払戻 ${ticket.payout} ${me.coin.name}（購入額 ${ticket.price} ${me.coin.name}）` : '削って結果を見てみよう'}</p>
          </div>{!ticket.openedAt && <canvas class="scratch-cover" width="600" height="280" aria-label="指やマウスで削れます。下の結果を開くボタンでも開けます。" />}</div>
          <form method="post" action={`/lottery/scratch/${ticket.id}/open`} data-scratch-form><Hidden me={me} />
            {!ticket.openedAt && <button class="c-btn" type="submit">結果を開く・すべて削る</button>}
          </form><p><a href="/lottery">一覧を更新・次の券へ</a></p><p data-scratch-status role="status">{ticket.openedAt ? 'この券は精算済みです。' : '途中で閉じても券は残ります。開封時に自動で精算します。'}</p>
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
          <form method="post" action="/lottery/tickets" data-fortune-buy><Hidden me={me} /><input type="hidden" name="nonce" value={randomUUID()} /><input type="hidden" name="roundId" value={round.id} />
            <button class="c-btn" disabled={!cfg.enabled || mine.length >= round.perMember || round.sold >= 100000}>1枚買う（{round.price} {me.coin.name}）</button>
          </form><p>今回のあなたの番号：{mine.map(t => '#' + t.number).join('、') || 'まだありません'}</p>
        </> : <p>次の販売をお待ちください。抽選は日曜21時（日本時間）です。</p>}
        <p><a class="c-btn c-btn-ghost" href="/lottery">販売枚数・抽選結果を更新</a></p><h3>最近の抽選</h3>{!state.rounds.length && <p>まだ抽選はありません。</p>}
        <ul>{state.rounds.map(r => <li>{date(r.drawAt)}：{!r.settledAt ? '抽選処理中（再読み込みで確認）' : r.winningNumber ? `当選 #${r.winningNumber} · ${r.payout} ${me.coin.name}${r.winnerId === me.session.userId ? ' 🎉 あなたが当選しました！' : ''}` : '販売0枚・抽選なし'}</li>)}</ul>
        <details><summary>あなたの購入履歴（最近100枚）</summary><ul>{state.tickets.map(t => <li>{date(t.roundId)} 抽選分：#{t.number}</li>)}</ul></details>
      </section>
    </div>
    <details class="fortune-panel"><summary>スクラッチの履歴（最近20枚）</summary><ul>{state.scratches.map(t => <li><a href={'/lottery?ticket=' + t.id}>{date(t.createdAt)}</a>：購入 {t.price} {me.coin.name} / {t.openedAt ? `払戻 ${t.payout} ${me.coin.name}` : '未開封'}</li>)}</ul></details>
  </FortuneLayout>;
}
export function FortuneAdminPage({ session, cfg, round, message }: { session: SessionView; cfg: FortuneGamesConfig; round: State['round']; message?: string }) {
  return <Layout title="スクラッチ・宝くじ" nav="fortune" session={session}><h1>✨ スクラッチ・週末宝くじ</h1>
    {message && <p role="status">{message}</p>}<p><a href="/lottery">宝くじ売り場へ（Discordで本人認証）</a></p>
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
