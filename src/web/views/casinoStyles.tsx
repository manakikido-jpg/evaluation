import type { GuildConfig } from '../../config.js';
import { STYLE_ITEMS, STYLE_SLOTS, activeStyles, styleChances, styleItem, type StyleSlot, type StyleState } from '../../services/casino/styles.js';
import { CasinoLayout, type CasinoMe } from './casino.js';
const Hidden = (p: { me: CasinoMe }) => <input type="hidden" name="_csrf" value={p.me.session.csrfToken} />;
export function Wardrobe(p: { me: CasinoMe; state: StyleState; preview?: string; now: Date; message?: string }) {
  const preview = styleItem(p.preview ?? '');
  const styles = activeStyles(p.state, p.now);
  const me = preview?.slot ? { ...p.me, styleUntil: undefined, styles: { ...styles, [preview.slot]: preview.key } } : p.me;
  return (
    <CasinoLayout title="カジノの着せ替え" me={me} back>
      <h1 class="c-h1">🪭 カジノの着せ替え</h1>
      <p class="c-muted">背景・チップ・カード・動き・音は自分の画面。卓のふち・席の飾り・称号は同じ卓のみんなにも見えます。</p>
      {p.message && <p role="status">{p.message}</p>}
      <section class="cs-preview" aria-label="見た目の見本">
        <span class="cs-emblem">{styleItem(me.styles?.ornament ?? '')?.emoji ?? '🌸'}</span>
        <b>{p.me.session.displayName}</b>
        <span>{styleItem(me.styles?.title ?? '')?.name}</span>
        <span class="pc back" aria-label="カードの裏"></span>
        <span class="cs-chip">💎 100</span>
        {preview && <p>見本：{preview.name}（まだ装備していません）</p>}
        {preview && ['effect', 'sound'].includes(preview.slot ?? '') && (
          <button type="button" class="c-btn" data-style-demo>
            勝ったときの見本
          </button>
        )}
      </section>
      <p>
        🎟 お試し券：{p.state.tickets}枚　<a href="/casino/style-gacha">🎰 景品を引く</a>　<a href="/casino/wardrobe">装備中の見た目に戻す</a>
      </p>
      {p.state.trialUntil && p.state.trialUntil > p.now && (
        <p>
          お試し中：{styleItem(p.state.trialKey ?? '')?.name} · {p.state.trialUntil.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）まで
        </p>
      )}
      {Object.entries(STYLE_SLOTS).map(([slot, label]) => (
        <section class="cs-section">
          <h2>{label}</h2>
          <form method="post" action="/casino/wardrobe/equip">
            <Hidden me={p.me} />
            <input type="hidden" name="slot" value={slot} />
            <input type="hidden" name="key" value="" />
            <button class="c-btn c-btn-ghost" type="submit">
              はずす・標準に戻す
            </button>
          </form>
          <div class="cs-grid">
            {STYLE_ITEMS.filter((i) => i.slot === slot).map((i) => {
              const owned = p.state.owned.includes(i.key);
              return (
                <article class={`cs-item cs-${i.key}${styles[slot as StyleSlot] === i.key ? ' equipped' : ''}`}>
                  <span class="cs-icon">{i.emoji}</span>
                  <h3>{i.name}</h3>
                  <p>{i.note}</p>
                  <small>{styles[slot as StyleSlot] === i.key ? '装備中' : owned ? '所持・期限なし' : '未所持'}</small>
                  <a href={`/casino/wardrobe?preview=${i.key}`} class="c-btn c-btn-ghost">
                    見本を見る
                  </a>
                  {(owned || (['background', 'table'].includes(slot) && p.state.tickets > 0)) && (
                    <form method="post" action="/casino/wardrobe/equip">
                      <Hidden me={p.me} />
                      <input type="hidden" name="slot" value={slot} />
                      <input type="hidden" name="key" value={i.key} />
                      {!owned && <input type="hidden" name="trial" value="1" />}
                      <button type="submit" class="c-btn">
                        {owned ? '装備する' : '券1枚で24時間お試し'}
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </CasinoLayout>
  );
}
export function StyleGachaPage(p: { me: CasinoMe; state: StyleState; g: GuildConfig['casinoGacha']; requestId: string; results?: string[]; message?: string }) {
  const chances = styleChances(p.g, p.state.owned);
  const complete = STYLE_ITEMS.filter((i) => i.slot).every((i) => p.state.owned.includes(i.key));
  return (
    <CasinoLayout title="勝負の御籤" me={p.me} back>
      <section class="cs-banner">
        <span>🎰</span>
        <h1>勝負の御籤</h1>
        <p>祈願所 · カジノの景品ガチャ</p>
        <b>自分だけの遊技場を、彩ろう。</b>
      </section>
      {p.message && <p role="status">{p.message}</p>}
      {p.results && (
        <section class="cs-section" role="status">
          <h2>今回の景品</h2>
          <div class="cs-grid">
            {p.results.map((key) => {
              const i = styleItem(key)!;
              return (
                <article class="cs-item">
                  <span class="cs-icon">{i.emoji}</span>
                  <h3>{i.name}</h3>
                  <p>{i.slot ? '所持品に入りました。着せ替えで装備できます。' : i.note}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <p>
        1回 {p.g.price.toLocaleString('ja-JP')}
        {p.me.coin.name} · 10連 {(p.g.price * 10).toLocaleString('ja-JP')}
        {p.me.coin.name}
      </p>
      <p>
        {complete
          ? '見た目の品は全部そろいました！見た目の品の分は、お試し券になります。'
          : `あと${Math.max(1, p.g.pity - p.state.pity)}回以内に、未所持の見た目の品を保証（${p.g.pity}回の天井）`}
      </p>
      <form method="post" action="/casino/style-gacha/draw" class="c-actions">
        <Hidden me={p.me} />
        <input type="hidden" name="requestId" value={p.requestId} />
        {[1, 10].map((n) => (
          <button class="c-btn" type="submit" name="times" value={String(n)} disabled={!p.g.enabled || p.me.balance < n * p.g.price}>
            {n === 1 ? '1回引く' : '10連で引く'}
          </button>
        ))}
        <a class="c-btn c-btn-ghost" href="/casino/wardrobe">
          着せ替えへ
        </a>
      </form>
      {!p.g.enabled && <p>今はお休み中です。中身は下で見られます。</p>}
      <h2>中身と、今の出る割合</h2>
      <p>見た目の品は期限なし・同じ品は出ません。所持が増えると残りの品の割合が上がります。天井の回は未所持の見た目の品の中で均等です。物御籤の券・セール・天井とは別です。</p>
      <div class="cs-grid">
        {chances.map((i) => (
          <article class="cs-item">
            <span class="cs-icon">{i.emoji}</span>
            <h3>{i.name}</h3>
            <b>{i.chance.toLocaleString('ja-JP', { maximumFractionDigits: 3 })}％</b>
            <p>{i.note}</p>
            <small>{i.slot ? (p.state.owned.includes(i.key) ? '所持済み・出ません' : '期限なし') : '何枚でも当たります'}</small>
            {i.slot && <a href={`/casino/wardrobe?preview=${i.key}`}>見本を見る</a>}
          </article>
        ))}
      </div>
    </CasinoLayout>
  );
}
