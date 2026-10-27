import type { AdminSession } from '../../db/schema.js';
import type { NavLayout } from '../../services/navLayout.js';
import { Layout, NAV_CATALOG, NAV_DEFAULT_GROUPS } from './layout.js';

/** 🧭 左のメニューの並び方（宮司が全員分を決める） */
export function NavOrderPage(p: { session: AdminSession; layout?: NavLayout; flash?: string }) {
  const data = { catalog: NAV_CATALOG, groups: p.layout?.groups ?? NAV_DEFAULT_GROUPS, defaults: NAV_DEFAULT_GROUPS };
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  return <Layout title="メニューの並び方" nav="navorder" session={p.session} scripts={['nav-order.js']}>
    <h1>🧭 メニューの並び方</h1>
    {p.flash === 'reset' && <p role="status">もとの並びに戻しました。</p>}
    <p>左のメニューのページを、ドラッグ＆ドロップで並べ替えたり、ほかのカテゴリへ移したりできます。カテゴリの名前の変更・足す・消すもできます。運営みんなのメニューが同じ並びになります。最後に「保存する」を押してください。</p>
    <p class="note">見られるページは今までどおりです（宮司だけのページ・見られるページを選ばれている人には、ほかのページは出ません）。あとで足されたページは、もとのカテゴリの後ろに出ます。</p>
    <div class="nav-order-app" data-nav={JSON.stringify(data)} data-csrf={p.session.csrfToken}><noscript><p class="flash warn">並べ替えには JavaScript が必要です。</p></noscript></div>
    <form method="post" action="/nav-order/reset" class="inline">{csrf}<button type="submit" class="danger-link">もとの並びに戻す</button></form>
  </Layout>;
}
