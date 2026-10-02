import type { AdminSession, MarketListing, MarketOrder, MarketRequest } from '../../db/schema.js';
import { kindLabel } from '../../services/market.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

export const MARKET_FLASH: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  refunded: { text: '買った人に銭を戻しました。', kind: 'ok' },
  released: { text: '売った人に銭を渡しました（手数料を引いて）。', kind: 'ok' },
  removed: { text: '出品を取り下げました。', kind: 'ok' },
  request_closed: { text: '依頼を締め切りました。', kind: 'ok' },
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
  requests: MarketRequest[];
  names: Map<string, string>;
  feePercent: number;
  flash?: string;
}) {
  const { session } = props;
  const who = (id: string) => <a href={`/members/${id}`}>{props.names.get(id) ?? id}</a>;
  const title = (o: MarketOrder) =>
    o.requestId ? `📝 ${props.requests.find((r) => r.id === o.requestId)?.title ?? `依頼 #${o.requestId}`}` : (props.listings.find((l) => l.id === o.listingId)?.title ?? `出品 #${o.listingId}`);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const f = props.flash && Object.hasOwn(MARKET_FLASH, props.flash) ? MARKET_FLASH[props.flash] : undefined;
  return (
    <Layout title="市場" session={session} nav="market">
      <h1>🏮 市場</h1>
      {f && <p class={`flash ${f.kind}`}>{f.text}</p>}
      <p class="note">
        開業権利を持つ人の出品と、取引です（銭だけ。手数料 {props.feePercent}%）。買った人が「問題あり」や「🚫 来なかった」（通話の相手が予定の時刻に来なかった）を押した取引は、スレッドを確かめて、ここで「返金」か「売った人に渡す」を選んでください。性的なもの・本物のお金のやり取りの出品は取り下げてください。
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
                    <td class="wrap">
                      {title(o)}
                      {o.scheduledAt && <small class="reason">📅 予定 {fmtDateTime(o.scheduledAt)}</small>}
                      {o.rating !== null && (
                        <small class="reason">
                          ⭐ {stars(o.rating)}
                          {o.review ? `「${o.review}」` : ''}
                        </small>
                      )}
                    </td>
                    <td>{who(o.buyerId)}</td>
                    <td>{who(o.sellerId)}</td>
                    <td class="num">{o.price}</td>
                    <td>
                      <span class={`tag ${STATUS[o.status].cls}`}>{o.status === 'disputed' && o.disputeKind === 'noshow' ? '🚫 来なかった' : STATUS[o.status].label}</span>
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
                    <td>{kindLabel(l.category, l.subcategory)}</td>
                    <td class="wrap">
                      <strong>{l.title}</strong>
                      {l.description && <small class="reason">{l.description}</small>}
                    </td>
                    <td class="num">
                      {l.price}
                      {l.pricing === 'offer' && <small class="reason">から（提案）</small>}
                    </td>
                    <td>
                      {l.status === 'open' ? '受付中' : l.status === 'closed' ? '終了' : '取り下げ'}
                      {l.capacity > 0 && <small class="reason">上限 {l.capacity} 件</small>}
                    </td>
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
      <section class="card">
        <h2>📝 依頼の募集</h2>
        {props.requests.length === 0 ? (
          <p class="empty">まだありません。</p>
        ) : (
          <div class="table-wrap">
            <table class="compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>依頼した人</th>
                  <th>種類</th>
                  <th>内容</th>
                  <th class="num">予算</th>
                  <th>状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {props.requests.map((r) => (
                  <tr class={r.status === 'open' ? '' : 'revoked'}>
                    <td>{r.id}</td>
                    <td>{who(r.requesterId)}</td>
                    <td>{kindLabel(r.category, r.subcategory)}</td>
                    <td class="wrap">
                      <strong>{r.title}</strong>
                      {r.description && <small class="reason">{r.description}</small>}
                    </td>
                    <td class="num">{r.budget}</td>
                    <td>{r.status === 'open' ? '募集中' : r.status === 'matched' ? '決まった' : '締め切り'}</td>
                    <td>
                      {r.status === 'open' && (
                        <form method="post" action={`/market/requests/${r.id}/close`}>
                          <input type="hidden" name="_csrf" value={session.csrfToken} />
                          <button type="submit" class="danger">
                            締め切る
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
