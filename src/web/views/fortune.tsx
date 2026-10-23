import { randomUUID } from 'node:crypto';
import { SCRATCH_PERIODS, type ScratchFinances, type LotteryFinances } from '../../services/casino/fortuneStats.js';
import { SCRATCH_PRIZES, projectedPrize, roundTiers, tierPrizes, type fortuneState } from '../../services/casino/fortune.js';
import { roundWinners } from '../../services/casino/lotteryNotice.js';
import type { FortuneGamesConfig } from '../../config.js';
import type { Child } from 'hono/jsx';
import type { FortuneRound, MemberSession } from '../../db/schema.js';
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
          <p>現在 {round.sold} 枚 · 現在の賞金の合計 <strong>{projectedPrize(round).toLocaleString('ja-JP')} {me.coin.name}</strong></p>
          <table class="fortune-tiers"><thead><tr><th>等</th><th>本数</th><th>1本あたり（今の売上なら）</th></tr></thead><tbody>
            {tierPrizes(round).map((t) => <tr><td>{t.name}</td><td>{t.count} 本</td><td><strong>{t.each.toLocaleString('ja-JP')} {me.coin.name}</strong>（賞金の{t.pct}％）</td></tr>)}
          </tbody></table>
          <p>賞金は売上の{round.returnPct}％＋運営の{round.bonus} {me.coin.name}。売れるほど増えます。等の順に、まだ当たっていない券から引き、自動入金。売れた枚数より当たりが多いときは、出ない等があります。販売0枚なら賞金は出しません。</p>
          <details><summary>抽選のしくみ・販売上限</summary><p>1枚あたりの当選確率は最終販売枚数分の1です。売上からの賞金は端数切り捨て。販売0枚なら抽選・上乗せ・繰越はありません。全体の販売上限は100,000枚です。抽選は通常1分以内に処理し、BOT停止中の分は再起動後に精算します。</p></details>
          <form method="post" action="/lottery/tickets" data-fortune-buy><Hidden me={me} /><input type="hidden" name="nonce" value={randomUUID()} /><input type="hidden" name="roundId" value={round.id} />
            <button class="c-btn" disabled={!cfg.enabled || mine.length >= round.perMember || round.sold >= 100000}>1枚買う（{round.price} {me.coin.name}）</button>
          </form><p>今回のあなたの番号：{mine.map(t => '#' + t.number).join('、') || 'まだありません'}</p>
        </> : <p>次の販売をお待ちください。抽選は日曜21時（日本時間）です。</p>}
        <p><a class="c-btn c-btn-ghost" href="/lottery">販売枚数・抽選結果を更新</a></p><h3>最近の抽選</h3>{!state.rounds.length && <p>まだ抽選はありません。</p>}
        <ul>{state.rounds.map(r => { const ws = roundWinners(r); const mine = ws.filter(w => w.memberId === me.session.userId); return <li>{date(r.drawAt)}：{!r.settledAt ? '抽選処理中（再読み込みで確認）' : ws.length ? `${ws.map(w => `${w.tier} #${w.number}（${w.payout.toLocaleString('ja-JP')} ${me.coin.name}）`).join('・')}${mine.length ? ` 🎉 あなたが当選しました！（${mine.map(w => w.tier).join('・')}）` : ''}` : '販売0枚・抽選なし'}</li>; })}</ul>
        <details><summary>あなたの購入履歴（最近100枚）</summary><ul>{state.tickets.map(t => <li>{date(t.roundId)} 抽選分：#{t.number}</li>)}</ul></details>
      </section>
    </div>
    <details class="fortune-panel"><summary>スクラッチの履歴（最近20枚）</summary><ul>{state.scratches.map(t => <li><a href={'/lottery?ticket=' + t.id}>{date(t.createdAt)}</a>：購入 {t.price} {me.coin.name} / {t.openedAt ? `払戻 ${t.payout} ${me.coin.name}` : '未開封'}</li>)}</ul></details>
  </FortuneLayout>;
}
function ScratchFinancePanel({ data: d, price, coin }: { data: ScratchFinances; price: number; coin: string }) {
  const money = (value: number) => `${value.toLocaleString('ja-JP')} ${coin}`;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
  const multipliers = [...new Set([...SCRATCH_PRIZES.map(p => p.multiplier), ...d.prizes.map(p => p.multiplier)])].sort((a,b) => a-b);
  return <section class="card" id="scratch-finances">
    <h2>スクラッチの売上・払戻・回収</h2>
    <nav class="tabs" aria-label="スクラッチ収支の期間">{Object.entries(SCRATCH_PERIODS).map(([key,label]) => <a href={`/economy/fortune?period=${key}#scratch-finances`} class={d.period === key ? 'on' : ''} aria-current={d.period === key ? 'page' : undefined}>{label}</a>)}</nav>
    <p class="note">{d.start ? `${date(d.start)} 〜 ${date(d.end)}` : `記録の開始 〜 ${date(d.end)}`}（日本時間）。直近7日・30日は今日を含みます。</p>
    <div class="health-grid">
      <div class="health-item"><span class="health-label">売上（購入額）</span><div class="health-value">{money(d.revenue)}</div><span class="note">期間内に販売 {d.sold.toLocaleString('ja-JP')} 枚</span></div>
      <div class="health-item"><span class="health-label">当せん払戻額</span><div class="health-value">{money(d.payout)}</div><span class="note">期間内に開封 {d.opened.toLocaleString('ja-JP')} 枚・払戻あり {d.wins.toLocaleString('ja-JP')} 枚</span></div>
      <div class={`health-item ${d.cashNet < 0 ? 'health-bad' : 'health-ok'}`}><span class="health-label">差引回収額（売上 − 払戻）</span><div class="health-value">{signed(d.cashNet)}</div><span class="note">マイナスは運営の持ち出し</span></div>
      <div class={`health-item ${d.settledNet < 0 ? 'health-bad' : 'health-ok'}`}><span class="health-label">開封済みの券だけの収支</span><div class="health-value">{signed(d.settledNet)}</div><span class="note">開封した券の購入額 {money(d.settledSales)} − 払戻</span></div>
    </div>
    <p class="note">売上は購入日、払戻は開封日で数えます。以前買った券の払戻も含みます。差引回収額には未開封券の売上も含むため、確定利益ではありません。未開封は全期間で {d.pending.toLocaleString('ja-JP')} 枚。未開封の当たり結果は表示しません。</p>
    <p>開封済みの実績還元率：<strong>{d.returnPct === null ? '—（開封なし）' : `${d.returnPct.toFixed(1)}％`}</strong><span class="note">（払戻額 ÷ 開封した券の購入額。理論値は71.5％、短期間の実績は変動します）</span></p>
    <h3>当たったときの金額と、期間内の開封結果</h3>
    <div class="table-wrap" tabindex={0} role="region" aria-label="倍率ごとの払戻額と開封実績"><table class="compact"><thead><tr><th>結果</th><th class="num">今の価格での払戻例</th><th class="num">出た枚数</th><th class="num">実際の1枚あたり払戻</th><th class="num">実際の払戻合計</th></tr></thead><tbody>
      {multipliers.map(mult => { const row = d.prizes.find(p => p.multiplier === mult); return <tr><td>{mult === 0 ? 'はずれ（0倍）' : `${mult}倍${mult === 1 ? '（購入額が戻る）' : ''}`}</td><td class="num">{money(price * mult)}</td><td class="num">{row?.count ?? 0} 枚</td><td class="num">{row ? row.min === row.max ? money(row.min) : `${money(row.min)} 〜 ${money(row.max)}` : '—'}</td><td class="num">{money(row?.amount ?? 0)}</td></tr>; })}
    </tbody></table></div>
    <p class="note">払戻例は今の1枚 {money(price)} で計算。実績は購入当時の価格で集計します。払戻には購入額を含み、1倍は利用者の利益0です。</p>
    <h3>最近の当せん（選んだ期間の新しい順・20件）</h3>
    {d.recent.length ? <div class="table-wrap" tabindex={0} role="region" aria-label="最近の当せん金額"><table class="compact"><thead><tr><th>開封日時（日本時間）</th><th class="num">購入額</th><th class="num">払戻額</th><th class="num">利用者の差引</th></tr></thead><tbody>{d.recent.map(r => <tr><td>{date(r.openedAt!)}</td><td class="num">{money(r.price)}</td><td class="num">{money(r.payout)}</td><td class="num">{signed(r.payout-r.price)}</td></tr>)}</tbody></table></div> : <p class="note">この期間の当せんはありません。</p>}
  </section>;
}
export function FortuneAdminPage({ session, tab, cfg, round, rounds, finances, lottery, coinName, message }: { session: SessionView; tab: 'scratch' | 'lottery'; cfg: FortuneGamesConfig; round: State['round']; rounds: FortuneRound[]; finances: ScratchFinances; lottery: LotteryFinances; coinName: string; message?: string }) {
  const field = ([key, label, min, max]: readonly [keyof FortuneGamesConfig, string, number, number]) => <label>{label}<input type="number" name={key} value={cfg[key] as number} min={min} max={max} required /></label>;
  // タブごとに、そのタブの設定だけを保存する（ほかのタブの値はサーバーで今のまま残す）
  const form = (fields: readonly (readonly [keyof FortuneGamesConfig, string, number, number])[]) => <form method="post" action="/economy/fortune"><input type="hidden" name="_csrf" value={session.csrfToken} /><input type="hidden" name="tab" value={tab} />
    <fieldset class="fields" disabled={session.level !== 'guji'}><legend>宮司だけ変更できます</legend>
    <label><input type="checkbox" name="enabled" value="yes" checked={cfg.enabled} />購入を有効にする（スクラッチ・宝くじ共通）</label>
    {fields.map(field)}
    <button type="submit">保存する</button></fieldset>
  </form>;
  return <Layout title="スクラッチ・宝くじ" nav="fortune" session={session}><h1>✨ スクラッチ・週末宝くじ</h1>
    {message && <p role="status">{message}</p>}<p><a href="/lottery">宝くじ売り場へ</a></p>
    <nav class="tabs" aria-label="スクラッチと宝くじ">
      <a href="/economy/fortune?tab=scratch" class={tab === 'scratch' ? 'on' : ''} aria-current={tab === 'scratch' ? 'page' : undefined}>✨ スクラッチ</a>
      <a href="/economy/fortune?tab=lottery" class={tab === 'lottery' ? 'on' : ''} aria-current={tab === 'lottery' ? 'page' : undefined}>🎫 週末宝くじ</a>
    </nav>
    {tab === 'scratch' ? <>
      <p>スクラッチはその場で結果が出ます。設定はすぐに効きます。休止しても、買ってある券は開けられます。</p>
      <ScratchFinancePanel data={finances} price={cfg.scratchPrice} coin={coinName} />
      {form([['scratchPrice','スクラッチ1枚の銭',10,10000],['scratchDailyLimit','スクラッチ1人1日の上限',1,20]] as const)}
      <p>スクラッチの払戻：0倍55％・1倍30％・2倍12％・5倍2.5％・10倍0.5％。平均還元率71.5％。当選確率は固定です。</p>
    </> : <>
      <p>日曜21時（日本時間）に抽選。売れた券から1枚に、売上の一部＋運営の上乗せを自動入金します。販売0枚なら賞金を出しません。金額・上限は次の開催から変わります。休止しても購入済みの券は精算します。</p>
      <section class="card" id="lottery-finances"><h2>🎫 宝くじだけの売上（スクラッチは入れない）</h2>
        <div class="health-grid">
          <div class="health-item"><span class="health-label">これまでの売上</span><div class="health-value">{lottery.revenue.toLocaleString('ja-JP')} {coinName}</div><span class="note">抽選が終わった {lottery.rounds} 回・{lottery.sold.toLocaleString('ja-JP')} 枚</span></div>
          <div class="health-item"><span class="health-label">これまでの賞金</span><div class="health-value">{lottery.payout.toLocaleString('ja-JP')} {coinName}</div><span class="note">運営の上乗せもふくむ</span></div>
          <div class={`health-item ${lottery.net < 0 ? 'health-bad' : 'health-ok'}`}><span class="health-label">運営の収支（売上 − 賞金）</span><div class="health-value">{lottery.net > 0 ? '+' : ''}{lottery.net.toLocaleString('ja-JP')} {coinName}</div><span class="note">マイナスは運営の持ち出し</span></div>
          {round && <div class="health-item"><span class="health-label">販売中の回の売上</span><div class="health-value">{(round.price * round.sold).toLocaleString('ja-JP')} {coinName}</div><span class="note">{round.sold} 枚（抽選前なので上の合計には入れない）</span></div>}
        </div>
      </section>
      {round && <section class="card"><h2>販売中の回の固定条件</h2><p>{date(round.drawAt)}（日本時間） / 1枚{round.price} / 1人{round.perMember}枚 / 売上{round.returnPct}％＋{round.bonus} / 販売{round.sold}枚</p></section>}
      <section class="card"><h2>これまでの抽選（新しい順）</h2>
        {rounds.length ? <div class="table-wrap"><table class="compact"><thead><tr><th>抽選日時（日本時間）</th><th class="num">販売</th><th class="num">売上</th><th class="num">当選番号</th><th class="num">賞金</th><th class="num">運営の収支</th></tr></thead><tbody>
          {rounds.map(r => { const sales = r.price * r.sold; return <tr><td>{date(r.drawAt)}</td><td class="num">{r.sold} 枚</td><td class="num">{sales.toLocaleString('ja-JP')} {coinName}</td><td class="num">{roundWinners(r).length ? roundWinners(r).map(w => `${w.tier} ${w.number}番`).join('・') : '―'}</td><td class="num">{r.payout.toLocaleString('ja-JP')} {coinName}</td><td class="num">{(sales - r.payout).toLocaleString('ja-JP')} {coinName}</td></tr>; })}
        </tbody></table></div> : <p class="note">まだ抽選はありません。</p>}
      </section>
      <section class="card"><h2>🏆 等と賞金の分け方</h2>
        <p class="note">賞金の合計（売上の{cfg.lotteryReturnPct}％＋上乗せ {cfg.lotteryBonus.toLocaleString('ja-JP')} {coinName}）を、等ごとの割合で分け、本数で割ります。割合の合計は100％まで（残りは運営に残ります）。いつでも変えられ、<strong>次の回から</strong>効きます（販売中の回は、始めたときの等のまま）。名前を空にした行は使いません。</p>
        {round && <p>販売中の回の等：{roundTiers(round).map(t => `${t.name} ${t.count}本・${t.pct}％`).join(' ／ ')}（今の売上なら {tierPrizes(round).map(t => `${t.name} ${t.each.toLocaleString('ja-JP')} ${coinName}`).join('・')}）</p>}
        <form method="post" action="/economy/fortune/tiers"><input type="hidden" name="_csrf" value={session.csrfToken} />
          <fieldset class="fields" disabled={session.level !== 'guji'}><legend>宮司だけ変更できます</legend>
          <table class="compact"><thead><tr><th>名前</th><th>本数</th><th>賞金の割合（％）</th></tr></thead><tbody>
            {[0, 1, 2, 3, 4].map(k => { const t = cfg.lotteryTiers[k]; return <tr><td><input type="text" name={`tierName${k}`} maxlength={20} value={t?.name ?? ''} placeholder={`${k + 1}等`} /></td><td><input type="number" name={`tierCount${k}`} min={1} max={100} value={String(t?.count ?? 1)} /></td><td><input type="number" name={`tierPct${k}`} min={1} max={100} value={String(t?.pct ?? 10)} /></td></tr>; })}
          </tbody></table>
          <button type="submit">等を保存する</button></fieldset>
        </form>
      </section>
      {form([['lotteryPrice','宝くじ1枚の銭',10,10000],['lotteryLimit','宝くじ1人1回の上限',1,100],['lotteryReturnPct','宝くじ売上から賞金に戻す割合（％）',10,100],['lotteryBonus','宝くじに運営が上乗せする銭',0,1000000]] as const)}
    </>}
  </Layout>;
}
