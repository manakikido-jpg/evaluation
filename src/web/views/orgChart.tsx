import type { AdminSession } from '../../db/schema.js';
import { WEB_PAGES } from '../../config.js';
import type { OrgChart } from '../../services/orgChart.js';
import { Layout } from './layout.js';

export type OrgMember = { id: string; name: string };
export type OrgRankGroup = { name: string; members: OrgMember[] };

/** 🏯 運営の組織図（宮司は並べ替え・編集、ほかの運営は見るだけ） */
export function OrgChartPage(p: { session: AdminSession; chart: OrgChart; groups: OrgRankGroup[]; names: Record<string, string>; canEdit: boolean }) {
  const data = { chart: p.chart, groups: p.groups, names: p.names, pages: WEB_PAGES.map(x => ({ key: x.key, label: x.label })), canEdit: p.canEdit };
  return <Layout title="組織図" nav="org" session={p.session} scripts={['org.js']}>
    <h1>🏯 組織図</h1>
    <p>運営の部署と担当を図にします。{p.canEdit ? '左の人を部署へドラッグ＆ドロップで置きます。部署の名前・段階（統括・副統括など）の名前は自由に変えられます。最後に「保存する」を押してください。' : '見るだけです（変えられるのは宮司だけ）。'}</p>
    <p class="note">Discord のロールは変わりません。部署ごとに「社務所Webで使えるページ」を選ぶと、その部署に置いた人がログインしてそのページを使えます（宮司・神職はもとから全部）。</p>
    <div class="org-app" data-org={JSON.stringify(data)} data-csrf={p.session.csrfToken}>
      <noscript><p class="flash warn">組織図には JavaScript が必要です。</p></noscript>
    </div>
  </Layout>;
}
