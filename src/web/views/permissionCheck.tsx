import type { AdminSession } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import { canUsePermission, effectivePermissions, syncChanges, type PermissionIssue } from '../../services/permissionCheck.js';
import { MATRIX_PERMS, applies } from '../../services/permMatrix.js';
import { sameOverwrites } from '../../services/channelPerms.js';
import { Layout } from './layout.js';

export function PermissionCheckPage(p: { session: AdminSession; channels: GuildChannel[]; roles: GuildRole[]; guildId: string; selected: string[]; issues: PermissionIssue[]; checkedAt: Date; failed?: boolean; invalidRole?: boolean; q?: string; only?: string; permission?: number }) {
  const selected = new Set(p.selected);
  const byId = new Map(p.channels.map(c => [c.id, c]));
  const format = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' });
  const rows = p.channels.filter(c => c.type !== 4).map(c => {
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    const perms = effectivePermissions(c, p.roles, p.guildId, p.selected);
    const synced = parent ? sameOverwrites(c.permission_overwrites, parent.permission_overwrites) : null;
    return { c, parent, perms, synced };
  }).filter(r => (!p.q || `${r.c.name} ${r.parent?.name ?? ''}`.toLowerCase().includes(p.q.toLowerCase())) && (p.only !== 'unsynced' || r.synced === false) && (p.only !== 'visible' || r.perms.view) && (p.permission === undefined || (applies(MATRIX_PERMS.find(x => x.bit === p.permission)!, r.c) && canUsePermission(r.perms, p.permission)))).sort((a, b) => (a.parent?.position ?? -1) - (b.parent?.position ?? -1) || (a.parent?.id ?? '').localeCompare(b.parent?.id ?? '') || a.c.position - b.c.position);
  return <Layout title="権限の点検・見える範囲" session={p.session} nav="channels">
    <div class="page-head"><h1>🔎 権限の点検・見える範囲</h1><a href="/channels">チャンネル一覧へ</a></div>
    <p class="note">選んだロールをすべて持つ人として計算します。@everyoneは自動で含みます。個人への上書き・鯖の所有者・タイムアウト・年齢確認・非公開スレッドの参加状態は含みません。</p>
    <p class="note">Discordの現在の設定を開くたびに読み直します。権限の自動変更やDiscordへの通知はしません。</p>
    {p.failed ? <section class="card"><p class="flash warn">Discordの権限を取得できないため、点検できませんでした。「問題なし」とは判定していません。時間をおいて読み直してください。</p><a class="button-link" href="/channels/check">読み直す</a></section> : <>
      <p class="note">確認日時（日本時間）: {format.format(p.checkedAt)}</p>
      <section class="card"><h2>確認するロールと権限</h2>
        {p.invalidRole && <p class="flash warn">見つからないロールの指定がありました。今あるロールから選び直してください。</p>}
        <form method="get" action="/channels/check">
          <fieldset><legend>ロール（複数選択できます）</legend>
            <p class="note">未選択なら@everyoneだけです。実際のメンバーが持つロールの組み合わせを選んでください。</p>
            {[...p.roles].filter(r => r.id !== p.guildId).sort((a, b) => b.position - a.position).map(r => <label class="field"><span><input type="checkbox" name="role" value={r.id} checked={selected.has(r.id)} /> {r.name}{r.managed ? '（自動のロール）' : ''}</span></label>)}
          </fieldset>
          <label class="field"><span>チャンネル・カテゴリ名</span><input name="q" value={p.q ?? ''} maxlength={100} /></label>
          <label class="field"><span>表示する範囲</span><select name="only"><option value="all" selected={!p.only || p.only === 'all'}>すべて</option><option value="visible" selected={p.only === 'visible'}>見られるチャンネル</option><option value="unsynced" selected={p.only === 'unsynced'}>カテゴリと未同期</option></select></label>
          <label class="field"><span>使える権限で絞る</span><select name="permission"><option value="">絞らない</option>{MATRIX_PERMS.map(x => <option value={x.bit} selected={p.permission === x.bit}>{x.label}</option>)}</select></label>
          <button type="submit">この組み合わせで確認・読み直す</button>
        </form>
      </section>
      <section class="card"><h2>気になる点・確認したいこと（{p.issues.length}件）</h2>
        <p class="note">未同期は、個別の部屋など意図した設定の場合もあります。異常と決めつけず、理由を確かめてください。この一覧はロールや表示範囲の絞り込みにかかわらず鯖全体を点検しています。</p>
        {!p.issues.length && <p>今回の点検項目では、気になる点は見つかりませんでした。</p>}
        {p.issues.map(i => <details><summary>{i.level === 'warn' ? '⚠ 注意' : '❓ 要確認'}: {i.title}</summary><p>{i.question}</p>{i.channelId && <a href={`/channels/${i.channelId}`}>チャンネルの設定を開く</a>}{i.roleId && <a href={`/roles/${i.roleId}`}>ロールの設定を開く</a>}</details>)}
      </section>
      <section class="card"><h2>選んだロールの見える範囲（{rows.length}チャンネル）</h2>
        {rows.some(r => r.perms.admin) && <p class="flash warn">この組み合わせには管理者があります。チャンネルの拒否設定より管理者の権限が優先されます。</p>}
        <div class="table-wrap"><table><thead><tr><th>チャンネル</th><th>カテゴリとの同期</th><th>見る</th><th>書く</th><th>過去ログ</th><th>接続</th><th>話す</th><th>権限・同期差分</th></tr></thead><tbody>
          {rows.map(({ c, parent, perms, synced }) => {
            const voice = c.type === 2 || c.type === 13;
            const changes = parent ? syncChanges(c, parent, p.roles) : [];
            const allowed = MATRIX_PERMS.filter(x => applies(x, c) && canUsePermission(perms, x.bit));
            return <tr><td><a href={`/channels/${c.id}`}>{c.name}</a><p class="note">{parent?.name ?? 'カテゴリなし'}</p></td><td>{synced === null ? '対象外' : synced ? '同期済み' : '未同期'}</td><td>{perms.view ? '○' : '×'}</td><td>{perms.send ? '○' : '×'}</td><td>{perms.history ? '○' : '×'}</td><td>{voice ? (perms.connect ? '○' : '×') : '—'}</td><td>{voice ? (perms.speak ? '○' : '×') : '—'}</td><td><details><summary>詳しく見る</summary><p>使える権限: {allowed.map(x => x.label).join('・') || 'なし'}</p>{changes.map(x => <p>{x.name}: {x.labels.join('・')}がカテゴリと違います</p>)}{(c.permission_overwrites ?? []).some(o => o.type === 1) && <p class="note">個人への上書きがあります。このロール計算には含めていません。</p>}</details></td></tr>;
          })}
        </tbody></table></div>
        {!rows.length && <p>この条件に合うチャンネルはありません。</p>}
      </section>
    </>}
  </Layout>;
}
