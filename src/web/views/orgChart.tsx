import type { AdminSession } from '../../db/schema.js';
import { WEB_PAGES } from '../../config.js';
import type { OrgChart, OrgPerson } from '../../services/orgChart.js';
import { Layout } from './layout.js';

export type OrgRoleGroup = { id: string; name: string; members: OrgPerson[] };

/** 🏯 運営の組織図（宮司は自由に編集、ほかの運営は見るだけ） */
export function OrgChartPage(p: { session: AdminSession; chart: OrgChart; groups: OrgRoleGroup[]; people: Record<string, OrgPerson>; roles: { id: string; name: string }[]; canEdit: boolean }) {
  const data = { chart: p.chart, groups: p.groups, people: p.people, roles: p.roles, pages: WEB_PAGES.map(x => ({ key: x.key, label: x.label })), canEdit: p.canEdit };
  return <Layout title="組織図" nav="org" session={p.session} scripts={['org.js']} wide>
    <h1>🏯 組織図</h1>
    {p.canEdit
      ? <details class="org-help"><summary>使い方</summary><ul>
        <li>左の人を四角へドラッグ＆ドロップで置きます。四角の中の人は、ほかの四角へドラッグで移せます。</li>
        <li>四角は上の帯をドラッグで動かし、右下の角で大きさを変えます。名前はダブルクリックで変えます。</li>
        <li>線: 四角のまわり（下・右・左・上）の「●」から、つなぎたい四角へドラッグします。線をダブルクリックすると曲がり角が増え、角はドラッグで動かせます（角を右クリック・ダブルクリックで消す）。</li>
        <li>四角を選ぶと、右の欄の「この四角の役職」で、その四角だけの役職（統括・主典など）を作れます。</li>
        <li><kbd>Shift</kbd> を押しながら動かすと、まっすぐ（横か縦だけ）に動きます。大きさを変えるときは形をそのままにします。</li>
        <li>何もないところをドラッグで画面を動かし、<kbd>Ctrl</kbd>＋ホイールか ＋−で大きさを変えます。</li>
        <li><kbd>Delete</kbd> で選んだものを消す、<kbd>Ctrl</kbd>+<kbd>Z</kbd> で戻す、<kbd>Ctrl</kbd>+<kbd>Y</kbd> でやり直す、<kbd>Ctrl</kbd>+<kbd>D</kbd> で四角を複製。矢印キーで少しずつ動かせます。</li>
      </ul></details>
      : <p>見るだけです（変えられるのは宮司だけ）。</p>}
    <p class="note">Discord のロールは変わりません。四角を選ぶと右に出る「社務所Webで使えるページ」を選ぶと、その四角に置いた人がログインしてそのページを使えます（宮司・神職はもとから全部）。</p>
    <div class="org-app" data-org={JSON.stringify(data)} data-csrf={p.session.csrfToken}>
      <noscript><p class="flash warn">組織図には JavaScript が必要です。</p></noscript>
    </div>
  </Layout>;
}
