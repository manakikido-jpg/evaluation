import { catalog, catalogCategories, catalogElements, findCatalogCards, type CatalogCard } from '../../services/shinpu/catalog.js';
import { assetUrl } from '../assets.js';

const ROOT = '/casino/shinpu/cards';
const image = (card: CatalogCard, size: 'cards' | 'thumbnails') => assetUrl(`shinpu-catalog-${size}-${card.id}.webp`);
export function ShinpuCatalogPage({ query = '', category = '', element = '', page = 1, card }: {
  query?: string; category?: string; element?: string; page?: number; card?: CatalogCard;
}) {
  const found = findCatalogCards(query, category, element);
  const pages = Math.max(1, Math.ceil(found.length / 24));
  const current = Math.min(pages, Math.max(1, page));
  const pageUrl = (n: number) => `${ROOT}?${new URLSearchParams({ q: query, category, element, page: String(n) })}`;
  return <html lang="ja"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{card ? `${card.name} | 神符合戦` : '神器図鑑 | 神符合戦'}</title>
    <link rel="stylesheet" href={assetUrl('shinpu-catalog.css')} /></head><body><main>
    <nav><a href="/casino/shinpu">対戦の部屋へ</a> / <a href={ROOT}>神器図鑑</a></nav>
    <h1>{card ? card.name : '神器図鑑'}</h1>
    <p>画像完成 {catalog.length}／237枚（100.0％）。対戦への追加は準備中です。現在の対戦は試作15種類で遊べます。</p>
    {card ? <article class="detail">
      <img src={image(card, 'cards')} width="900" height="1200" alt={`${card.id} ${card.name}の完成カード`} />
      <section><h2>{card.id} {card.name}</h2><p>{card.category} / {card.element} / {card.rarity}</p>
        <p>{card.stackable ? '＋付き攻撃札 / ' : ''}攻撃 {card.attack} / 防御 {card.defense} / 回復 {card.heal} / 消費MP {card.mpCost}</p>
        <p>{card.effect}</p><p>制作時の仕様です。試作の同名札とは数値や効果が異なる場合があります。</p>
        <a href={ROOT}>一覧へ戻る</a></section>
    </article> : <>
      <form method="get" action={ROOT}>
        <label>名前・ID・効果<input type="search" name="q" value={query} maxLength={100} /></label>
        <label>種類<select name="category"><option value="">すべて</option>{catalogCategories.map(c => <option value={c} selected={category === c}>{c}</option>)}</select></label>
        <label>属性<select name="element"><option value="">すべて</option>{catalogElements.map(e => <option value={e} selected={element === e}>{e}</option>)}</select></label>
        <button type="submit">絞り込む</button><a href={ROOT}>条件を戻す</a>
      </form>
      <p role="status">{found.length}枚 / {current}ページ目（全{pages}ページ）</p>
      <div class="grid">{found.slice((current - 1) * 24, current * 24).map(c => <article>
        <a href={`${ROOT}/${c.id}`}><img src={image(c, 'thumbnails')} width="360" height="480" loading="lazy" decoding="async" alt={`${c.name}の完成カード`} />
          <h2>{c.stackable ? '＋ ' : ''}{c.name}</h2></a><p>{c.id} / {c.category} / {c.element}</p>
        <p>攻撃 {c.attack} / 防御 {c.defense} / MP {c.mpCost}</p>
      </article>)}</div>
      {!found.length && <p>条件に合う札がありません。名前の一部や別の条件で探してください。</p>}
      <nav aria-label="ページ移動">{current > 1 && <a href={pageUrl(current - 1)}>前の24枚</a>}<span>{current} / {pages}</span>{current < pages && <a href={pageUrl(current + 1)}>次の24枚</a>}</nav>
    </>}
  </main></body></html>;
}
