import type { KeibaHorseRow } from '../../db/schema.js';
import { KB_AURAS, KB_AURA_PRICE, KB_CUSTOM_AURA_PRICE, KB_DEFAULT_OUTFIT } from '../../services/casino/keibaOutfit.js';
import { CasinoLayout, Msg, type CasinoMe } from './casino.js';

/** 自分の馬を選んでから色を確認する専用の売り場。選択だけでは支払わない。 */
export function KbAuraShopPage(p: { me: CasinoMe; horses: KeibaHorseRow[]; selected?: KeibaHorseRow; invalid?: boolean; msg?: string }) {
  const h = p.selected;
  return <CasinoLayout title="馬のオーラショップ" me={p.me}>
    <p class="c-back"><a href="/casino/wardrobe">← 着せ替え</a> ／ <a href="/casino/keiba/stable">馬主の部屋</a></p>
    <h1 class="c-h1">✨ 馬のオーラショップ</h1>
    <ol class="kb-aura-steps" aria-label="購入の流れ"><li>付ける馬を選ぶ</li><li>色・見本・金額を確認</li><li>購入して装備</li></ol>
    {p.msg && <Msg msg={p.msg} />}
    {p.invalid && <p class="c-note" role="alert">選んだ馬が見つかりません。自分の馬を選び直してください。</p>}
    <p class="c-note">購入したオーラ1個は、選んだ1頭専用です。別の馬に同じ色を付ける場合は、その馬の分を購入してください。</p>
    {!p.horses.length ? <section class="c-panel"><h2>まず馬を迎えましょう</h2><p>オーラを付けられる自分の馬がまだいません。</p><a class="c-btn" href="/casino/keiba/stable">馬主の部屋で馬を迎える</a></section> : <>
      <section class="c-panel"><h2>1. オーラを付ける馬</h2>
        <form method="get" action="/casino/keiba/aura-shop" class="kb-aura-target">
          <label>自分の馬<select name="horseId" required><option value="">馬を選んでください</option>{p.horses.map(horse => <option value={horse.id} selected={h?.id === horse.id}>{horse.name}{horse.retiredAt ? '（引退）' : ''}</option>)}</select></label>
          <button type="submit" class="c-btn">この馬で色を選ぶ</button>
        </form><p class="c-muted">馬を選ぶだけでは支払いは発生しません。</p><p class="c-note" data-aura-switch-note hidden role="status">選んだ馬で進むには「この馬で色を選ぶ」を押してください。</p>
      </section>
      {h ? <section class="c-panel kb-aura-shop" aria-labelledby="aura-horse-name" data-aura-horse-id={h.id}>
        <h2 id="aura-horse-name">2. {h.name} の色と見本</h2>
        <p class="c-muted">固定色は1色3,500銭で購入後、この馬で何度でも装備できます。カスタムは色を変更するたび7,000銭。黄金は景品専用のため販売しません。馬を譲ると購入済みの固定色も引き継がれます。</p>
        <form method="post" action={`/casino/keiba/stable/${h.id}/aura`} class="kb-aura-form">
          <input type="hidden" name="_csrf" value={p.me.session.csrfToken} />
          <input type="hidden" name="revision" value={h.outfit?.auraRevision ?? 0} />
          <canvas class="kb-outfit-preview" width="480" height="220" data-horse={JSON.stringify({ no: h.id, coat: h.coat, silk: h.silk, outfit: h.outfit ?? KB_DEFAULT_OUTFIT })} aria-label={`${h.name}のオーラの購入前見本`}>オーラの見本</canvas>
          <label class="field">オーラ<select name="aura">
            <option value="none" selected={!h.outfit?.aura} data-price="0">なし・外す（無料）</option>
            {Object.entries(KB_AURAS).map(([key, aura]) => {
              const owned = h.outfit?.auraOwned?.includes(key as keyof typeof KB_AURAS);
              return <option value={key} selected={h.outfit?.aura?.key === key} data-body={aura.body} data-glow={aura.glow} data-price={owned ? 0 : KB_AURA_PRICE}>{aura.name}（{owned ? '購入済み・装備無料' : '3,500銭'}）</option>;
            })}
            <option value="custom" selected={h.outfit?.aura?.key === 'custom'} data-price={KB_CUSTOM_AURA_PRICE}>カスタム（色変更ごと7,000銭）</option>
          </select></label>
          <div class="kb-aura-colors">
            <label>カスタム・馬の色<input type="color" name="body" value={h.outfit?.aura?.body ?? KB_AURAS.violet.body} /></label>
            <label>カスタム・光の色<input type="color" name="glow" value={h.outfit?.aura?.glow ?? KB_AURAS.violet.glow} /></label>
          </div>
          <p class="c-note" data-aura-price aria-live="polite">固定色3,500銭・カスタムの色変更7,000銭。購入済み固定色の装備と取り外しは無料です。</p>
          <p class="c-note">購入先：<strong>{h.name}</strong>（この1頭のみ）</p>
          <label class="c-check"><input type="checkbox" name="confirm" value="yes" required /> 見本と支払額を確認しました</label>
          <button class="c-btn c-btn-gold">この内容で購入・装備する</button>
        </form>
      </section> : <p class="c-note">先にオーラを付ける馬を選んでください。</p>}
    </>}
  </CasinoLayout>;
}
