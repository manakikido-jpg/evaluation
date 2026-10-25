import type { AdminSession, ReactionRolePanel } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import { PANEL_BODY_MAX, PANEL_ENTRIES_MAX, PANEL_TITLE_MAX } from '../../services/reactionRoles.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';

const FLASH: Record<string, string> = { saved: '保存して、Discord に出しました。', deleted: '消しました（付いたロールはそのままです）。' };

/** 🎭 スタンプでロール（一覧と、作る・直すフォーム） */
export function ReactionRolesPage(p: { session: AdminSession; panels: ReactionRolePanel[]; channels: GuildChannel[]; roles: GuildRole[]; assignable: GuildRole[]; edit?: ReactionRolePanel; flash?: string; error?: string }) {
  const csrf = <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const roleName = (id: string) => p.roles.find((r) => r.id === id)?.name ?? '（消えたロール）';
  const chName = (id: string) => p.channels.find((c) => c.id === id)?.name ?? '（消えたチャンネル）';
  const e = p.edit;
  // 今の行 ＋ 空の行（あわせて 10 行。足りなければ保存してから開き直すと増える）
  const rows = [...(e?.entries ?? []), ...Array.from({ length: Math.max(3, Math.min(PANEL_ENTRIES_MAX, (e?.entries.length ?? 0) + 3)) - (e?.entries.length ?? 0) }, () => ({ emoji: '', roleId: '', label: '' }))].slice(0, PANEL_ENTRIES_MAX);
  return <Layout title="スタンプでロール" nav="reactionroles" session={p.session}>
    <h1>🎭 スタンプでロール</h1>
    {p.flash && <p role="status">{FLASH[p.flash] ?? p.flash}</p>}
    {p.error && <p class="flash warn" role="alert">{p.error}</p>}
    <p>Discord のメッセージにスタンプを押すと、ロールが付きます。スタンプを外すと、ロールが外れます。ここでパネルを作ると、BOT が選んだチャンネルに投稿して、スタンプを先に付けておきます。</p>
    <p class="note">付けられるのは、BOT のロールより下で、強い権限（管理者・ロールの管理など）のないロールだけです。運営・役職のロールも選べません。</p>
    <section class="card"><h2>パネル（{p.panels.length}）</h2>
      {!p.panels.length ? <p class="note">まだありません。</p> : <div class="table-wrap"><table class="compact"><thead><tr><th>題</th><th>チャンネル</th><th>スタンプとロール</th><th>直した日時</th><th></th></tr></thead><tbody>
        {p.panels.map((x) => <tr><td>{x.title || '（題なし）'}</td><td>#{chName(x.channelId)}</td><td>{x.entries.map((en) => <div>{en.emoji} → {roleName(en.roleId)}</div>)}</td><td>{fmtDateTime(x.updatedAt)}</td>
          <td><a href={`/reaction-roles?edit=${x.id}#form`}>直す</a><form method="post" action={`/reaction-roles/${x.id}/delete`} class="inline">{csrf}<button type="submit" class="danger-link">消す</button></form></td></tr>)}
      </tbody></table></div>}
    </section>
    <section class="card" id="form"><h2>{e ? `パネルを直す（#${e.id}）` : '新しいパネルを作る'}</h2>
      <form method="post" action={e ? `/reaction-roles/${e.id}` : '/reaction-roles'}>{csrf}
        <label>出すチャンネル<select name="channelId" required><option value="">選んでください</option>{p.channels.filter((c) => c.type === 0 || c.type === 5).map((c) => <option value={c.id} selected={e?.channelId === c.id}>#{c.name}</option>)}</select></label>
        <label>題<input name="title" value={e?.title ?? ''} maxlength={PANEL_TITLE_MAX} placeholder="🎭 スタンプでロールを選ぶ" /></label>
        <label>説明（なくても大丈夫）<textarea name="body" rows={4} maxlength={PANEL_BODY_MAX}>{e?.body ?? ''}</textarea></label>
        <div class="table-wrap"><table class="compact"><thead><tr><th>スタンプ</th><th>ロール</th><th>ひとこと（なくても大丈夫）</th></tr></thead><tbody>
          {rows.map((r) => <tr>
            <td><input name="emoji" value={r.emoji} maxlength={64} placeholder="🎮 か <:名前:ID>" /></td>
            <td><select name="roleId"><option value="">（なし）</option>{p.assignable.map((role) => <option value={role.id} selected={r.roleId === role.id}>{role.name}</option>)}</select></td>
            <td><input name="label" value={r.label} maxlength={80} /></td>
          </tr>)}
        </tbody></table></div>
        <p class="note">空の行は使いません。サーバーのスタンプ（カスタム絵文字）は、Discord で「\:名前:」と打って送ると出る <code>&lt;:名前:ID&gt;</code> の形で入れてください。行が足りないときは、保存してから「直す」を開くと増えます（{PANEL_ENTRIES_MAX} 個まで）。</p>
        <button type="submit">{e ? '直して Discord に反映' : '作って Discord に出す'}</button>{e && <a href="/reaction-roles" class="button-link">やめる</a>}
      </form>
    </section>
  </Layout>;
}
