import type { AdminSession } from '../../db/schema.js';
import type { MemberAlt } from '../../services/memberAlts.js';
import { Layout } from './layout.js';

const MSG: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  approved: { text: '承認しました（サブの銭は本アカウントへ移しました）。', kind: 'ok' },
  removed: { text: '外しました。', kind: 'ok' },
  added: { text: '登録しました。', kind: 'ok' },
  ok: { text: '登録しました。', kind: 'ok' },
  invalid: { text: 'ユーザー ID を確かめてください（17〜20 桁の数字）。', kind: 'warn' },
  self: { text: 'サブと本アカウントに、同じ人は選べません。', kind: 'warn' },
  exists: { text: 'その人は、もうサブとして登録・申告されています。', kind: 'warn' },
  main_is_alt: { text: '本アカウントが、だれかのサブになっています。', kind: 'warn' },
  alt_has_alts: { text: 'サブにする人に、もうサブがいます。', kind: 'warn' },
  staff_alt: { text: '運営のサブアカウントは、ここでは登録できません。', kind: 'warn' },
};
const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/** 🔗 メンバーのサブアカウント（申告の承認・一覧・直接の登録） */
export function MemberAltsPage(p: { session: AdminSession; alts: MemberAlt[]; names: Map<string, string>; msg?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const flash = p.msg ? MSG[p.msg] : undefined;
  const name = (id: string) => <a href={`/members/${id}`}>{p.names.get(id) ?? id}</a>;
  const pending = p.alts.filter((a) => a.status === 'pending');
  const approved = p.alts.filter((a) => a.status === 'approved');
  return <Layout title="サブアカウント" nav="members" session={p.session}>
    <div class="page-head"><h1>🔗 サブアカウント</h1></div>
    {flash && <p class={`flash ${flash.kind}`}>{flash.text}</p>}
    <p class="note">サブアカウントは、申告して運営が承認すれば使えます（申告しないサブはルール違反）。サブの人は Discord で <code>/サブ垢 申告</code> を打ち、本アカウントを選びます。承認したサブは、銭が入らず、朱印を押せず・押されず、招待の記録とお礼に入りません。承認したとき、サブが持っていた銭は本アカウントへ移します。</p>

    <section class="card">
      <h2>📨 申告中（{pending.length}件）</h2>
      {pending.length ? <div class="table-wrap"><table>
        <thead><tr><th>申告</th><th>サブ</th><th>本アカウント</th><th>メモ</th><th>運営</th></tr></thead>
        <tbody>{pending.map((a) => <tr>
          <td>{fmt(a.createdAt)}</td><td>{name(a.altId)}</td><td>{name(a.mainId)}</td><td>{a.note}</td>
          <td>
            <form method="post" action={`/alts/${a.altId}/approve`}>{csrf}<button type="submit" class="ok">承認する</button></form>
            <form method="post" action={`/alts/${a.altId}/remove`}>{csrf}<button type="submit" class="danger">却下する</button></form>
          </td>
        </tr>)}</tbody>
      </table></div> : <p class="note">申告はありません。</p>}
    </section>

    <section class="card">
      <h2>✅ 承認ずみ（{approved.length}件）</h2>
      {approved.length ? <div class="table-wrap"><table>
        <thead><tr><th>承認</th><th>サブ</th><th>本アカウント</th><th>メモ</th><th>運営</th></tr></thead>
        <tbody>{approved.map((a) => <tr>
          <td>{a.decidedAt ? fmt(a.decidedAt) : ''}</td><td>{name(a.altId)}</td><td>{name(a.mainId)}</td><td>{a.note}</td>
          <td><form method="post" action={`/alts/${a.altId}/remove`}>{csrf}<button type="submit" class="danger">サブから外す</button></form></td>
        </tr>)}</tbody>
      </table></div> : <p class="note">まだいません。</p>}
    </section>

    <form method="post" action="/alts/add" class="card">
      {csrf}
      <h2>➕ 運営が登録する</h2>
      <p class="note">申告がなくても、運営が確かめたサブを登録できます（すぐ承認ずみになり、サブの銭は本アカウントへ移します）。</p>
      <div class="fields">
        <label class="field"><span>サブのユーザー ID</span><input name="altId" required pattern="\d{17,20}" inputmode="numeric" /></label>
        <label class="field"><span>本アカウントのユーザー ID</span><input name="mainId" required pattern="\d{17,20}" inputmode="numeric" /></label>
        <label class="field"><span>メモ（なくても大丈夫）</span><input name="note" maxlength={200} /></label>
      </div>
      <button type="submit">登録する</button>
    </form>
  </Layout>;
}

/** メンバーの詳細に出す、サブ・本アカウントの印 */
export function MemberAltLinks(p: { memberId: string; asAlt?: MemberAlt; alts: MemberAlt[] }) {
  if (!p.asAlt && !p.alts.length) return null;
  return <section class="card" id="sec-member-alt">
    <h2>🔗 サブアカウント</h2>
    {p.asAlt && <p>この人は <a href={`/members/${p.asAlt.mainId}`}>{p.asAlt.mainId}</a> のサブです（{p.asAlt.status === 'approved' ? '承認ずみ' : '申告中'}）。</p>}
    {p.alts.length > 0 && <p>サブ: {p.alts.map((a, n) => <>{n ? '・' : ''}<a href={`/members/${a.altId}`}>{a.altId}</a>（{a.status === 'approved' ? '承認ずみ' : '申告中'}）</>)}</p>}
    <p class="note"><a href="/alts">🔗 サブアカウントの一覧へ</a></p>
  </section>;
}
