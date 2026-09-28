import type { AdminSession, MarketListing, MarketOrder } from '../../db/schema.js';
import { MARKET_CATEGORIES, type MarketCategory } from '../../services/market.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const MARKET_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  refunded: { text: '買った人に銭を戻しました。', kind: 'ok' },
  released: { text: '売った人に銭を渡しました（手数料を引いて）。', kind: 'ok' },
  removed: { text: '出品を取り下げました。', kind: 'ok' },
  done_already: { text: 'この取引・出品はもう終わっています。', kind: 'warn' },
};

const STATUS: Record<MarketOrder['status'], { label: string; cls: string }> = {
  paid: { label: '預かり中', cls: 'gray' },
  disputed: { label: '⚠️ 問題あり', cls: 'red' },
  completed: { label: '完了', cls: 'green' },
  refunded: { label: '返金', cls: 'gray' },
};

export function MarketPage(props: {
  session: AdminSession;
  orders: MarketOrder[];
  listings: MarketListing[];
  names: Map<string, string>;
  feePercent: number;
  flash?: string;
}) {
  const { session } = props;
  const who = (id: string) => <a href={`/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const title = (id: number) => props.listings.find((l) => l.id === id)?.title ?? `出品 #${id}`;
  const f = props.flash && Object.hasOwn(MARKET_FLASH, props.flash) ? MARKET_FLASH[props.flash] : undefined;
  return (
    <Layout title="市場" session={session} nav="market">
      <h1>🏮 市場</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        開業権利を持つ人の出品と、取引です（銭だけ。手数料 {props.feePercent}%）。買った人が「問題あり」を押した取引は、ここで「返金」か「売った人に渡す」を選んでください。性的なもの・本物のお金のやり取りの出品は取り下げてください。
      </p>
      <section class="card">
        <h2>取引</h2>
        {props.orders.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <div class="table-wrap">
            <table class="compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>日時</th>
                  <th>品物</th>
                  <th>買った人</th>
                  <th>売った人</th>
                  <th class="num">値段</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.orders.map((o) => (
                  <tr>
                    <td>{o.id}</td>
                    <td>{fmtDateTime(o.createdAt)}</td>
                    <td class="wrap">{title(o.listingId)}</td>
                    <td>{who(o.buyerId)}</td>
                    <td>{who(o.sellerId)}</td>
                    <td class="num">{o.price}</td>
                    <td>
                      <span class={`tag ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                    </td>
                    <td>
                      {(o.status === 'disputed' || o.status === 'paid') && (
                        <div class="inline-actions">
                          <form method="post" action={`/market/orders/${o.id}/refund`}>
                            <input type="hidden" name="_csrf" value={session.csrfToken} />
                            <button type="submit">返金</button>
                          </form>
                          <form method="post" action={`/market/orders/${o.id}/release`}>
                            <input type="hidden" name="_csrf" value={session.csrfToken} />
                            <button type="submit" class="ok">
                              売った人に渡す
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section class="card">
        <h2>出品</h2>
        {props.listings.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <div class="table-wrap">
            <table class="compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>出品した人</th>
                  <th>種類</th>
                  <th>品名・説明</th>
                  <th class="num">値段</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.listings.map((l) => (
                  <tr class={l.status === 'open' ? '' : 'revoked'}>
                    <td>{l.id}</td>
                    <td>{who(l.sellerId)}</td>
                    <td>{MARKET_CATEGORIES[l.category as MarketCategory]?.label ?? l.category}</td>
                    <td class="wrap">
                      <strong>{l.title}</strong>
                      {l.description && <small class="reason">{l.description}</small>}
                    </td>
                    <td class="num">{l.price}</td>
                    <td>{l.status === 'open' ? '受付中' : l.status === 'closed' ? '終了' : '取り下げ'}</td>
                    <td>
                      {l.status === 'open' && (
                        <form method="post" action={`/market/listings/${l.id}/remove`}>
                          <input type="hidden" name="_csrf" value={session.csrfToken} />
                          <button type="submit" class="danger">
                            取り下げ
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
