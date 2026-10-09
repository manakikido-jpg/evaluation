import type { AdminSession, guideEmployees, guideReceptions, employeePayroll } from '../../db/schema.js';
import type { GuildChannel, GuildRole } from '../../lib/discordRest.js';
import type { GuideConfig } from '../../services/guideReception.js';
import { fmtDateTime } from '../format.js';
import { Layout } from './layout.js';
const STATE = { pending: '承認待ち', active: '在籍', paused: '休止', waiting: '対応待ち', assigned: '対応中', done: '完了', left: '退出済み' };
export function GuidePage(p: { session: AdminSession; config: GuideConfig; employees: (typeof guideEmployees.$inferSelect)[]; receptions: (typeof guideReceptions.$inferSelect)[]; payroll: (typeof employeePayroll.$inferSelect)[]; names: Map<string, string>; channels: GuildChannel[]; roles: GuildRole[]; flash?: string }) {
  const csrf = () => <input type="hidden" name="_csrf" value={p.session.csrfToken} />;
  const name = (id: string) => p.names.get(id) ?? id;
  return <Layout title="案内・給与" nav="guide" session={p.session}>
    <h1>案内・給与</h1>
    {p.flash && <p role="status">{p.flash === 'saved' ? '保存しました。' : p.flash === 'posted' ? '受付パネルを出しました。' : p.flash === 'status' ? '登録を変更しました。' : '設定・権限・BOTの接続を確認してください。'}</p>}
    <p>案内VCへの入室を知らせ、各部屋にリンク案内を出します。音声接続は不要です。給与は完了時に支払います。同じ利用者は日本時間で1日1件まで給与対象です。</p>
    {p.session.level === 'guji' && <section class="card"><h2>受付の設定</h2><form method="post" action="/guide/settings">{csrf()}
      <label>監視する案内VC（複数選べます）<select name="voiceChannelIds" multiple size={8}>{p.channels.filter(c => c.type === 2).map(c => <option value={c.id} selected={p.config.voiceChannelIds.includes(c.id)}>{c.name}</option>)}</select></label>
      <label>通知先<select name="staffChannelId"><option value="">設定済みの「記録」</option>{p.channels.filter(c => c.type === 0).map(c => <option value={c.id} selected={p.config.staffChannelId === c.id}>{c.name}</option>)}</select></label>
      <label>案内人ロール<select name="roleId"><option value="">名前に「案内人」を含むロール（1つだけのとき）</option>{p.roles.filter(r => !r.managed).map(r => <option value={r.id} selected={p.config.roleId === r.id}>{r.name}</option>)}</select></label>
      <label>完了1件の給与（銭。0で支払い停止）<input type="number" name="salary" min={0} max={1000000} value={p.config.salary} required /></label>
      <h3>案内リンク（上から順に表示）</h3><p>絵文字を貼り付け、チャンネルのリンクまたはIDを入れてください。1行に3つまで、空白で区切って入れられます。空欄の行は表示しません。</p>
      <table><thead><tr><th>絵文字</th><th>チャンネルのリンク・ID</th></tr></thead><tbody>{Array.from({ length: 10 }, (_, n) => { const l = p.config.links[n]; return <tr><td><input name={`emoji_${n}`} aria-label={`案内${n + 1}の絵文字`} value={l ? `<:${l.emojiName}:${l.emojiId}>` : ''} /></td><td><input name={`links_${n}`} aria-label={`案内${n + 1}のチャンネル`} value={l ? l.channelIds.join(' ') : ''} /></td></tr>; })}</tbody></table>
      <button type="submit">設定を保存</button></form>
      <form method="post" action="/guide/panel">{csrf()}<label>案内人の受付パネルを出す場所<select name="channelId" required><option value="">選んでください</option>{p.channels.filter(c => c.type === 0).map(c => <option value={c.id}>{c.name}</option>)}</select></label><button type="submit">受付パネルを出す</button></form>
    </section>}
    <section class="card"><h2>案内人の登録</h2><p>本人が受付パネルから申請し、宮司が承認すると案内人ロールが付きます。承認済みの本人が待機・停止を切り替えます。</p><table><thead><tr><th>名前</th><th>登録</th><th>待機</th><th>操作</th></tr></thead><tbody>{p.employees.map(e => <tr><td>{name(e.memberId)}</td><td>{STATE[e.status]}</td><td>{e.waiting ? '待機中' : '受付停止'}</td><td>{p.session.level === 'guji' && <form method="post" action={`/guide/employees/${e.memberId}`}>{csrf()}<button name="status" value={e.status === 'active' ? 'paused' : 'active'}>{e.status === 'active' ? '休止する' : '承認する'}</button></form>}</td></tr>)}</tbody></table></section>
    <section class="card"><h2>最近の案内（100件）</h2><table><thead><tr><th>入室</th><th>利用者</th><th>担当</th><th>状態</th><th>通知</th></tr></thead><tbody>{p.receptions.map(r => <tr><td>{fmtDateTime(r.createdAt)}</td><td>{name(r.visitorId)}</td><td>{r.guideId ? name(r.guideId) : '未定'}</td><td>{STATE[r.status]}</td><td>{r.notifiedAt ? '通知済み' : r.status === 'left' ? '退出済み' : '未通知・設定と権限を確認'}</td></tr>)}</tbody></table></section>
    <section class="card"><h2>給与明細（直近100件・支払済み）</h2><table><thead><tr><th>日付</th><th>従業員</th><th>仕事</th><th>対象</th><th>給与</th></tr></thead><tbody>{p.payroll.map(r => <tr><td>{r.date}</td><td>{name(r.memberId)}</td><td>案内</td><td>{name(r.visitorId)}</td><td>{r.amount.toLocaleString('ja-JP')}銭</td></tr>)}</tbody></table></section>
  </Layout>;
}
