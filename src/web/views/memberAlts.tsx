import type { AdminSession } from '../../db/schema.js';
import type { MemberAlt } from '../../services/memberAlts.js';
import { Layout } from './layout.js';

const MSG: Record<string, { text: string; kind: 'ok' | 'warn' }> = {
  settings: { text: '設定を保存しました。', kind: 'ok' },
  guji: { text: '設定を変えられるのは宮司だけです。', kind: 'warn' },
  approved: { text: '承認しました（サブの銭は本アカウントへ移しました）。', kind: 'ok' },
  approved_kept: { text: '承認しました（本アカウント側の申告なので、サブの銭は移していません）。', kind: 'ok' },
  removed: { text: '外しました。', kind: 'ok' },
  added: { text: '登録しました。', kind: 'ok' },
  ok: { text: '登録しました。', kind: 'ok' },
  invalid_roles: { text: 'ロールは、サーバーにあるものを 5 つまで選んでください。', kind: 'warn' },
  invalid: { text: 'ユーザー ID を確かめてください（17〜20 桁の数字）。', kind: 'warn' },
  self: { text: 'サブと本アカウントに、同じ人は選べません。', kind: 'warn' },
  exists: { text: 'その人は、もうサブとして登録・申告されています。', kind: 'warn' },
  main_is_alt: { text: '本アカウントが、だれかのサブになっています。', kind: 'warn' },
  alt_has_alts: { text: 'サブにする人に、もうサブがいます。', kind: 'warn' },
  staff_alt: { text: '運営のサブアカウントは、ここでは登録できません。', kind: 'warn' },
};
/** 申告した人（サブ本人・本アカウント側・運営） */
const whoDeclared = (a: MemberAlt) => (a.verified ? '合言葉（両方確認ずみ）' : a.requestedBy === a.altId ? 'サブ本人' : a.requestedBy === a.mainId ? '本アカウント側' : '運営');
const fmt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

/** 🔗 メンバーのサブアカウント（申告の承認・一覧・直接の登録） */
export function MemberAltsPage(p: { session: AdminSession; alts: MemberAlt[]; names: Map<string, string>; msg?: string; requireApproval?: boolean; guji?: boolean; joinRoleIds?: string[]; roles?: { id: string; name: string }[] }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const flash = p.msg ? MSG[p.msg] : undefined;
  const name = (id: string) => <a href={`/members/${id}`}>{p.names.get(id) ?? id}</a>;
  const pending = p.alts.filter((a) => a.status === 'pending');
  const approved = p.alts.filter((a) => a.status === 'approved');
  return <Layout title="サブアカウント" nav="alts" session={p.session}>
    <div class="page-head"><h1>🔗 サブアカウント</h1></div>
    {flash && <p class={`flash ${flash.kind}`}>{flash.text}</p>}
    <p class="note">サブアカウントは、申告して運営が承認すれば使えます（申告しないサブはルール違反）。申告は、サブの人が <code>/サブ垢 申告</code> で本アカウントを選ぶか、本アカウントの人が <code>/サブ垢 本アカから申告</code> でサブと理由を入れます（パネルのボタンでも。まだサーバーに入っていないアカウントも申請できます）。承認したサブは、銭が入らず、朱印を押せず・押されず、招待の記録とお礼に入りません。承認したとき、サブが持っていた銭は本アカウントへ移します（本アカウント側が申告したものは、他人のアカウントの銭を取れないように、移しません）。</p>

    <form method="post" action="/alts/settings" class="card">
      {csrf}
      <h2>🔑 合言葉でつなぐ</h2>
      <p class="note">本アカウントで合言葉をもらい（<code>/サブ垢 合言葉</code>・パネルのボタン）、サブのアカウントで入れる（<code>/サブ垢 合言葉入力</code>）と、両方の操作を確かめたことになります。つないだサブの銭は、本アカウントへ移します。</p>
      <label><input type="checkbox" name="requireApproval" value="yes" checked={p.requireApproval} disabled={!p.guji} /> 合言葉が合っても、運営が承認するまでつながない（はじめは、その場で自動でつなぐ）</label>
      <fieldset><legend>🔰 承認ずみのサブが、サーバーに入ったとき自動で付けるロール（縁人など・5つまで）</legend>
        <p class="note">本アカウントが先に申請して、運営が承認したアカウントが、あとからサーバーに入ると、自動でサブとして扱い、ここで選んだロールを付けます（案内待ちや入ったときの案内は出しません）。何も選ばないと、ふつうの入り方になります。BOT のロールが、付けるロールより上にある必要があります。</p>
        {(p.roles ?? []).map((r) => <label><input type="checkbox" name="joinRoleIds" value={r.id} checked={(p.joinRoleIds ?? []).includes(r.id)} disabled={!p.guji} /> {r.name}</label>)}
      </fieldset>
      {p.guji ? <button type="submit">保存</button> : <p class="note">変えられるのは宮司だけです。</p>}
    </form>

    <section class="card">
      <h2>📨 申告中（{pending.length}件）</h2>
      {pending.length ? <div class="table-wrap"><table>
        <thead><tr><th>申告</th><th>申告した人</th><th>サブ</th><th>本アカウント</th><th>理由</th><th>運営</th></tr></thead>
        <tbody>{pending.map((a) => <tr>
          <td>{fmt(a.createdAt)}</td><td>{whoDeclared(a)}{a.requestedBy === a.mainId && !a.verified ? <div class="note">銭は移しません</div> : ''}</td><td>{name(a.altId)}{p.names.has(a.altId) ? '' : <div class="note">まだ入っていません</div>}</td><td>{name(a.mainId)}</td><td>{a.reason || a.note}</td>
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
        <thead><tr><th>承認</th><th>サブ</th><th>本アカウント</th><th>理由</th><th>運営</th></tr></thead>
        <tbody>{approved.map((a) => <tr>
          <td>{a.decidedAt ? fmt(a.decidedAt) : ''}</td><td>{name(a.altId)}{p.names.has(a.altId) ? '' : <div class="note">まだ入っていません</div>}</td><td>{name(a.mainId)}</td><td>{a.reason || a.note}</td>
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
        <label class="field"><span>理由（なくても大丈夫）</span><input name="reason" maxlength={300} /></label>
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
